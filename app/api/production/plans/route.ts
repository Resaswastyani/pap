import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { handle, requireUser } from '@/lib/api'
import { requireMenu } from '@/lib/customers'
import { db } from '@/lib/db'
import { canViewProduction } from '@/lib/production'
import { canPlanShifts, loadPlanShifts, shiftSummary } from '@/lib/production-plan-shifts'

type Row = RowDataPacket & Record<string, unknown>
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

// Rencana Produksi (MP) dari Accurate per bulan: ?periode=YYYY-MM&status=berjalan|selesai&q=
// Ditambah pembagian Shift 1/2/3, jumlah, dan nilai Rupiah yang diisi di SIMPAP.
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireMenu(user, canViewProduction(user))
  const params = new URL(request.url).searchParams
  const now = new Date(Date.now() + 7 * 3600e3)
  const periode = /^\d{4}-\d{2}$/.test(params.get('periode') ?? '') ? params.get('periode')! : now.toISOString().slice(0, 7)
  const status = params.get('status') ?? ''
  const q = (params.get('q') ?? '').trim().slice(0, 100)

  const where = ["mo.trans_date >= CONCAT(?, '-01')", "mo.trans_date < CONCAT(?, '-01') + INTERVAL 1 MONTH"]
  const args: unknown[] = [periode, periode]
  if (q) {
    where.push(`(mo.number LIKE ? OR mo.name LIKE ? OR EXISTS (SELECT 1 FROM accurate_manufacture_order_items s WHERE s.mo_accurate_id = mo.accurate_id
      AND (s.item_name LIKE ? OR s.item_no LIKE ? OR s.bom_number LIKE ?)))`)
    args.push(...Array(5).fill(`%${q}%`))
  }
  // Berjalan: masih ada formula yang belum selesai; Selesai: semua formula selesai
  const unfinished = "EXISTS (SELECT 1 FROM accurate_manufacture_order_items u WHERE u.mo_accurate_id = mo.accurate_id AND COALESCE(u.status, '') <> 'FINISHED')"
  const hasLines = 'EXISTS (SELECT 1 FROM accurate_manufacture_order_items h WHERE h.mo_accurate_id = mo.accurate_id)'
  if (status === 'berjalan') where.push(unfinished)
  if (status === 'selesai') where.push(`${hasLines} AND NOT ${unfinished}`)

  const [orders] = await db.query<Row[]>(
    `SELECT mo.accurate_id AS id, mo.number, mo.name, mo.trans_date, mo.start_date, mo.end_date, mo.status, mo.status_name, mo.progress, mo.description,
       mo.detail_synced_update IS NOT NULL AS detail_synced
     FROM accurate_manufacture_orders mo WHERE ${where.join(' AND ')}
     ORDER BY mo.trans_date DESC, mo.accurate_id DESC LIMIT 200`,
    args,
  )
  const ids = orders.map((o) => Number(o.id))
  const [[lines], shifts] = await Promise.all([
    ids.length
      ? db.query<Row[]>(
        `SELECT l.mo_accurate_id, l.line_id, l.seq, l.item_no, l.item_name, l.bom_number, l.quantity, l.unit, l.start_date, l.end_date, l.status, l.status_name, l.progress,
           l.wo_quantity, l.fgs_quantity, l.material_percent, l.notes, NULLIF(it.unit_cost, 0) AS unit_cost
         FROM accurate_manufacture_order_items l LEFT JOIN accurate_items it ON it.accurate_id = l.item_accurate_id
         WHERE l.mo_accurate_id IN (?) ORDER BY l.mo_accurate_id, l.seq, l.line_id`,
        [ids],
      )
      : Promise.resolve([[] as Row[]] as const),
    loadPlanShifts(ids),
  ])

  const month = "mo.trans_date >= CONCAT(?, '-01') AND mo.trans_date < CONCAT(?, '-01') + INTERVAL 1 MONTH"
  const [[[stats]], [units], [[value]], summary] = await Promise.all([
    // Ringkasan bulan (tanpa filter pencarian/status)
    db.query<Row[]>(
      `SELECT COUNT(DISTINCT mo.accurate_id) AS rencana, COUNT(i.line_id) AS formula,
         COALESCE(SUM(COALESCE(i.status, '') <> 'FINISHED' AND i.line_id IS NOT NULL), 0) AS formula_berjalan,
         COUNT(DISTINCT IF(mo.detail_synced_update IS NULL, mo.accurate_id, NULL)) AS belum_lengkap
       FROM accurate_manufacture_orders mo LEFT JOIN accurate_manufacture_order_items i ON i.mo_accurate_id = mo.accurate_id
       WHERE ${month}`,
      [periode, periode],
    ),
    // Kuantitas dijumlah per satuan (kg dan Pcs tidak boleh dicampur); satuan terbanyak dulu
    db.query<Row[]>(
      `SELECT i.unit, SUM(i.quantity) AS kuantitas, SUM(COALESCE(i.fgs_quantity, 0)) AS kuantitas_jadi
       FROM accurate_manufacture_order_items i JOIN accurate_manufacture_orders mo ON mo.accurate_id = i.mo_accurate_id
       WHERE ${month} AND i.unit IS NOT NULL
       GROUP BY i.unit ORDER BY COUNT(*) DESC`,
      [periode, periode],
    ),
    // Nilai rencana: baris yang sudah dibagi shift memakai nilai pembagiannya, sisanya kuantitas x harga pokok barang
    db.query<Row[]>(
      `SELECT SUM(IF(s.n IS NULL, i.quantity * NULLIF(it.unit_cost, 0), s.nilai)) AS nilai,
         COALESCE(SUM(s.n IS NULL AND COALESCE(it.unit_cost, 0) = 0), 0) AS tanpa_harga
       FROM accurate_manufacture_order_items i JOIN accurate_manufacture_orders mo ON mo.accurate_id = i.mo_accurate_id
       LEFT JOIN accurate_items it ON it.accurate_id = i.item_accurate_id
       LEFT JOIN (SELECT ps.mo_accurate_id, ps.line_id, COUNT(*) AS n, SUM(ps.quantity * COALESCE(ps.unit_price, NULLIF(pit.unit_cost, 0))) AS nilai
         FROM production_plan_shifts ps
         LEFT JOIN accurate_manufacture_order_items pl ON pl.mo_accurate_id = ps.mo_accurate_id AND pl.line_id = ps.line_id
         LEFT JOIN accurate_items pit ON pit.accurate_id = pl.item_accurate_id
         GROUP BY ps.mo_accurate_id, ps.line_id) s ON s.mo_accurate_id = i.mo_accurate_id AND s.line_id = i.line_id
       WHERE ${month}`,
      [periode, periode],
    ),
    shiftSummary(periode),
  ])

  return NextResponse.json({
    periode,
    can: { shift: canPlanShifts(user) },
    shift_summary: summary,
    items: orders.map((o) => ({
      ...o,
      progress: n(o.progress),
      detail_synced: !!o.detail_synced,
      lines: lines.filter((l) => l.mo_accurate_id === o.id).map((l) => {
        const list = shifts.get(`${o.id}:${l.line_id}`) ?? []
        const quantity = n(l.quantity)
        const unitCost = n(l.unit_cost)
        // Nilai baris: jumlah nilai pembagian shift bila sudah dibagi, kalau belum kuantitas x harga pokok
        const nilai = list.length
          ? (list.some((s) => s.nilai !== null) ? list.reduce((a, s) => a + (s.nilai ?? 0), 0) : null)
          : quantity !== null && unitCost !== null ? quantity * unitCost : null
        return {
          ...l, quantity, progress: n(l.progress), wo_quantity: n(l.wo_quantity), fgs_quantity: n(l.fgs_quantity), material_percent: n(l.material_percent),
          unit_cost: unitCost, nilai, shifts: list, shift_quantity: list.reduce((a, s) => a + s.quantity, 0),
        }
      }),
    })),
    stats: {
      rencana: Number(stats.rencana), formula: Number(stats.formula), formula_berjalan: Number(stats.formula_berjalan), belum_lengkap: Number(stats.belum_lengkap),
      nilai: Number(value?.nilai) || 0, tanpa_harga: Number(value?.tanpa_harga) || 0,
      per_satuan: units.map((u) => ({ satuan: String(u.unit), kuantitas: Number(u.kuantitas), kuantitas_jadi: Number(u.kuantitas_jadi) })),
    },
  })
})
