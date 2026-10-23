// Izin / cuti / dayoff karyawan (Guidance HR: "mengurus izin dayoff"). Pengajuan oleh atasan / karyawan, disetujui HRD / GM.
// Pengajuan yang disetujui ditandai di Absensi (attendance_days.leave_id): hari yang tidak ada scan masuk berubah status
// menjadi cuti / izin / sakit / dinas / libur, sehingga ikut dihitung di gaji (cuti diuangkan) dan laporan kehadiran.
// Sinkron / unggah absensi berikutnya memanggil applyLeaves lagi agar tanda ini tidak tertimpa.
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageHr, nameKey } from '@/lib/hrd'
import { notify } from '@/lib/notifications'
import type { UserProfile } from '@/lib/users'

type Obj = Record<string, unknown>
type Row = RowDataPacket & Obj

export const LEAVE_JENIS = {
  cuti: 'Cuti tahunan', izin: 'Izin', sakit: 'Sakit', dayoff: 'Dayoff / tukar libur', dinas: 'Dinas luar', cuti_khusus: 'Cuti khusus',
} as const
export type LeaveJenis = keyof typeof LEAVE_JENIS
export const LEAVE_STATUS = { diajukan: 'Menunggu persetujuan', disetujui: 'Disetujui', ditolak: 'Ditolak', dibatalkan: 'Dibatalkan' } as const
export type LeaveStatus = keyof typeof LEAVE_STATUS
// Status di Absensi untuk tiap jenis
const ATT_STATUS: Record<LeaveJenis, string> = { cuti: 'cuti', cuti_khusus: 'cuti', izin: 'izin', sakit: 'sakit', dinas: 'dinas', dayoff: 'libur' }
const MARK = 'PAP-MS izin' // status_asli baris absensi yang dibuat dari pengajuan (tidak ada di laporan mesin)

export function requireLeave(user: UserProfile) {
  if (!user.menus.includes('izin-cuti' as never)) fail(403, 'Anda tidak punya akses ke menu Izin & Cuti.')
}
export const canApproveLeave = canManageHr

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v)
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10)
export const todayWib = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
export function datesBetween(a: string, b: string) {
  const out: string[] = []
  for (let d = a; d <= b && out.length < 400; d = addDays(d, 1)) out.push(d)
  return out
}
// Hari kerja default: tanpa hari Minggu (bisa diubah di form bila jadwal karyawan berbeda)
export const countDays = (a: string, b: string) => datesBetween(a, b).filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0).length

