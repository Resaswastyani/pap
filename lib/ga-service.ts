// Jadwal Service Inventaris (General Affair): jadwal service berkala per barang inventaris (servis AC, ganti oli kendaraan,
// kalibrasi, ...) dan pemantauannya. Realisasi service dicatat di riwayat barang (ga_inventaris_logs jenis 'service')
// sehingga terlihat juga di detail barang pada menu Inventaris.
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { fail, int, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageGa } from '@/lib/ga'
import { addInventarisLog, INV_KONDISI, loadInventaris, readDate, readMoney, todayWib, type InvKondisi } from '@/lib/inventaris'
import type { UserProfile } from '@/lib/users'

export const canViewService = (user: UserProfile) => user.menus.includes('ga-service' as never)
export const canManageService = canManageGa
export function requireService(user: UserProfile, manage = false) {
  if (!canViewService(user)) fail(403, 'Anda tidak punya akses ke menu Jadwal Service Inventaris.')
  if (manage && !canManageService(user)) fail(403, 'Jadwal service inventaris dikelola General Affair.')
}

export type ServiceStatus = 'terlambat' | 'segera' | 'terjadwal' | 'selesai'
export const SERVICE_STATUS: Record<ServiceStatus, string> = { terlambat: 'Terlambat', segera: 'Segera', terjadwal: 'Terjadwal', selesai: 'Selesai / nonaktif' }

const SCHEDULE_SELECT = `SELECT s.id, s.item_id, s.nama, s.interval_bulan, s.jadwal, s.terakhir, s.vendor, s.perkiraan_biaya, s.pic_id, u.name AS pic_nama, s.pic_lain,
    s.pengingat_hari, s.aktif, s.catatan, s.updated_at, i.kode AS item_kode, i.nama AS item_nama, i.kategori AS item_kategori, i.lokasi AS item_lokasi,
    i.nomor_seri AS item_nomor_seri, i.kondisi AS item_kondisi, i.status AS item_status,
    (SELECT COUNT(*) FROM ga_inventaris_logs l WHERE l.schedule_id = s.id) AS jumlah_service,
    (SELECT COALESCE(SUM(l.biaya), 0) FROM ga_inventaris_logs l WHERE l.schedule_id = s.id) AS total_biaya
  FROM ga_service_schedules s JOIN ga_inventaris i ON i.id = s.item_id LEFT JOIN users u ON u.id = s.pic_id`

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400e3)
export const addMonths = (iso: string, months: number) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const target = new Date(Date.UTC(y, m - 1 + months, 1))
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(d, last))
  return target.toISOString().slice(0, 10)
}

function serialize(r: RowDataPacket, today: string) {
  const jadwal = String(r.jadwal).slice(0, 10)
  const sisa = daysBetween(today, jadwal)
  const aktif = !!r.aktif && r.item_status === 'aktif'
  const status: ServiceStatus = !aktif ? 'selesai' : sisa < 0 ? 'terlambat' : sisa <= Number(r.pengingat_hari) ? 'segera' : 'terjadwal'
  return {
    id: Number(r.id), item_id: Number(r.item_id), nama: String(r.nama), interval_bulan: r.interval_bulan === null ? null : Number(r.interval_bulan),
    jadwal, terakhir: r.terakhir ? String(r.terakhir).slice(0, 10) : null, vendor: r.vendor ?? null, perkiraan_biaya: r.perkiraan_biaya === null ? null : Number(r.perkiraan_biaya),
    pic_id: r.pic_id === null ? null : Number(r.pic_id), pic: (r.pic_nama ?? r.pic_lain ?? null) as string | null, pic_lain: r.pic_lain ?? null,
    pengingat_hari: Number(r.pengingat_hari), aktif: !!r.aktif, catatan: r.catatan ?? null, updated_at: r.updated_at,
    item: { kode: String(r.item_kode), nama: String(r.item_nama), kategori: r.item_kategori ?? null, lokasi: r.item_lokasi ?? null, nomor_seri: r.item_nomor_seri ?? null, kondisi: r.item_kondisi, status: r.item_status },
    jumlah_service: Number(r.jumlah_service), total_biaya: Number(r.total_biaya), sisa_hari: sisa, status,
  }
}
export type ServiceSchedule = ReturnType<typeof serialize>

