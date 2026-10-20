import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { handle, requireUser } from '@/lib/api'
import { requireMenu } from '@/lib/customers'
import { db } from '@/lib/db'
import { canViewProduction } from '@/lib/production'

type Row = RowDataPacket & Record<string, unknown>

// Hasil produksi = Penyelesaian Barang Jadi (FGS) dari Accurate: ?periode=YYYY-MM&tanggal=YYYY-MM-DD&q=
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireMenu(user, canViewProduction(user))
  const params = new URL(request.url).searchParams
  const now = new Date(Date.now() + 7 * 3600e3)
  const today = now.toISOString().slice(0, 10)
  const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(params.get('tanggal') ?? '') ? params.get('tanggal')! : ''
  const periode = tanggal ? tanggal.slice(0, 7) : /^\d{4}-\d{2}$/.test(params.get('periode') ?? '') ? params.get('periode')! : today.slice(0, 7)
  const q = (params.get('q') ?? '').trim().slice(0, 100)

  const where = tanggal ? ['f.trans_date = ?'] : ["f.trans_date >= CONCAT(?, '-01')", "f.trans_date < CONCAT(?, '-01') + INTERVAL 1 MONTH"]
  const args: unknown[] = tanggal ? [tanggal] : [periode, periode]
  if (q) {
    where.push('(f.number LIKE ? OR f.wo_number LIKE ? OR mo.number LIKE ? OR i.item_name LIKE ? OR i.item_no LIKE ?)')
    args.push(...Array(5).fill(`%${q}%`))
  }
  const [items] = await db.query<Row[]>(
    `SELECT f.accurate_id AS id, f.number, f.trans_date, f.wo_number, mo.number AS mo_number, mo.name AS mo_name, f.description,
       i.line_id, i.item_no, i.item_name, i.quantity, i.unit, i.warehouse, f.detail_synced_update IS NOT NULL AS detail_synced
     FROM accurate_finished_good_slips f
     LEFT JOIN accurate_finished_good_slip_items i ON i.fgs_accurate_id = f.accurate_id
     LEFT JOIN accurate_manufacture_orders mo ON mo.accurate_id = f.mo_accurate_id
     WHERE ${where.join(' AND ')}
     ORDER BY f.trans_date DESC, f.accurate_id DESC, i.seq LIMIT 500`,
    args,
  )

  // Total per hari dalam bulan (satuan utama) untuk grafik, dan ringkasan
  const [[unit]] = await db.query<Row[]>(
    `SELECT i.unit FROM accurate_finished_good_slip_items i JOIN accurate_finished_good_slips f ON f.accurate_id = i.fgs_accurate_id
     WHERE f.trans_date >= CONCAT(?, '-01') AND f.trans_date < CONCAT(?, '-01') + INTERVAL 1 MONTH AND i.unit IS NOT NULL
     GROUP BY i.unit ORDER BY COUNT(*) DESC LIMIT 1`,
    [periode, periode],
  )
  const satuan = (unit?.unit as string | undefined) ?? 'kg'
  const [days] = await db.query<Row[]>(
    `SELECT DATE_FORMAT(f.trans_date, '%Y-%m-%d') AS tanggal, COUNT(DISTINCT f.accurate_id) AS dokumen, COALESCE(SUM(IF(i.unit = ?, i.quantity, 0)), 0) AS kuantitas
     FROM accurate_finished_good_slips f LEFT JOIN accurate_finished_good_slip_items i ON i.fgs_accurate_id = f.accurate_id
     WHERE f.trans_date >= CONCAT(?, '-01') AND f.trans_date < CONCAT(?, '-01') + INTERVAL 1 MONTH
     GROUP BY f.trans_date ORDER BY f.trans_date`,
    [satuan, periode, periode],
  )
  const [top] = await db.query<Row[]>(
    `SELECT i.item_name, SUM(i.quantity) AS kuantitas FROM accurate_finished_good_slip_items i JOIN accurate_finished_good_slips f ON f.accurate_id = i.fgs_accurate_id
     WHERE f.trans_date >= CONCAT(?, '-01') AND f.trans_date < CONCAT(?, '-01') + INTERVAL 1 MONTH AND i.unit = ?
     GROUP BY i.item_accurate_id, i.item_name ORDER BY kuantitas DESC LIMIT 5`,
    [periode, periode, satuan],
  )
  const [[pending]] = await db.query<Row[]>(
    `SELECT COUNT(*) AS jumlah FROM accurate_finished_good_slips f
     WHERE f.trans_date >= CONCAT(?, '-01') AND f.trans_date < CONCAT(?, '-01') + INTERVAL 1 MONTH AND f.detail_synced_update IS NULL`,
    [periode, periode],
  )

  const perDay = days.map((d) => ({ tanggal: String(d.tanggal), dokumen: Number(d.dokumen), kuantitas: Number(d.kuantitas) }))
  const todayRow = perDay.find((d) => d.tanggal === today)
  return NextResponse.json({
    periode,
    tanggal,
    today,
    satuan,
    items: items.map((r) => ({ ...r, quantity: r.quantity === null ? null : Number(r.quantity), detail_synced: !!r.detail_synced })),
    perDay,
    top: top.map((t) => ({ item_name: t.item_name, kuantitas: Number(t.kuantitas) })),
    stats: {
      dokumen: perDay.reduce((s, d) => s + d.dokumen, 0),
      kuantitas: perDay.reduce((s, d) => s + d.kuantitas, 0),
      hari_ini_dokumen: todayRow?.dokumen ?? 0,
      hari_ini_kuantitas: todayRow?.kuantitas ?? 0,
      belum_lengkap: Number(pending.jumlah),
    },
  })
})