export function readLeave(body: Obj) {
  const nip = str(body.nip, 30) || fail(400, 'Pilih karyawan.')
  const jenis = String(body.jenis ?? '') as LeaveJenis
  if (!(jenis in LEAVE_JENIS)) fail(400, 'Jenis izin tidak valid.')
  const mulai = str(body.tanggal_mulai, 10)
  const selesai = str(body.tanggal_selesai, 10) || mulai
  if (!isDate(mulai) || !isDate(selesai)) fail(400, 'Tanggal tidak valid.')
  if (selesai < mulai) fail(400, 'Tanggal selesai sebelum tanggal mulai.')
  if (datesBetween(mulai, selesai).length > 90) fail(400, 'Maksimal 90 hari per pengajuan.')
  const hariRaw = body.hari === '' || body.hari == null ? null : Number(String(body.hari).replace(',', '.'))
  if (hariRaw !== null && (!Number.isFinite(hariRaw) || hariRaw <= 0 || hariRaw > 90 || (hariRaw * 2) % 1)) fail(400, 'Jumlah hari tidak valid (kelipatan 0,5).')
  const lampiran = str(body.lampiran_url, 500)
  if (lampiran && !/^https?:\/\//i.test(lampiran)) fail(400, 'Lampiran harus berupa link (https://...).')
  return { nip, jenis, tanggal_mulai: mulai, tanggal_selesai: selesai, hari: hariRaw ?? Math.max(countDays(mulai, selesai), 1), alasan: str(body.alasan, 1000) || null, lampiran_url: lampiran || null }
}
export type LeaveInput = ReturnType<typeof readLeave>

export const LEAVE_SELECT = `SELECT l.*, DATE_FORMAT(l.tanggal_mulai, '%Y-%m-%d') AS mulai, DATE_FORMAT(l.tanggal_selesai, '%Y-%m-%d') AS selesai,
  uc.name AS created_name, ua.name AS approved_name
  FROM leave_requests l LEFT JOIN users uc ON uc.id = l.created_by LEFT JOIN users ua ON ua.id = l.approved_by`
export const serializeLeave = (r: Row) => ({
  id: Number(r.id), nomor: String(r.nomor), nip: String(r.nip), nama: String(r.nama), divisi: (r.divisi as string) ?? null, jenis: r.jenis as LeaveJenis,
  tanggal_mulai: String(r.mulai), tanggal_selesai: String(r.selesai), hari: Number(r.hari), alasan: (r.alasan as string) ?? null, lampiran_url: (r.lampiran_url as string) ?? null,
  status: r.status as LeaveStatus, catatan_approval: (r.catatan_approval as string) ?? null, approved_name: (r.approved_name as string) ?? null,
  approved_at: r.approved_at ? String(r.approved_at) : null, created_by: Number(r.created_by), created_name: (r.created_name as string) ?? null, created_at: String(r.created_at),
})

async function employee(nip: string) {
  const [[e]] = await db.query<Row[]>('SELECT nip, nama, divisi, tgl_masuk, tgl_berhenti FROM employees WHERE nip = ?', [nip])
  return e ?? fail(400, 'Karyawan tidak ditemukan di Data Karyawan.')
}

// Jatah cuti tahunan: berlaku setelah 12 bulan bekerja (UU Ketenagakerjaan); terpakai = cuti tahunan disetujui di tahun itu
export async function leaveBalances(tahun: number, nips?: string[]) {
  const [[set]] = await db.query<Row[]>("SELECT value FROM app_settings WHERE `key` = 'hrd.jatah_cuti'")
  const jatah = Number(set?.value ?? 12) || 12
  const [rows] = await db.query<Row[]>(
    `SELECT e.nip, DATE_FORMAT(e.tgl_masuk, '%Y-%m-%d') AS tgl_masuk,
       COALESCE(SUM(IF(l.status = 'disetujui', l.hari, 0)), 0) AS terpakai, COALESCE(SUM(IF(l.status = 'diajukan', l.hari, 0)), 0) AS menunggu
     FROM employees e LEFT JOIN leave_requests l ON l.nip = e.nip AND l.jenis = 'cuti' AND YEAR(l.tanggal_mulai) = ?
     WHERE e.tgl_berhenti IS NULL ${nips?.length ? 'AND e.nip IN (?)' : ''} GROUP BY e.nip, e.tgl_masuk`,
    nips?.length ? [tahun, nips] : [tahun],
  )
  const akhirTahun = `${tahun}-12-31`
  return new Map(rows.map((r) => {
    const masuk = r.tgl_masuk as string | null
    // Berhak bila genap 12 bulan sebelum akhir tahun; tahun pertama berhak dihitung proporsional sejak genap 12 bulan
    const genap = masuk ? `${Number(masuk.slice(0, 4)) + 1}${masuk.slice(4)}` : null
    const berhak = !masuk ? jatah : genap! > akhirTahun ? 0 : genap! <= `${tahun}-01-01` ? jatah : Math.floor((jatah * (12 - Number(genap!.slice(5, 7)) + 1)) / 12)
    return [String(r.nip), { jatah: berhak, terpakai: Number(r.terpakai), menunggu: Number(r.menunggu), sisa: berhak - Number(r.terpakai), berhak_sejak: genap }]
  }))
}

async function checkLeave(v: LeaveInput, id?: number) {
  const e = await employee(v.nip)
  const [[overlap]] = await db.query<Row[]>(
    "SELECT nomor FROM leave_requests WHERE nip = ? AND status IN ('diajukan', 'disetujui') AND tanggal_mulai <= ? AND tanggal_selesai >= ? AND id <> ? LIMIT 1",
    [v.nip, v.tanggal_selesai, v.tanggal_mulai, id ?? 0],
  )
  if (overlap) fail(400, `Tanggal bertabrakan dengan pengajuan ${overlap.nomor}.`)
  if (v.jenis === 'cuti') {
    const bal = (await leaveBalances(Number(v.tanggal_mulai.slice(0, 4)), [v.nip])).get(v.nip)
    const [[own]] = id ? await db.query<Row[]>("SELECT IF(jenis = 'cuti', hari, 0) AS hari, status FROM leave_requests WHERE id = ?", [id]) : [[undefined]]
    const already = own ? (own.status === 'disetujui' ? 0 : Number(own.hari)) : 0
    if (bal && bal.jatah === 0) fail(400, `${e.nama} belum berhak cuti tahunan (berhak mulai ${bal.berhak_sejak ?? '-'}). Pakai jenis Izin / Cuti khusus.`)
    if (bal && v.hari > bal.sisa - (bal.menunggu - already)) fail(400, `Sisa cuti ${e.nama} ${bal.sisa} hari${bal.menunggu - already ? ` (${bal.menunggu - already} hari menunggu persetujuan)` : ''}.`)
  }
  return e
}

async function hrUserIds(exceptId: number) {
  const [rows] = await db.query<Row[]>(
    "SELECT u.id FROM users u JOIN divisions d ON d.id = u.division_id WHERE u.is_active = 1 AND d.code IN ('hrd', 'general_manager') AND u.id <> ?",
    [exceptId],
  )
  return rows.map((r) => Number(r.id))
}

export async function createLeave(v: LeaveInput, user: UserProfile) {
  const e = await checkLeave(v)
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    const prefix = `IZ/${todayWib().slice(0, 4)}/${todayWib().slice(5, 7)}/`
    const [[last]] = await conn.query<Row[]>('SELECT nomor FROM leave_requests WHERE nomor LIKE ? ORDER BY nomor DESC LIMIT 1 FOR UPDATE', [`${prefix}%`])
    const nomor = `${prefix}${String(Number(String(last?.nomor ?? '').slice(-4) || 0) + 1).padStart(4, '0')}`
    // HRD / GM yang mengajukan langsung disetujui
    const auto = canApproveLeave(user)
    const [res] = await conn.query<ResultSetHeader>(
      `INSERT INTO leave_requests (nomor, nip, nama, divisi, jenis, tanggal_mulai, tanggal_selesai, hari, alasan, lampiran_url, status, approved_by, approved_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nomor, v.nip, e.nama, e.divisi ?? null, v.jenis, v.tanggal_mulai, v.tanggal_selesai, v.hari, v.alasan, v.lampiran_url, auto ? 'disetujui' : 'diajukan', auto ? user.id : null, auto ? new Date() : null, user.id],
    )
    if (!auto) {
      await notify(await hrUserIds(user.id), {
        type: 'sistem', title: `Pengajuan ${LEAVE_JENIS[v.jenis].toLowerCase()} ${e.nama}`, body: `${nomor} · ${v.tanggal_mulai}${v.tanggal_selesai !== v.tanggal_mulai ? ` s/d ${v.tanggal_selesai}` : ''} (${v.hari} hari) oleh ${user.name}`,
        page: 'Izin & Cuti', pageId: res.insertId, refKey: `leave:${res.insertId}:baru`,
      }, conn)
    }
    await conn.commit()
    if (auto) await applyLeaves([res.insertId])
    return { id: res.insertId, nomor, auto }
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
}

export async function loadLeave(id: number) {
  const [[r]] = await db.query<Row[]>(`${LEAVE_SELECT} WHERE l.id = ?`, [id])
  return r ? serializeLeave(r) : fail(404, 'Pengajuan tidak ditemukan.')
}

// Ubah: pengaju selama masih menunggu; HRD kapan saja (yang sudah disetujui ditandai ulang di Absensi)
export async function updateLeave(id: number, v: LeaveInput, user: UserProfile) {
  const cur = await loadLeave(id)
  const hr = canApproveLeave(user)
  if (!hr && (cur.created_by !== user.id || cur.status !== 'diajukan')) fail(403, 'Pengajuan yang sudah diproses hanya bisa diubah HRD.')
  if (['ditolak', 'dibatalkan'].includes(cur.status)) fail(400, 'Pengajuan yang ditolak / dibatalkan tidak bisa diubah.')
  const e = await checkLeave(v, id)
  await db.query(
    'UPDATE leave_requests SET nip = ?, nama = ?, divisi = ?, jenis = ?, tanggal_mulai = ?, tanggal_selesai = ?, hari = ?, alasan = ?, lampiran_url = ? WHERE id = ?',
    [v.nip, e.nama, e.divisi ?? null, v.jenis, v.tanggal_mulai, v.tanggal_selesai, v.hari, v.alasan, v.lampiran_url, id],
  )
  if (cur.status === 'disetujui') {
    await revokeLeave(id)
    await applyLeaves([id])
  }
}

// setujui / tolak (HRD, GM) · batal (pengaju selama menunggu, HRD kapan saja)
export async function setLeaveStatus(id: number, action: string, catatan: string, user: UserProfile) {
  const cur = await loadLeave(id)
  const hr = canApproveLeave(user)
  let status: LeaveStatus
  if (action === 'setujui' || action === 'tolak') {
    if (!hr) fail(403, 'Persetujuan izin / cuti oleh HRD atau GM.')
    if (cur.status !== 'diajukan') fail(400, 'Pengajuan ini sudah diproses.')
    status = action === 'setujui' ? 'disetujui' : 'ditolak'
    if (status === 'disetujui') await checkLeave({ ...cur, lampiran_url: cur.lampiran_url, alasan: cur.alasan }, id)
  } else if (action === 'batal') {
    if (!hr && (cur.created_by !== user.id || cur.status !== 'diajukan')) fail(403, 'Hanya HRD yang bisa membatalkan pengajuan yang sudah disetujui.')
    if (['ditolak', 'dibatalkan'].includes(cur.status)) fail(400, 'Pengajuan ini sudah tidak aktif.')
    status = 'dibatalkan'
  } else fail(400, 'Aksi tidak dikenal.')
  await db.query('UPDATE leave_requests SET status = ?, catatan_approval = ?, approved_by = ?, approved_at = NOW() WHERE id = ?', [status!, catatan || null, user.id, id])
  if (status! === 'disetujui') await applyLeaves([id])
  if (cur.status === 'disetujui') await revokeLeave(id)
  if (cur.created_by !== user.id && status! !== 'dibatalkan') {
    await notify([cur.created_by], {
      type: 'sistem', title: `${LEAVE_JENIS[cur.jenis]} ${cur.nama} ${status! === 'disetujui' ? 'disetujui' : 'ditolak'}`, body: `${cur.nomor}${catatan ? ` · ${catatan}` : ''} (${user.name})`,
      page: 'Izin & Cuti', pageId: id, refKey: `leave:${id}:${status!}`,
    })
  }
  return status!
}

export async function deleteLeave(id: number, user: UserProfile) {
  const cur = await loadLeave(id)
  if (!canApproveLeave(user) && (cur.created_by !== user.id || cur.status !== 'diajukan')) fail(403, 'Pengajuan yang sudah diproses hanya bisa dihapus HRD.')
  if (cur.status === 'disetujui') await revokeLeave(id)
  await db.query('DELETE FROM leave_requests WHERE id = ?', [id])
  await db.query("DELETE FROM notifications WHERE ref_key LIKE ?", [`leave:${id}:%`])
  return cur
}

// Tandai hari izin di Absensi. ids = pengajuan tertentu; range = semua pengajuan disetujui yang beririsan (dipanggil setelah sinkron absensi)
export async function applyLeaves(ids?: number[], range?: { dari: string; sampai: string }) {
  const where = ids?.length ? 'l.id IN (?)' : range ? 'l.tanggal_mulai <= ? AND l.tanggal_selesai >= ?' : '1 = 1'
  const [leaves] = await db.query<Row[]>(
    `SELECT l.id, l.nomor, l.nip, l.nama, l.jenis, DATE_FORMAT(l.tanggal_mulai, '%Y-%m-%d') AS mulai, DATE_FORMAT(l.tanggal_selesai, '%Y-%m-%d') AS selesai
     FROM leave_requests l WHERE l.status = 'disetujui' AND ${where}`,
    ids?.length ? [ids] : range ? [range.sampai, range.dari] : [],
  )
  let ditandai = 0
  for (const l of leaves) {
    const jenis = l.jenis as LeaveJenis
    const status = ATT_STATUS[jenis]
    const dates = datesBetween(String(l.mulai), String(l.selesai))
    const ket = `${LEAVE_JENIS[jenis]} ${l.nomor}`.slice(0, 500)
    const [rows] = await db.query<Row[]>("SELECT id, DATE_FORMAT(tanggal, '%Y-%m-%d') AS tanggal, status, jam_masuk FROM attendance_days WHERE nip = ? AND tanggal BETWEEN ? AND ?", [l.nip, l.mulai, l.selesai])
    const have = new Map(rows.map((r) => [String(r.tanggal), r]))
    const update: number[] = []
    const insert: unknown[][] = []
    for (const d of dates) {
      const r = have.get(d)
      if (!r) {
        // Belum ada data mesin di tanggal itu (mis. tanggal mendatang): baris absensi dibuat dari pengajuan
        if (jenis !== 'dayoff' && new Date(`${d}T00:00:00Z`).getUTCDay() === 0) continue
        insert.push([l.nip, l.nama, nameKey(l.nama), d, status, MARK, ket, l.id, 'upload'])
      } else if (!r.jam_masuk && (r.status !== 'libur' || jenis === 'dayoff')) update.push(Number(r.id))
    }
    if (update.length) await db.query('UPDATE attendance_days SET status = ?, keterangan = ?, leave_id = ? WHERE id IN (?)', [status, ket, l.id, update])
    if (insert.length) {
      await db.query(
        `INSERT INTO attendance_days (nip, nama, nama_key, tanggal, status, status_asli, keterangan, leave_id, sumber) VALUES ?
         ON DUPLICATE KEY UPDATE status = IF(jam_masuk IS NULL, VALUES(status), status), keterangan = IF(jam_masuk IS NULL, VALUES(keterangan), keterangan), leave_id = IF(jam_masuk IS NULL, VALUES(leave_id), leave_id)`,
        [insert],
      )
    }
    ditandai += update.length + insert.length
  }
  return { pengajuan: leaves.length, ditandai }
}

// Lepas tanda izin dari Absensi (pengajuan dibatalkan / diubah / dihapus); status dihitung ulang dari Jadwal Shift
export async function revokeLeave(id: number) {
  const [rows] = await db.query<Row[]>("SELECT DISTINCT DATE_FORMAT(tanggal, '%Y-%m') AS p FROM attendance_days WHERE leave_id = ?", [id])
  await db.query('DELETE FROM attendance_days WHERE leave_id = ? AND status_asli = ? AND jam_masuk IS NULL', [id, MARK])
  await db.query("UPDATE attendance_days SET status = IF(jam_masuk IS NULL, 'tidak_hadir', status), keterangan = NULL, leave_id = NULL WHERE leave_id = ?", [id])
  if (rows.length) {
    const { applyShiftSchedule } = await import('@/lib/attendance')
    await applyShiftSchedule(rows.map((r) => String(r.p)))
  }
}