export async function listSchedules(opts: { itemId?: number; includeInactive?: boolean } = {}) {
  const where: string[] = []
  const args: unknown[] = []
  if (opts.itemId) where.push('s.item_id = ?'), args.push(opts.itemId)
  if (!opts.includeInactive) where.push("s.aktif = 1 AND i.status = 'aktif'")
  const [rows] = await db.query<RowDataPacket[]>(`${SCHEDULE_SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY s.aktif DESC, s.jadwal, s.id`, args)
  const today = todayWib()
  return rows.map((r) => serialize(r, today))
}

export async function loadSchedule(id: number) {
  const [[row]] = await db.query<RowDataPacket[]>(`${SCHEDULE_SELECT} WHERE s.id = ?`, [id])
  return row ? serialize(row, todayWib()) : fail(404, 'Jadwal service tidak ditemukan.')
}

// Riwayat service (realisasi) dalam satu tahun, terbaru dulu
export async function listServiceLogs(tahun: number) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT l.id, l.item_id, l.schedule_id, l.tanggal, l.keterangan, l.biaya, l.vendor, u.name AS created_name, i.kode AS item_kode, i.nama AS item_nama, s.nama AS schedule_nama
     FROM ga_inventaris_logs l JOIN ga_inventaris i ON i.id = l.item_id JOIN users u ON u.id = l.created_by LEFT JOIN ga_service_schedules s ON s.id = l.schedule_id
     WHERE l.jenis IN ('service', 'perbaikan') AND YEAR(l.tanggal) = ? ORDER BY l.tanggal DESC, l.id DESC LIMIT 1000`,
    [tahun],
  )
  return rows.map((r) => ({ ...r, tanggal: String(r.tanggal).slice(0, 10), biaya: r.biaya === null ? null : Number(r.biaya), jenis: r.schedule_id ? 'service' : 'perbaikan' }))
}

// { item_id, nama, interval_bulan, jadwal, vendor, perkiraan_biaya, pic_id, pic_lain, pengingat_hari, catatan }
export async function readScheduleInput(body: Record<string, unknown>) {
  const itemId = int(body.item_id) ?? fail(400, 'Pilih barang inventaris.')
  const item = await loadInventaris(itemId)
  if (item.status !== 'aktif') fail(400, `${item.nama} sudah dihapuskan dari inventaris.`)
  const nama = str(body.nama, 200)
  if (!nama) fail(400, 'Isi jenis service (mis. Cuci AC, Ganti oli).')
  const raw = body.interval_bulan
  const interval = raw === undefined || raw === null || raw === '' ? null : Number(raw)
  if (interval !== null && (!Number.isInteger(interval) || interval < 1 || interval > 120)) fail(400, 'Interval service harus 1–120 bulan (kosongkan bila sekali saja).')
  const jadwal = readDate(body.jadwal, 'Jadwal service', true) as string
  let picId: number | null = null
  if (body.pic_id) {
    picId = int(body.pic_id)
    const [[u]] = await db.query<RowDataPacket[]>('SELECT id FROM users WHERE id = ? AND is_active = 1', [picId])
    if (!u) fail(400, 'PIC tidak ditemukan.')
  }
  const pengingat = body.pengingat_hari === undefined || body.pengingat_hari === '' ? 7 : Number(body.pengingat_hari)
  if (!Number.isInteger(pengingat) || pengingat < 0 || pengingat > 365) fail(400, 'Pengingat harus 0–365 hari sebelum jadwal.')
  return {
    item, itemId, nama, interval, jadwal, picId, pengingat,
    vendor: str(body.vendor, 150) || null,
    perkiraanBiaya: readMoney(body.perkiraan_biaya, 'Perkiraan biaya'),
    picLain: picId ? null : str(body.pic_lain, 150) || null,
    catatan: str(body.catatan, 5000) || null,
  }
}

export async function createSchedule(body: Record<string, unknown>, userId: number) {
  const v = await readScheduleInput(body)
  const [res] = await db.query<ResultSetHeader>(
    `INSERT INTO ga_service_schedules (item_id, nama, interval_bulan, jadwal, vendor, perkiraan_biaya, pic_id, pic_lain, pengingat_hari, catatan, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [v.itemId, v.nama, v.interval, v.jadwal, v.vendor, v.perkiraanBiaya, v.picId, v.picLain, v.pengingat, v.catatan, userId],
  )
  return loadSchedule(res.insertId)
}

