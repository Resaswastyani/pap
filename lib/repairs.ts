// Laporan kerusakan mesin dari Produksi ke Teknik (ERD: permintaan_perbaikan).
// Laporan baru langsung jadi notifikasi + push ke divisi Teknik; mesin yang berhenti otomatis berstatus maintenance
// sampai perbaikannya selesai, dan lama mesin berhenti (downtime) tercatat.
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { fail, int, str } from '@/lib/api'
import { db } from '@/lib/db'
import { notify } from '@/lib/notifications'
import { pushToUsers } from '@/lib/push'
import { isManagement, type UserProfile } from '@/lib/users'

export const REPAIR_STATUS = { baru: 'Baru', dikerjakan: 'Dikerjakan', menunggu_part: 'Menunggu sparepart', selesai: 'Selesai', batal: 'Batal' } as const
export type RepairStatus = keyof typeof REPAIR_STATUS
export const REPAIR_PRIORITY = { darurat: 'Darurat', tinggi: 'Tinggi', normal: 'Normal' } as const
export type RepairPriority = keyof typeof REPAIR_PRIORITY
export const OPEN_STATUSES: RepairStatus[] = ['baru', 'dikerjakan', 'menunggu_part']

export const canViewRepairs = (user: UserProfile) => user.menus.includes('perbaikan-mesin')
export function requireRepairs(user: UserProfile) {
  if (!canViewRepairs(user)) fail(403, 'Anda tidak punya akses ke menu Kerusakan Mesin.')
}
// Penanganan (teknisi, status, tindakan): divisi Teknik, GM, admin
export const canHandleRepair = (user: UserProfile) => isManagement(user) || user.division.code === 'teknik'
// Melapor: siapa pun dengan menu Kerusakan Mesin
export const canReportRepair = canViewRepairs

export const REPAIR_SELECT = `SELECT r.id, r.nomor, r.machine_id, m.kode AS machine_kode, m.nama AS machine_nama, m.tahap AS machine_tahap, m.status AS machine_status,
  r.result_id, r.keluhan, r.prioritas, r.mesin_berhenti, r.status, r.teknisi_id, ut.name AS teknisi_name, r.penyebab, r.tindakan, r.sparepart,
  r.target_selesai, r.mulai_at, r.selesai_at, r.reported_by, ur.name AS reported_name, ud.name AS reporter_division, r.created_at, r.updated_at,
  TIMESTAMPDIFF(MINUTE, r.created_at, COALESCE(r.selesai_at, NOW())) AS durasi_menit,
  pr.tanggal AS result_tanggal, pr.shift AS result_shift, j.spk_nomor AS result_spk, j.item_name AS result_item
  FROM machine_repairs r
  JOIN machines m ON m.id = r.machine_id
  JOIN users ur ON ur.id = r.reported_by
  JOIN divisions ud ON ud.id = ur.division_id
  LEFT JOIN users ut ON ut.id = r.teknisi_id
  LEFT JOIN production_results pr ON pr.id = r.result_id
  LEFT JOIN production_jobs j ON j.id = pr.job_id`

type RepairRow = RowDataPacket & {
  id: number; machine_id: number; machine_nama: string; status: RepairStatus; prioritas: RepairPriority; keluhan: string; teknisi_id: number | null
  teknisi_name: string | null; tindakan: string | null; reported_by: number; mesin_berhenti: number; durasi_menit: number | string | null
}
export const serializeRepair = (r: RowDataPacket) => ({ ...(r as RepairRow), mesin_berhenti: !!r.mesin_berhenti, durasi_menit: Number(r.durasi_menit ?? 0) })

export async function loadRepair(id: number) {
  const [[row]] = await db.query<RepairRow[]>(`${REPAIR_SELECT} WHERE r.id = ?`, [id])
  return row ? serializeRepair(row) : fail(404, 'Laporan kerusakan tidak ditemukan.')
}

// Mesin berhenti -> maintenance; kembali aktif bila tidak ada lagi laporan terbuka yang menghentikan mesin itu
export async function syncMachineStatus(machineId: number) {
  const [[open]] = await db.query<(RowDataPacket & { n: number })[]>(
    "SELECT COUNT(*) AS n FROM machine_repairs WHERE machine_id = ? AND mesin_berhenti = 1 AND status IN ('baru', 'dikerjakan', 'menunggu_part')",
    [machineId],
  )
  if (Number(open.n)) await db.query("UPDATE machines SET status = 'maintenance' WHERE id = ? AND status = 'aktif'", [machineId])
  else await db.query("UPDATE machines SET status = 'aktif' WHERE id = ? AND status = 'maintenance'", [machineId])
}

