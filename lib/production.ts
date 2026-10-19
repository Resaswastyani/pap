import type { RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'
import { PERMISSIONS } from '@/lib/permissions'
import { can, isLeadOf, isManagement, type UserProfile } from '@/lib/users'

// Jadwal Produksi: setiap baris Sales Order Accurate berisi barang bertanda "Diproduksi"
// otomatis menjadi job produksi, dipecah per tahap (Blow -> Cetak -> Bag making) dengan mesin & jadwal.

export const PRODUCTION_STAGES = ['Blow', 'Cetak', 'Bag making', 'Lainnya'] as const

// Hanya SO yang belum selesai & dibuat dalam N hari terakhir (SO lama yang lupa ditutup diabaikan)
export const PRODUCTION_SO_MAX_AGE_DAYS = Number(process.env.PRODUCTION_SO_MAX_AGE_DAYS || 30)

export const JOB_STATUS = { menunggu: 'Menunggu dijadwalkan', dijadwalkan: 'Dijadwalkan', berjalan: 'Berjalan', selesai: 'Selesai', batal: 'Batal' } as const
export type JobStatus = keyof typeof JOB_STATUS
export const STAGE_STATUS = { belum: 'Belum mulai', berjalan: 'Berjalan', selesai: 'Selesai', dilewati: 'Dilewati' } as const
export type StageStatus = keyof typeof STAGE_STATUS

// Kepala PPIC & GM mengatur jadwal, mesin, & job; Produksi update progress; staff PPIC & divisi lain dengan menu Jadwal Produksi hanya melihat.
// Permission production.manage tetap bisa diberikan per user (Manajemen User) bila perlu pengecualian.
export const canManageProduction = (user: UserProfile) => can(user, PERMISSIONS.productionManage) || isManagement(user) || isLeadOf(user, 'ppic')
export const canProgressProduction = (user: UserProfile) => canManageProduction(user) || can(user, PERMISSIONS.productionProgress) || user.division.code === 'produksi'
// Job produksi dibuka dari menu Jadwal Produksi, SPK, atau Hasil Produksi
export const canViewProduction = (user: UserProfile) => ['jadwal-produksi', 'sbk', 'hasil-produksi'].some((m) => user.menus.includes(m as never))
// Verifikasi QC hasil produksi: Kepala Produksi, PPIC (kelola), GM, atau permission production.qc
export const canQcProduction = (user: UserProfile) => canManageProduction(user) || can(user, PERMISSIONS.productionQc) || isLeadOf(user, 'produksi')
// Data mesin: PPIC & Teknik
export const canManageMachines = (user: UserProfile) => user.role.isAdmin || canManageProduction(user) || ['ppic', 'teknik'].includes(user.division.code)

// Tahap bawaan dari nama barang: "POLOS" tanpa cetak, "ROL" tanpa bag making
export function defaultStages(itemName: string) {
  const stages = ['Blow']
  if (!/\bpolos\b/i.test(itemName)) stages.push('Cetak')
  if (!/\b(rol|roll)\b/i.test(itemName)) stages.push('Bag making')
  return stages
}

// Buat/perbarui job dari pesanan (dipanggil setiap selesai sinkron Accurate)
export async function syncProductionJobs() {
  await db.query(
    `INSERT IGNORE INTO production_jobs (so_accurate_id, line_id, so_number, customer_id, product_id, item_accurate_id, item_name, quantity, unit, due_date)
     SELECT soi.so_accurate_id, soi.line_id, so.number, c.id, p.id, soi.item_accurate_id, COALESCE(soi.item_name, '(tanpa nama)'),
       soi.quantity, soi.unit, COALESCE(so.ship_date, so.trans_date)
     FROM accurate_sales_order_items soi
     JOIN accurate_sales_orders so ON so.accurate_id = soi.so_accurate_id
     JOIN accurate_items i ON i.accurate_id = soi.item_accurate_id AND i.item_produced = 1
     LEFT JOIN customers c ON c.accurate_id = so.customer_accurate_id
     LEFT JOIN customer_products p ON p.accurate_item_id = soi.item_accurate_id
     WHERE so.status <> 'Terproses' AND so.trans_date >= CURDATE() - INTERVAL ? DAY`,
    [PRODUCTION_SO_MAX_AGE_DAYS],
  )
  await db.query("UPDATE production_jobs SET nomor = CONCAT('JP-', DATE_FORMAT(created_at, '%Y%m'), '-', LPAD(id, 5, '0')) WHERE nomor IS NULL")
  // Perubahan jumlah / tanggal kirim di Accurate diikuti selama job belum berjalan; customer/produk yang baru tersinkron dilengkapi
  await db.query(
    `UPDATE production_jobs j
     JOIN accurate_sales_order_items soi ON soi.so_accurate_id = j.so_accurate_id AND soi.line_id = j.line_id
     JOIN accurate_sales_orders so ON so.accurate_id = j.so_accurate_id
     LEFT JOIN customers c ON c.accurate_id = so.customer_accurate_id
     LEFT JOIN customer_products p ON p.accurate_item_id = soi.item_accurate_id
     SET j.quantity = IF(j.status IN ('menunggu', 'dijadwalkan'), soi.quantity, j.quantity),
         j.unit = IF(j.status IN ('menunggu', 'dijadwalkan'), soi.unit, j.unit),
         j.due_date = IF(j.status IN ('menunggu', 'dijadwalkan'), COALESCE(so.ship_date, so.trans_date), j.due_date),
         j.customer_id = COALESCE(j.customer_id, c.id), j.product_id = COALESCE(j.product_id, p.id)`,
  )
  // Job baru: buat tahap bawaan
  const [fresh] = await db.query<(RowDataPacket & { id: number; item_name: string })[]>(
    'SELECT j.id, j.item_name FROM production_jobs j WHERE NOT EXISTS (SELECT 1 FROM production_stages s WHERE s.job_id = j.id)',
  )
  const rows = fresh.flatMap((job) => defaultStages(job.item_name).map((tahap, index) => [job.id, index + 1, tahap]))
  if (rows.length) await db.query('INSERT INTO production_stages (job_id, urutan, tahap) VALUES ?', [rows])
}

// Status job mengikuti tahapnya (kecuali dibatalkan)
export async function refreshJobStatus(jobId: number) {
  const [stages] = await db.query<(RowDataPacket & { status: StageStatus; machine_id: number | null; plan_start: string | null })[]>(
    'SELECT status, machine_id, plan_start FROM production_stages WHERE job_id = ?',
    [jobId],
  )
  const active = stages.filter((s) => s.status !== 'dilewati')
  let status: JobStatus = 'menunggu'
  if (active.length && active.every((s) => s.status === 'selesai')) status = 'selesai'
  else if (active.some((s) => s.status === 'berjalan' || s.status === 'selesai')) status = 'berjalan'
  else if (active.length && active.every((s) => s.machine_id && s.plan_start)) status = 'dijadwalkan'
  await db.query("UPDATE production_jobs SET status = ? WHERE id = ? AND status <> 'batal'", [status, jobId])
  return status
}

// Hasil baik = hasil - reject, laporan yang ditolak QC (reject) tidak dihitung
export const GOOD_QTY_SQL = "CASE r.status_qc WHEN 'reject' THEN 0 ELSE r.jumlah_hasil - r.jumlah_reject END"

export const JOB_SELECT = `SELECT j.id, j.nomor, j.spk_nomor, j.spk_terbit_at, us.name AS spk_terbit_name, j.so_accurate_id, j.so_number, j.line_id, j.customer_id, c.name AS customer_name, j.product_id,
  j.item_accurate_id, j.item_name, j.quantity, j.unit, j.target_qty, j.due_date, j.status, j.prioritas, j.catatan, j.formulasi, j.tingkat_kualitas, j.acuan_kerja, j.created_at, j.updated_at,
  (SELECT SUM(${GOOD_QTY_SQL}) FROM production_results r WHERE r.stage_id = (
     SELECT s.id FROM production_stages s WHERE s.job_id = j.id AND s.status <> 'dilewati' ORDER BY s.urutan DESC LIMIT 1)) AS hasil_baik,
  so.trans_date AS so_date, so.status AS so_status,
  (SELECT COUNT(*) FROM production_stages s WHERE s.job_id = j.id AND s.status <> 'dilewati') AS stage_count,
  (SELECT COUNT(*) FROM production_stages s WHERE s.job_id = j.id AND s.status = 'selesai') AS stage_done,
  (SELECT ROUND(AVG(s.progress)) FROM production_stages s WHERE s.job_id = j.id AND s.status <> 'dilewati') AS progress,
  (SELECT CONCAT(s.tahap, IF(m.nama IS NULL, '', CONCAT(' · ', m.nama))) FROM production_stages s LEFT JOIN machines m ON m.id = s.machine_id
     WHERE s.job_id = j.id AND s.status IN ('belum', 'berjalan') ORDER BY s.urutan LIMIT 1) AS current_stage,
  (SELECT MIN(s.plan_start) FROM production_stages s WHERE s.job_id = j.id) AS plan_start,
  (SELECT MAX(s.plan_end) FROM production_stages s WHERE s.job_id = j.id) AS plan_end
  FROM production_jobs j
  LEFT JOIN customers c ON c.id = j.customer_id
  LEFT JOIN accurate_sales_orders so ON so.accurate_id = j.so_accurate_id
  LEFT JOIN users us ON us.id = j.spk_terbit_oleh`

type JobRow = RowDataPacket & { id: number; status: JobStatus; product_id: number | null; item_accurate_id: number | null; item_name: string; spk_nomor: string | null }
export const serializeJob = (row: JobRow) => ({
  ...row,
  quantity: row.quantity === null ? null : Number(row.quantity),
  target_qty: row.target_qty === null ? null : Number(row.target_qty),
  hasil_baik: row.hasil_baik === null ? null : Number(row.hasil_baik),
  stage_count: Number(row.stage_count ?? 0),
  stage_done: Number(row.stage_done ?? 0),
  progress: Number(row.progress ?? 0),
})

// "2026-10-14T09:30" -> "2026-10-14 09:30:00" (kosong -> null)
export function parseLocalDateTime(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const match = typeof value === 'string' ? value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?$/) : null
  return match ? `${match[1]} ${match[2]}:00` : undefined
}

