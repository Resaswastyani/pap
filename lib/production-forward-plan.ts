import type { RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageProduction, PRODUCTION_SO_MAX_AGE_DAYS } from '@/lib/production'
import { isLeadOf, type UserProfile } from '@/lib/users'

// Rencana Produksi ke depan: pesanan Accurate (barang "Diproduksi") yang belum terproses dijadwalkan
// ke tanggal produksi & Shift 1/2/3, dengan jumlah dan nilai (jumlah x harga jual pesanan).
// Diatur PPIC / GM / Kepala Produksi; yang lain hanya melihat.
export const SHIFTS = [1, 2, 3] as const
export const canPlanProduction = (user: UserProfile) => canManageProduction(user) || isLeadOf(user, 'produksi')

type Row = RowDataPacket & Record<string, unknown>
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

// Pesanan yang masih harus diproduksi: SO belum terproses, job tidak selesai/batal, SO dibuat N hari terakhir
const OPEN = `so.status <> 'Terproses' AND j.status NOT IN ('selesai', 'batal') AND so.trans_date >= CURDATE() - INTERVAL ${Number(PRODUCTION_SO_MAX_AGE_DAYS)} DAY`

export const todayWib = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)

export async function loadForwardPlan() {
  const [jobs] = await db.query<Row[]>(
    `SELECT j.id, j.so_number, DATE_FORMAT(so.trans_date, '%Y-%m-%d') AS so_date, DATE_FORMAT(j.due_date, '%Y-%m-%d') AS due_date, j.item_name, i.item_no,
       j.quantity, j.unit, j.prioritas, so.status AS so_status, soi.unit_price, c.name AS customer
     FROM production_jobs j
     JOIN accurate_sales_orders so ON so.accurate_id = j.so_accurate_id
     LEFT JOIN accurate_sales_order_items soi ON soi.so_accurate_id = j.so_accurate_id AND soi.line_id = j.line_id
     LEFT JOIN accurate_items i ON i.accurate_id = j.item_accurate_id
     LEFT JOIN customers c ON c.id = j.customer_id
     WHERE ${OPEN}
     ORDER BY j.due_date IS NULL, j.due_date, j.prioritas = 'tinggi' DESC, j.id
     LIMIT 1000`,
  )
  const ids = jobs.map((j) => Number(j.id))
  const [shifts] = ids.length
    ? await db.query<Row[]>(
      `SELECT id, job_id, DATE_FORMAT(tanggal, '%Y-%m-%d') AS tanggal, shift, quantity, catatan FROM production_job_shifts
       WHERE job_id IN (?) ORDER BY tanggal, shift, id`,
      [ids],
    )
    : [[] as Row[]]
  return jobs.map((j) => {
    const price = num(j.unit_price)
    const quantity = num(j.quantity) ?? 0
    const list = shifts.filter((s) => s.job_id === j.id).map((s) => {
      const q = Number(s.quantity)
      return { id: Number(s.id), tanggal: String(s.tanggal), shift: Number(s.shift), quantity: q, nilai: price === null ? null : q * price, catatan: (s.catatan as string) || null }
    })
    return {
      id: Number(j.id), so_number: j.so_number as string | null, so_date: j.so_date as string | null, due_date: j.due_date as string | null,
      item_name: String(j.item_name), item_no: (j.item_no as string) ?? null, customer: (j.customer as string) ?? null,
      quantity, unit: (j.unit as string) ?? null, unit_price: price, nilai: price === null ? null : quantity * price,
      prioritas: String(j.prioritas), so_status: (j.so_status as string) ?? null,
      shifts: list, terjadwal: list.reduce((a, s) => a + s.quantity, 0),
    }
  })
}

// Validasi isian form: [{ tanggal, shift, quantity, catatan? }]
export function readPlanRows(body: unknown) {
  const raw = (body as { rows?: unknown })?.rows
  const list: unknown[] = Array.isArray(raw) ? raw : fail(400, 'Data jadwal tidak valid.')
  if (list.length > 60) fail(400, 'Maksimal 60 baris jadwal per pesanan.')
  return list.map((item, i) => {
    const r = (item ?? {}) as Record<string, unknown>
    const tanggal = str(r.tanggal, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal) || Number.isNaN(Date.parse(tanggal))) fail(400, `Baris ${i + 1}: isi tanggal produksi.`)
    const shift = Number(r.shift)
    if (!SHIFTS.includes(shift as 1)) fail(400, `Baris ${i + 1}: pilih Shift 1, 2, atau 3.`)
    const quantity = Number(r.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1e12) fail(400, `Baris ${i + 1}: jumlah harus lebih dari 0.`)
    return { tanggal, shift, quantity, catatan: str(r.catatan, 255) || null }
  })
}

export async function loadOpenJob(id: number) {
  const [[job]] = await db.query<Row[]>(
    `SELECT j.id, j.so_number, j.item_name, j.unit FROM production_jobs j JOIN accurate_sales_orders so ON so.accurate_id = j.so_accurate_id WHERE j.id = ?`,
    [id],
  )
  return job ?? fail(404, 'Pesanan produksi tidak ditemukan.')
}

// Simpan jadwal satu pesanan (menggantikan jadwal sebelumnya). Jadwal yang tanggalnya sudah lewat tetap disimpan apa adanya;
// jadwal baru tidak boleh sebelum hari ini.
export async function saveJobPlan(jobId: number, rows: ReturnType<typeof readPlanRows>, userId: number) {
  const today = todayWib()
  const [old] = await db.query<Row[]>("SELECT DATE_FORMAT(tanggal, '%Y-%m-%d') AS tanggal, shift, quantity FROM production_job_shifts WHERE job_id = ?", [jobId])
  const oldKeys = new Set(old.map((o) => `${o.tanggal}|${o.shift}|${Number(o.quantity)}`))
  rows.forEach((r, i) => {
    if (r.tanggal < today && !oldKeys.has(`${r.tanggal}|${r.shift}|${r.quantity}`)) fail(400, `Baris ${i + 1}: tanggal rencana tidak boleh sebelum hari ini.`)
  })
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('DELETE FROM production_job_shifts WHERE job_id = ?', [jobId])
    if (rows.length) {
      await conn.query(
        'INSERT INTO production_job_shifts (job_id, tanggal, shift, quantity, catatan, created_by, updated_by) VALUES ?',
        [rows.map((r) => [jobId, r.tanggal, r.shift, r.quantity, r.catatan, userId, userId])],
      )
    }
    // Status job ikut: ada jadwal = dijadwalkan, kosong = menunggu (job yang sudah berjalan dibiarkan)
    await conn.query("UPDATE production_jobs SET status = IF(?, 'dijadwalkan', 'menunggu'), updated_by = ? WHERE id = ? AND status IN ('menunggu', 'dijadwalkan')", [rows.length > 0, userId, jobId])
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}