// Ubah jadwal, atau { aktif: true|false } saja untuk menghentikan / mengaktifkan lagi
export async function updateSchedule(id: number, body: Record<string, unknown>) {
  await loadSchedule(id)
  if (Object.keys(body).length === 1 && 'aktif' in body) {
    await db.query('UPDATE ga_service_schedules SET aktif = ? WHERE id = ?', [body.aktif ? 1 : 0, id])
    return loadSchedule(id)
  }
  const v = await readScheduleInput(body)
  await db.query(
    `UPDATE ga_service_schedules SET item_id = ?, nama = ?, interval_bulan = ?, jadwal = ?, vendor = ?, perkiraan_biaya = ?, pic_id = ?, pic_lain = ?, pengingat_hari = ?, catatan = ?, aktif = 1
     WHERE id = ?`,
    [v.itemId, v.nama, v.interval, v.jadwal, v.vendor, v.perkiraanBiaya, v.picId, v.picLain, v.pengingat, v.catatan, id],
  )
  return loadSchedule(id)
}

// Catat service selesai: { tanggal, vendor, biaya, keterangan, kondisi, jadwal_berikutnya }
// -> riwayat barang (jenis service), jadwal maju sesuai interval; tanpa interval = jadwal selesai (nonaktif)
export async function recordService(id: number, body: Record<string, unknown>, userId: number) {
  const s = await loadSchedule(id)
  if (s.item.status !== 'aktif') fail(400, `${s.item.nama} sudah dihapuskan dari inventaris.`)
  const tanggal = readDate(body.tanggal, 'Tanggal service') ?? todayWib()
  if (tanggal > todayWib()) fail(400, 'Tanggal service tidak boleh di masa depan.')
  const keterangan = str(body.keterangan, 5000)
  const vendor = str(body.vendor, 150) || s.vendor
  const biaya = readMoney(body.biaya, 'Biaya')
  const manual = readDate(body.jadwal_berikutnya, 'Jadwal berikutnya')
  if (manual && manual <= tanggal) fail(400, 'Jadwal berikutnya harus setelah tanggal service.')
  const next = manual ?? (s.interval_bulan ? addMonths(tanggal, s.interval_bulan) : null)
  await addInventarisLog({ itemId: s.item_id, scheduleId: id, jenis: 'service', keterangan: `${s.nama}${keterangan ? `: ${keterangan}` : ''}`, biaya, vendor, tanggal, userId })
  await db.query('UPDATE ga_service_schedules SET terakhir = GREATEST(COALESCE(terakhir, ?), ?), jadwal = COALESCE(?, jadwal), aktif = ? WHERE id = ?', [tanggal, tanggal, next, next ? 1 : 0, id])
  const kondisi = str(body.kondisi, 20) as InvKondisi
  if (kondisi && kondisi in INV_KONDISI && kondisi !== s.item.kondisi) {
    await db.query('UPDATE ga_inventaris SET kondisi = ? WHERE id = ?', [kondisi, s.item_id])
    await addInventarisLog({ itemId: s.item_id, jenis: 'kondisi', keterangan: `Kondisi: ${INV_KONDISI[s.item.kondisi as InvKondisi]} → ${INV_KONDISI[kondisi]} (setelah ${s.nama})`, tanggal, userId })
  }
  return { schedule: await loadSchedule(id), next }
}

export function serviceSummary(items: ServiceSchedule[], biayaTahunIni: number) {
  const today = todayWib()
  const bulan = today.slice(0, 7)
  const aktif = items.filter((s) => s.status !== 'selesai')
  return {
    aktif: aktif.length,
    terlambat: aktif.filter((s) => s.status === 'terlambat').length,
    segera: aktif.filter((s) => s.status === 'segera').length,
    bulan_ini: aktif.filter((s) => s.jadwal.startsWith(bulan)).length,
    perkiraan_bulan_ini: aktif.filter((s) => s.jadwal.startsWith(bulan) || s.status === 'terlambat').reduce((n, s) => n + (s.perkiraan_biaya ?? 0), 0),
    biaya_tahun_ini: biayaTahunIni,
  }
}
