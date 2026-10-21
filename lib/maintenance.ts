// Jadwal & checkup perawatan mesin (Guidance Tehnik: pengecekan fungsi mesin & maintenance rutin,
// dokumen checkup & maintenance mesin).
import type { RowDataPacket } from 'mysql2'
import { fail, int, str } from '@/lib/api'
import { db } from '@/lib/db'
import { CHECKUP_RESULT, isDate, requireMachine, todayWib, type CheckupResult } from '@/lib/teknik'

// Parameter pertama = tanggal hari ini (WIB) untuk sisa_hari
export const PLAN_SELECT = `SELECT p.id, p.machine_id, m.kode AS machine_kode, m.nama AS machine_nama, m.tahap AS machine_tahap, m.status AS machine_status,
  p.judul, p.komponen, p.interval_hari, p.berikutnya, p.terakhir, p.pic_id, up.name AS pic_name, p.aktif, p.catatan, p.created_at, p.updated_at,
  DATEDIFF(p.berikutnya, ?) AS sisa_hari,
  (SELECT l.hasil FROM maintenance_logs l WHERE l.plan_id = p.id ORDER BY l.tanggal DESC, l.id DESC LIMIT 1) AS hasil_terakhir
  FROM maintenance_plans p
  JOIN machines m ON m.id = p.machine_id
  LEFT JOIN users up ON up.id = p.pic_id`

export const LOG_SELECT = `SELECT l.id, l.plan_id, p.judul AS plan_judul, l.machine_id, m.kode AS machine_kode, m.nama AS machine_nama, l.tanggal, l.hasil,
  l.temuan, l.tindakan, l.durasi_menit, l.repair_id, r.nomor AS repair_nomor, l.dikerjakan_oleh, u.name AS dikerjakan_name, l.created_at,
  (SELECT COUNT(*) FROM note_attachments na WHERE na.owner_type = 'maintenance_log' AND na.owner_id = l.id) AS lampiran
  FROM maintenance_logs l
  JOIN machines m ON m.id = l.machine_id
  LEFT JOIN maintenance_plans p ON p.id = l.plan_id
  LEFT JOIN machine_repairs r ON r.id = l.repair_id
  JOIN users u ON u.id = l.dikerjakan_oleh`

type PlanRow = RowDataPacket & { id: number; machine_id: number; machine_nama: string; judul: string; komponen: string | null; interval_hari: number; berikutnya: string; terakhir: string | null; pic_id: number | null }
export const serializePlan = (r: RowDataPacket) => ({ ...(r as PlanRow), aktif: !!r.aktif, sisa_hari: Number(r.sisa_hari) })
export const serializeLog = (r: RowDataPacket) => ({ ...r, lampiran: Number(r.lampiran ?? 0) })

export async function loadPlan(id: number) {
  const [[row]] = await db.query<RowDataPacket[]>(`${PLAN_SELECT} WHERE p.id = ?`, [todayWib(), id])
  return row ? serializePlan(row) : fail(404, 'Jadwal perawatan tidak ditemukan.')
}

// { machine_id, judul, komponen, interval_hari, berikutnya, pic_id, catatan }
export async function readPlanInput(body: Record<string, unknown>) {
  const machine = await requireMachine(body.machine_id)
  const judul = str(body.judul, 200)
  if (!judul) fail(400, 'Isi nama pekerjaan perawatan.')
  const interval = int(body.interval_hari)
  if (!interval || interval < 1 || interval > 3650) fail(400, 'Interval perawatan harus 1–3650 hari.')
  const berikutnya = str(body.berikutnya, 10)
  if (!isDate(berikutnya)) fail(400, 'Isi tanggal jatuh tempo berikutnya.')
  let picId: number | null = null
  if (body.pic_id) {
    picId = int(body.pic_id)
    const [[pic]] = await db.query<RowDataPacket[]>('SELECT id FROM users WHERE id = ? AND is_active = 1', [picId])
    if (!pic) fail(400, 'PIC tidak ditemukan.')
  }
  return { machineId: machine.id, judul, komponen: str(body.komponen, 150) || null, interval: interval!, berikutnya, picId, catatan: str(body.catatan, 5000) || null }
}

// { plan_id?, machine_id, tanggal, hasil, temuan, tindakan, durasi_menit }
export async function readCheckupInput(body: Record<string, unknown>) {
  const planId = body.plan_id ? int(body.plan_id) : null
  let machineId: number
  let plan: RowDataPacket | null = null
  if (planId) {
    const [[row]] = await db.query<RowDataPacket[]>('SELECT id, machine_id, interval_hari, terakhir, judul FROM maintenance_plans WHERE id = ?', [planId])
    if (!row) fail(404, 'Jadwal perawatan tidak ditemukan.')
    plan = row
    machineId = row.machine_id
  } else {
    machineId = (await requireMachine(body.machine_id)).id
  }
  const tanggal = str(body.tanggal, 10) || todayWib()
  if (!isDate(tanggal)) fail(400, 'Tanggal checkup tidak valid.')
  if (tanggal > todayWib()) fail(400, 'Tanggal checkup tidak boleh di masa depan.')
  const hasil = str(body.hasil, 20) as CheckupResult
  if (!(hasil in CHECKUP_RESULT)) fail(400, 'Pilih hasil checkup.')
  const temuan = str(body.temuan, 5000) || null
  if (hasil !== 'baik' && !temuan) fail(400, 'Tuliskan temuan / kondisi mesin.')
  const durasi = body.durasi_menit === '' || body.durasi_menit == null ? null : int(body.durasi_menit)
  if (durasi !== null && (durasi < 0 || durasi > 100000)) fail(400, 'Durasi tidak valid.')
  return { plan, machineId, tanggal, hasil, temuan, tindakan: str(body.tindakan, 5000) || null, durasi }
}