export async function loadJob(id: number) {
  const [rows] = await db.query<JobRow[]>(`${JOB_SELECT} WHERE j.id = ? LIMIT 1`, [id])
  return rows[0] ? serializeJob(rows[0]) : fail(404, 'Job produksi tidak ditemukan.')
}

export async function loadStages(jobId: number) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT s.id, s.urutan, s.tahap, s.machine_id, m.nama AS machine_name, m.kode AS machine_kode, s.plan_start, s.plan_end, s.actual_start, s.actual_end,
       s.status, s.progress, s.target_qty, s.target_unit, s.pic_user_id, u.name AS pic_name, s.catatan, s.updated_at, ub.name AS updated_by_name,
       (SELECT SUM(${GOOD_QTY_SQL}) FROM production_results r WHERE r.stage_id = s.id) AS hasil_baik,
       (SELECT SUM(r.jumlah_reject) FROM production_results r WHERE r.stage_id = s.id) AS jumlah_reject,
       (SELECT COUNT(*) FROM production_results r WHERE r.stage_id = s.id) AS laporan
     FROM production_stages s LEFT JOIN machines m ON m.id = s.machine_id LEFT JOIN users u ON u.id = s.pic_user_id LEFT JOIN users ub ON ub.id = s.updated_by
     WHERE s.job_id = ? ORDER BY s.urutan`,
    [jobId],
  )
  return rows.map((r) => ({
    ...r,
    target_qty: r.target_qty === null ? null : Number(r.target_qty),
    hasil_baik: r.hasil_baik === null ? null : Number(r.hasil_baik),
    jumlah_reject: r.jumlah_reject === null ? null : Number(r.jumlah_reject),
    laporan: Number(r.laporan ?? 0),
  }))
}

export function readMachineInput(body: Record<string, unknown>) {
  const kode = str(body.kode, 30)
  const nama = str(body.nama, 150)
  if (!kode || !nama) fail(400, 'Kode dan nama mesin wajib diisi.')
  const tahap = str(body.tahap, 40) || 'Lainnya'
  const status = ['aktif', 'maintenance', 'nonaktif'].includes(String(body.status)) ? String(body.status) : 'aktif'
  return { kode, nama, tahap, status, kapasitas: str(body.kapasitas, 150) || null, keterangan: str(body.keterangan, 5000) || null }
}
