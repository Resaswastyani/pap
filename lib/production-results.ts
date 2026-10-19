// Laporan hasil produksi per tahap, tanggal, & shift + monitoring QC (Guidance: Produksi mengecek hasil laporan monitoring QC
// dan hasil produksi yang ditargetkan masing-masing shift). Progress tahap dihitung dari hasil baik terhadap target.
import type { RowDataPacket } from 'mysql2'
import { db } from '@/lib/db'
import { fail, int, str } from '@/lib/api'
import { GOOD_QTY_SQL, refreshJobStatus } from '@/lib/production'

export const QC_STATUS = { menunggu: 'Menunggu QC', lolos: 'Lolos QC', perbaikan: 'Perlu perbaikan', reject: 'Reject' } as const
export type QcStatus = keyof typeof QC_STATUS

// Jam shift sesuai keterangan jadwal shift: Shift 1 07.00-15.00, Shift 2 15.00-23.00, Shift 3 23.00-07.00.
// Shift 3 setelah tengah malam tetap dicatat pada tanggal mulai shift (hari sebelumnya).
export function currentShift(now = new Date()) {
  const wib = new Date(now.getTime() + 7 * 3600e3)
  const hour = wib.getUTCHours()
  const shift = hour >= 7 && hour < 15 ? 1 : hour >= 15 && hour < 23 ? 2 : 3
  if (hour < 7) wib.setUTCDate(wib.getUTCDate() - 1)
  return { tanggal: wib.toISOString().slice(0, 10), shift }
}

export const RESULT_SELECT = `SELECT r.id, r.job_id, r.stage_id, r.tanggal, r.shift, r.machine_id, m.nama AS machine_name, r.jumlah_hasil, r.jumlah_reject, r.satuan,
  r.operator, r.kendala, r.catatan, r.status_qc, r.catatan_qc, r.qc_at, uq.name AS qc_name, r.reported_by, ur.name AS reported_name, r.created_at,
  j.nomor, j.spk_nomor, j.item_name, c.name AS customer_name, s.tahap, s.urutan
  FROM production_results r
  JOIN production_jobs j ON j.id = r.job_id
  JOIN production_stages s ON s.id = r.stage_id
  LEFT JOIN customers c ON c.id = j.customer_id
  LEFT JOIN machines m ON m.id = r.machine_id
  LEFT JOIN users uq ON uq.id = r.qc_by
  JOIN users ur ON ur.id = r.reported_by`

export const serializeResult = (r: RowDataPacket) => ({ ...r, jumlah_hasil: Number(r.jumlah_hasil), jumlah_reject: Number(r.jumlah_reject) })

const decimal = (value: unknown, label: string, required: boolean) => {
  if (value === null || value === undefined || value === '') return required ? fail(400, `${label} wajib diisi.`) : 0
  const n = Number(String(value).replace(',', '.'))
  if (!Number.isFinite(n) || n < 0 || n > 1e12) fail(400, `${label} tidak valid.`)
  return n
}

// Isi laporan dari form: { stage_id, tanggal, shift, machine_id, jumlah_hasil, jumlah_reject, satuan, operator, kendala, catatan }
export async function readResultInput(body: Record<string, unknown>) {
  const stageId = int(body.stage_id) ?? fail(400, 'Pilih tahap produksi.')
  const [[stage]] = await db.query<(RowDataPacket & { id: number; job_id: number; machine_id: number | null; target_unit: string | null; unit: string | null; job_status: string })[]>(
    'SELECT s.id, s.job_id, s.machine_id, s.target_unit, j.unit, j.status AS job_status FROM production_stages s JOIN production_jobs j ON j.id = s.job_id WHERE s.id = ?',
    [stageId],
  )
  if (!stage) fail(404, 'Tahap produksi tidak ditemukan.')
  if (stage.job_status === 'batal') fail(400, 'Job produksi ini sudah dibatalkan.')
  const tanggal = str(body.tanggal, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) fail(400, 'Tanggal produksi tidak valid.')
  const shift = int(body.shift)
  if (!shift || shift < 1 || shift > 3) fail(400, 'Pilih shift 1, 2, atau 3.')
  const hasil = decimal(body.jumlah_hasil, 'Jumlah hasil', true)
  const reject = decimal(body.jumlah_reject, 'Jumlah reject', false)
  if (reject > hasil) fail(400, 'Jumlah reject tidak boleh melebihi jumlah hasil.')
  const machineId = body.machine_id ? int(body.machine_id) : stage.machine_id
  return {
    stage, tanggal, shift, machineId, hasil, reject,
    satuan: str(body.satuan, 40) || stage.target_unit || stage.unit || null,
    operator: str(body.operator, 255) || null,
    kendala: str(body.kendala, 5000) || null,
    catatan: str(body.catatan, 5000) || null,
  }
}

// Progress tahap = hasil baik (satuan sama dengan target) / target tahap; target kosong = target SPK / jumlah pesanan.
// Status naik otomatis: ada hasil -> berjalan, mencapai target -> selesai. Tahap tanpa target tidak diubah.
export async function refreshStageProgress(stageId: number) {
  const [[row]] = await db.query<RowDataPacket[]>(
    `SELECT s.id, s.job_id, s.status, COALESCE(s.target_qty, j.target_qty, j.quantity) AS target, COALESCE(s.target_unit, j.unit) AS unit,
       (SELECT SUM(${GOOD_QTY_SQL}) FROM production_results r WHERE r.stage_id = s.id AND (r.satuan IS NULL OR COALESCE(s.target_unit, j.unit) IS NULL OR r.satuan = COALESCE(s.target_unit, j.unit))) AS good,
       (SELECT COUNT(*) FROM production_results r WHERE r.stage_id = s.id) AS reports
     FROM production_stages s JOIN production_jobs j ON j.id = s.job_id WHERE s.id = ?`,
    [stageId],
  )
  if (!row || row.status === 'dilewati') return
  const target = Number(row.target ?? 0)
  const good = Number(row.good ?? 0)
  if (!Number(row.reports)) return
  const progress = target > 0 ? Math.min(100, Math.floor((good / target) * 100)) : null
  const status = progress !== null && progress >= 100 ? 'selesai' : row.status === 'belum' ? 'berjalan' : row.status
  await db.query(
    `UPDATE production_stages SET status = ?, progress = COALESCE(?, progress),
       actual_start = COALESCE(actual_start, NOW()), actual_end = IF(? = 'selesai', COALESCE(actual_end, NOW()), actual_end)
     WHERE id = ?`,
    [status, progress, status, stageId],
  )
  await refreshJobStatus(row.job_id)
}