async function usersOf(where: string, args: unknown[] = []) {
  const [rows] = await db.query<(RowDataPacket & { id: number })[]>(
    `SELECT u.id FROM users u JOIN divisions d ON d.id = u.division_id JOIN roles r ON r.id = u.role_id WHERE u.is_active = 1 AND (${where})`,
    args,
  )
  return rows.map((r) => r.id)
}
// Daftar teknisi (divisi Teknik) untuk ditugaskan
export async function technicians() {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT u.id, u.name FROM users u JOIN divisions d ON d.id = u.division_id WHERE u.is_active = 1 AND d.code = 'teknik' ORDER BY u.name",
  )
  return rows as { id: number; name: string }[]
}

export type RepairInput = { machineId: number; keluhan: string; prioritas: RepairPriority; mesinBerhenti: boolean; resultId?: number | null }
export function readRepairInput(body: Record<string, unknown>): RepairInput {
  const machineId = int(body.machine_id) ?? fail(400, 'Pilih mesin yang rusak.')
  const keluhan = str(body.keluhan, 5000)
  if (!keluhan) fail(400, 'Jelaskan kerusakan / kendala mesin.')
  const prioritas = typeof body.prioritas === 'string' && body.prioritas in REPAIR_PRIORITY ? (body.prioritas as RepairPriority) : 'normal'
  return { machineId, keluhan, prioritas, mesinBerhenti: body.mesin_berhenti === true || body.mesin_berhenti === 1 || body.mesin_berhenti === '1' }
}

// Buat laporan + notifikasi Teknik (darurat: juga Kepala PPIC & Kepala Produksi karena jadwal terdampak)
export async function createRepair(input: RepairInput, user: UserProfile) {
  const [[machine]] = await db.query<(RowDataPacket & { id: number; kode: string; nama: string })[]>('SELECT id, kode, nama FROM machines WHERE id = ?', [input.machineId])
  if (!machine) fail(400, 'Mesin tidak ditemukan.')
  const [res] = await db.query<ResultSetHeader>(
    'INSERT INTO machine_repairs (machine_id, result_id, keluhan, prioritas, mesin_berhenti, reported_by) VALUES (?, ?, ?, ?, ?, ?)',
    [machine.id, input.resultId ?? null, input.keluhan, input.prioritas, input.mesinBerhenti ? 1 : 0, user.id],
  )
  const id = res.insertId
  await db.query("UPDATE machine_repairs SET nomor = CONCAT('PRB-', DATE_FORMAT(created_at, '%Y%m'), '-', LPAD(id, 5, '0')) WHERE id = ?", [id])
  if (input.mesinBerhenti) await syncMachineStatus(machine.id)
  const recipients = await usersOf(
    input.prioritas === 'darurat' ? "d.code = 'teknik' OR (r.code = 'lead' AND d.code IN ('ppic', 'produksi'))" : "d.code = 'teknik'",
  )
  const label = REPAIR_PRIORITY[input.prioritas]
  await pushToUsers(await notify(recipients.filter((uid) => uid !== user.id), {
    type: 'perbaikan_mesin',
    title: `${input.prioritas === 'darurat' ? 'DARURAT · ' : ''}Mesin ${machine.nama} perlu perbaikan`,
    body: `${label}${input.mesinBerhenti ? ' · mesin berhenti' : ''} · ${input.keluhan} (dilapor ${user.name})`,
    repairId: id,
    refKey: `repair-${id}-baru`,
  }))
  return id
}

// Kabar perubahan status ke pelapor (dan teknisi yang baru ditugaskan)
export async function notifyRepairUpdate(id: number, actor: UserProfile, assigned: number | null) {
  const repair = await loadRepair(id)
  const updates: Promise<number[]>[] = []
  if (repair.reported_by !== actor.id) {
    updates.push(notify([repair.reported_by], {
      type: 'perbaikan_mesin',
      title: `Perbaikan ${repair.machine_nama}: ${REPAIR_STATUS[repair.status as RepairStatus]}`,
      body: [repair.teknisi_name && `Teknisi ${repair.teknisi_name}`, repair.tindakan].filter(Boolean).join(' · ') || repair.keluhan,
      repairId: id,
      refKey: `repair-${id}-${repair.status}`,
    }))
  }
  if (assigned && assigned !== actor.id) {
    updates.push(notify([assigned], {
      type: 'perbaikan_mesin',
      title: `Anda ditugaskan memperbaiki ${repair.machine_nama}`,
      body: `${REPAIR_PRIORITY[repair.prioritas as RepairPriority]} · ${repair.keluhan}`,
      repairId: id,
      refKey: `repair-${id}-tugas-${assigned}`,
    }))
  }
  await pushToUsers((await Promise.all(updates)).flat())
}
