import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { handle, requireUser } from '@/lib/api'
import { requireMenu } from '@/lib/customers'
import { db } from '@/lib/db'
import { canViewProduction } from '@/lib/production'

type Row = RowDataPacket & Record<string, unknown>
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

// Rencana Produksi (MP) dari Accurate per bulan: ?periode=YYYY-MM&status=berjalan|selesai&q=
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
  const ids = orders.map((o) => o.id)
  const [lines] = ids.length
    ? await db.query<Row[]>(
      `SELECT mo_accurate_id, line_id, seq, item_no, item_name, bom_number, quantity, unit, start_date, end_date, status, status_name, progress,
         wo_quantity, fgs_quantity, material_percent, notes
       FROM accurate_manufacture_order_items WHERE mo_accurate_id IN (?) ORDER BY mo_accurate_id, seq, line_id`,
      [ids],
    )
    : [[] as Row[]]

  // Ringkasan bulan (tanpa filter pencarian/status)
  const [[stats]] = await db.query<Row[]>(
    `SELECT COUNT(DISTINCT mo.accurate_id) AS rencana, COUNT(i.line_id) AS formula,
       COALESCE(SUM(COALESCE(i.status, '') <> 'FINISHED' AND i.line_id IS NOT NULL), 0) AS formula_berjalan,
       COUNT(DISTINCT IF(mo.detail_synced_update IS NULL, mo.accurate_id, NULL)) AS belum_lengkap
     FROM accurate_manufacture_orders mo LEFT JOIN accurate_manufacture_order_items i ON i.mo_accurate_id = mo.accurate_id
     WHERE mo.trans_date >= CONCAT(?, '-01') AND mo.trans_date < CONCAT(?, '-01') + INTERVAL 1 MONTH`,
    [periode, periode],
  )
  // Kuantitas dijumlah per satuan (kg dan Pcs tidak boleh dicampur); satuan terbanyak dulu
  const [units] = await db.query<Row[]>(
    `SELECT i.unit, SUM(i.quantity) AS kuantitas, SUM(COALESCE(i.fgs_quantity, 0)) AS kuantitas_jadi
     FROM accurate_manufacture_order_items i JOIN accurate_manufacture_orders mo ON mo.accurate_id = i.mo_accurate_id
     WHERE mo.trans_date >= CONCAT(?, '-01') AND mo.trans_date < CONCAT(?, '-01') + INTERVAL 1 MONTH AND i.unit IS NOT NULL
     GROUP BY i.unit ORDER BY COUNT(*) DESC`,
    [periode, periode],
  )

  return NextResponse.json({
    periode,
    items: orders.map((o) => ({
      ...o,
      progress: n(o.progress),
      detail_synced: !!o.detail_synced,
      lines: lines.filter((l) => l.mo_accurate_id === o.id).map((l) => ({
        ...l, quantity: n(l.quantity), progress: n(l.progress), wo_quantity: n(l.wo_quantity), fgs_quantity: n(l.fgs_quantity), material_percent: n(l.material_percent),
      })),
    })),
    stats: {
      rencana: Number(stats.rencana), formula: Number(stats.formula), formula_berjalan: Number(stats.formula_berjalan), belum_lengkap: Number(stats.belum_lengkap),
      per_satuan: units.map((u) => ({ satuan: String(u.unit), kuantitas: Number(u.kuantitas), kuantitas_jadi: Number(u.kuantitas_jadi) })),
    },
  })
})
