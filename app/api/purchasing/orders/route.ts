import { NextResponse } from 'next/server'
import { handle, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { n, PO_OPEN, requirePurchasingMenu, todayWib, type Row } from '@/lib/purchasing'
import { createPo, purchasingCan, readPoInput, requirePurchasingCan } from '@/lib/purchasing-write'

// PO pembelian dari Accurate: ?periode=YYYY-MM (per bulan) | ?status=terbuka|terlambat (semua tanggal) &q=&vendor=
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requirePurchasingMenu(user, 'po-pembelian', 'supplier')
  const params = new URL(request.url).searchParams
  const today = todayWib()
  const periode = /^\d{4}-\d{2}$/.test(params.get('periode') ?? '') ? params.get('periode')! : today.slice(0, 7)
  const status = params.get('status') ?? ''
  const q = (params.get('q') ?? '').trim().slice(0, 100)
  const vendor = Number(params.get('vendor')) || null

  const where: string[] = []
  const args: unknown[] = []
  if (status === 'terbuka') where.push(PO_OPEN)
  else if (status === 'terlambat') where.push(PO_OPEN, 'po.ship_date < CURDATE()')
  else {
    where.push("po.trans_date >= CONCAT(?, '-01')", "po.trans_date < CONCAT(?, '-01') + INTERVAL 1 MONTH")
    args.push(periode, periode)
    if (status === 'diterima') where.push(`NOT (${PO_OPEN})`)
  }
  if (vendor) where.push('po.vendor_accurate_id = ?'), args.push(vendor)
  if (q) {
    where.push(`(po.number LIKE ? OR v.name LIKE ? OR EXISTS (SELECT 1 FROM accurate_purchase_order_items s WHERE s.po_accurate_id = po.accurate_id
      AND (s.item_name LIKE ? OR s.item_no LIKE ?)))`)
    args.push(...Array(4).fill(`%${q}%`))
  }
  const [orders] = await db.query<Row[]>(
    `SELECT po.accurate_id AS id, po.number, po.trans_date, po.ship_date, po.vendor_accurate_id AS vendor_id, v.name AS vendor_name, po.total_amount,
       po.status, po.status_name, po.percent_shipped, po.detail_synced_update IS NOT NULL AS detail_synced,
       (${PO_OPEN}) AS terbuka, (${PO_OPEN}) AND po.ship_date < CURDATE() AS terlambat
     FROM accurate_purchase_orders po LEFT JOIN accurate_vendors v ON v.accurate_id = po.vendor_accurate_id
     WHERE ${where.join(' AND ')}
     ORDER BY ${status ? 'po.ship_date, po.trans_date' : 'po.trans_date DESC'}, po.accurate_id DESC LIMIT 500`,
    args,
  )
  const ids = orders.map((o) => o.id)
  const [lines] = ids.length
    ? await db.query<Row[]>(
      `SELECT po_accurate_id, line_id, item_no, item_name, quantity, unit, unit_price, total_price, quantity_shipped
       FROM accurate_purchase_order_items WHERE po_accurate_id IN (?) ORDER BY po_accurate_id, seq, line_id`,
      [ids],
    )
    : [[] as Row[]]

  // Ringkasan: bulan terpilih + PO yang masih menunggu barang (semua tanggal)
  const [[month]] = await db.query<Row[]>(
    `SELECT COUNT(*) AS po, COALESCE(SUM(total_amount), 0) AS nilai, COUNT(DISTINCT vendor_accurate_id) AS supplier
     FROM accurate_purchase_orders WHERE trans_date >= CONCAT(?, '-01') AND trans_date < CONCAT(?, '-01') + INTERVAL 1 MONTH`,
    [periode, periode],
  )
  const [[open]] = await db.query<Row[]>(
    `SELECT COUNT(*) AS terbuka, COALESCE(SUM(po.ship_date < CURDATE()), 0) AS terlambat, COALESCE(SUM((SELECT SUM(GREATEST(COALESCE(i.quantity, 0) - COALESCE(i.quantity_shipped, 0), 0) * COALESCE(i.unit_price, 0))
       FROM accurate_purchase_order_items i WHERE i.po_accurate_id = po.accurate_id)), 0) AS nilai_terbuka, MIN(po.trans_date) AS tertua
     FROM accurate_purchase_orders po WHERE ${PO_OPEN}`,
  )
  const [vendors] = await db.query<Row[]>('SELECT accurate_id AS id, name FROM accurate_vendors ORDER BY name')

  return NextResponse.json({
    periode,
    today,
    items: orders.map((o) => ({
      ...o, total_amount: n(o.total_amount), percent_shipped: n(o.percent_shipped), detail_synced: !!o.detail_synced, terbuka: !!o.terbuka, terlambat: !!o.terlambat,
      lines: lines.filter((l) => l.po_accurate_id === o.id).map((l) => ({
        ...l, quantity: n(l.quantity), unit_price: n(l.unit_price), total_price: n(l.total_price), quantity_shipped: n(l.quantity_shipped),
      })),
    })),
    stats: {
      po: Number(month.po), nilai: Number(month.nilai), supplier: Number(month.supplier),
      terbuka: Number(open.terbuka), terlambat: Number(open.terlambat), nilai_terbuka: Number(open.nilai_terbuka), tertua: open.tertua ?? null,
    },
    vendors,
    can: (({ poCreate, poUpdate, poDelete }) => ({ create: poCreate, update: poUpdate, delete: poDelete }))(purchasingCan(user)),
  })
})

// Buat PO baru: dikirim ke Accurate (save.do), lalu disimpan dari detail Accurate
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requirePurchasingCan(user, 'poCreate', 'membuat PO pembelian')
  return NextResponse.json(await createPo(readPoInput(await readJson(request)), user.id))
})
