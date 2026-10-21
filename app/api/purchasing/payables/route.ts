import { NextResponse } from 'next/server'
import { handle, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { n, requirePurchasingMenu, todayWib, type Row } from '@/lib/purchasing'

// Hutang supplier: faktur pembelian Accurate yang belum lunas, urut jatuh tempo.
// ?status=semua|jatuh_tempo|minggu_ini &q=&vendor=
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requirePurchasingMenu(user, 'hutang-supplier')
  const params = new URL(request.url).searchParams
  const status = params.get('status') ?? 'semua'
  const q = (params.get('q') ?? '').trim().slice(0, 100)
  const vendor = Number(params.get('vendor')) || null

  const where = ['pi.owing > 0']
  const args: unknown[] = []
  if (status === 'jatuh_tempo') where.push('pi.due_date < CURDATE()')
  if (status === 'minggu_ini') where.push('pi.due_date >= CURDATE() AND pi.due_date < CURDATE() + INTERVAL 7 DAY')
  if (vendor) where.push('pi.vendor_accurate_id = ?'), args.push(vendor)
  if (q) where.push('(pi.number LIKE ? OR v.name LIKE ?)'), args.push(`%${q}%`, `%${q}%`)
  const [rows] = await db.query<Row[]>(
    `SELECT pi.accurate_id AS id, pi.number, pi.trans_date, pi.due_date, DATEDIFF(pi.due_date, CURDATE()) AS sisa_hari, pi.total_amount, pi.owing, pi.status_name,
       pi.vendor_accurate_id AS vendor_id, v.name AS vendor_name, v.vendor_no
     FROM accurate_purchase_invoices pi LEFT JOIN accurate_vendors v ON v.accurate_id = pi.vendor_accurate_id
     WHERE ${where.join(' AND ')} ORDER BY pi.due_date, pi.accurate_id LIMIT 1000`,
    args,
  )
  const [[s]] = await db.query<Row[]>(
    `SELECT COUNT(*) AS faktur, COALESCE(SUM(owing), 0) AS total, COALESCE(SUM(IF(due_date < CURDATE(), owing, 0)), 0) AS jatuh_tempo,
       COALESCE(SUM(due_date < CURDATE()), 0) AS faktur_jatuh_tempo,
       COALESCE(SUM(IF(due_date >= CURDATE() AND due_date < CURDATE() + INTERVAL 7 DAY, owing, 0)), 0) AS minggu_ini,
       COALESCE(SUM(due_date >= CURDATE() AND due_date < CURDATE() + INTERVAL 7 DAY), 0) AS faktur_minggu_ini,
       COUNT(DISTINCT vendor_accurate_id) AS supplier
     FROM accurate_purchase_invoices WHERE owing > 0`,
  )
  const [perVendor] = await db.query<Row[]>(
    `SELECT pi.vendor_accurate_id AS id, v.name, SUM(pi.owing) AS owing, SUM(IF(pi.due_date < CURDATE(), pi.owing, 0)) AS overdue, COUNT(*) AS faktur
     FROM accurate_purchase_invoices pi LEFT JOIN accurate_vendors v ON v.accurate_id = pi.vendor_accurate_id
     WHERE pi.owing > 0 GROUP BY pi.vendor_accurate_id, v.name ORDER BY owing DESC LIMIT 10`,
  )
  return NextResponse.json({
    today: todayWib(),
    items: rows.map((r) => ({ ...r, sisa_hari: n(r.sisa_hari), total_amount: n(r.total_amount), owing: Number(r.owing) })),
    stats: {
      faktur: Number(s.faktur), total: Number(s.total), jatuh_tempo: Number(s.jatuh_tempo), faktur_jatuh_tempo: Number(s.faktur_jatuh_tempo),
      minggu_ini: Number(s.minggu_ini), faktur_minggu_ini: Number(s.faktur_minggu_ini), supplier: Number(s.supplier),
    },
    perVendor: perVendor.map((v) => ({ id: v.id, name: v.name ?? '—', owing: Number(v.owing), overdue: Number(v.overdue), faktur: Number(v.faktur) })),
  })
})
