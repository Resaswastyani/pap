import type { RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageProduction } from '@/lib/production'
import { isLeadOf, type UserProfile } from '@/lib/users'

// Rencana Produksi: pembagian pengerjaan baris formula MP ke Shift 1/2/3 beserta jumlah & nilai (Rupiah).
// Diatur PPIC / GM / Kepala Produksi; yang lain hanya melihat.
export const SHIFTS = [1, 2, 3] as const
export const canPlanShifts = (user: UserProfile) => canManageProduction(user) || isLeadOf(user, 'produksi')

type Row = RowDataPacket & Record<string, unknown>
export type ShiftRow = { id: number; shift: number; tanggal: string | null; quantity: number; unit_price: number | null; nilai: number | null; catatan: string | null }

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))

// Pembagian shift untuk banyak MP sekaligus: Map "moId:lineId" -> baris
export async function loadPlanShifts(moIds: number[]) {
  const out = new Map<string, ShiftRow[]>()
  if (!moIds.length) return out
  const [rows] = await db.query<Row[]>(
    `SELECT s.id, s.mo_accurate_id, s.line_id, s.shift, DATE_FORMAT(s.tanggal, '%Y-%m-%d') AS tanggal, s.quantity, s.unit_price, s.catatan, it.unit_cost
     FROM production_plan_shifts s
     LEFT JOIN accurate_manufacture_order_items l ON l.mo_accurate_id = s.mo_accurate_id AND l.line_id = s.line_id
     LEFT JOIN accurate_items it ON it.accurate_id = l.item_accurate_id
     WHERE s.mo_accurate_id IN (?) ORDER BY s.shift, s.tanggal, s.id`,
    [moIds],
  )
  for (const r of rows) {
    const key = `${r.mo_accurate_id}:${r.line_id}`
    const price = num(r.unit_price) ?? (num(r.unit_cost) || null)
    const quantity = Number(r.quantity)
    const list = out.get(key) ?? []
    list.push({ id: Number(r.id), shift: Number(r.shift), tanggal: (r.tanggal as string) ?? null, quantity, unit_price: num(r.unit_price), nilai: price === null ? null : quantity * price, catatan: (r.catatan as string) || null })
    out.set(key, list)
  }
  return out
}

// Ringkasan bulan per shift & satuan (tanpa filter pencarian), untuk baris ringkasan di atas tabel
export async function shiftSummary(periode: string) {
  const [rows] = await db.query<Row[]>(
    `SELECT s.shift, l.unit, SUM(s.quantity) AS kuantitas, SUM(s.quantity * COALESCE(s.unit_price, NULLIF(it.unit_cost, 0))) AS nilai, COUNT(DISTINCT s.mo_accurate_id, s.line_id) AS formula
     FROM production_plan_shifts s
     JOIN accurate_manufacture_orders mo ON mo.accurate_id = s.mo_accurate_id
     LEFT JOIN accurate_manufacture_order_items l ON l.mo_accurate_id = s.mo_accurate_id AND l.line_id = s.line_id
     LEFT JOIN accurate_items it ON it.accurate_id = l.item_accurate_id
     WHERE mo.trans_date >= CONCAT(?, '-01') AND mo.trans_date < CONCAT(?, '-01') + INTERVAL 1 MONTH
     GROUP BY s.shift, l.unit ORDER BY s.shift`,
    [periode, periode],
  )
  return SHIFTS.map((shift) => {
    const list = rows.filter((r) => Number(r.shift) === shift)
    return {
      shift,
      formula: list.reduce((a, r) => a + Number(r.formula), 0),
      nilai: list.reduce((a, r) => a + (Number(r.nilai) || 0), 0),
      per_satuan: list.map((r) => ({ satuan: String(r.unit ?? ''), kuantitas: Number(r.kuantitas) })),
    }
  })
}

// Validasi isian form: [{ shift, tanggal?, quantity, unit_price?, catatan? }]
export function readShiftRows(body: unknown) {
  const rows = (body as { rows?: unknown })?.rows
  const list: unknown[] = Array.isArray(rows) ? rows : fail(400, 'Data pembagian shift tidak valid.')
  if (list.length > 30) fail(400, 'Maksimal 30 baris pembagian shift.')
  return list.map((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>
    const shift = Number(r.shift)
    if (!SHIFTS.includes(shift as 1)) fail(400, `Baris ${i + 1}: pilih Shift 1, 2, atau 3.`)
    const quantity = Number(r.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1e12) fail(400, `Baris ${i + 1}: jumlah harus lebih dari 0.`)
    const price = r.unit_price === null || r.unit_price === undefined || r.unit_price === '' ? null : Number(r.unit_price)
    if (price !== null && (!Number.isFinite(price) || price < 0 || price > 1e13)) fail(400, `Baris ${i + 1}: harga per satuan tidak valid.`)
    const tanggal = str(r.tanggal, 10)
    if (tanggal && !/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) fail(400, `Baris ${i + 1}: tanggal tidak valid.`)
    return { shift, quantity, unit_price: price, tanggal: tanggal || null, catatan: str(r.catatan, 255) || null }
  })
}
