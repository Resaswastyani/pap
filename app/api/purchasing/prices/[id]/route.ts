import { NextResponse } from 'next/server'
import { fail, handle, int, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { n, requirePurchasingMenu, type Row } from '@/lib/purchasing'

type Ctx = { params: Promise<{ id: string }> }

// Riwayat harga satu barang: semua pembelian (PO) + perbandingan harga per supplier
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requirePurchasingMenu(user, 'harga-bahan')
  const id = int((await ctx.params).id) ?? fail(404, 'Barang tidak ditemukan.')
  const [history] = await db.query<Row[]>(
    `SELECT po.accurate_id AS po_id, po.number, po.trans_date, v.name AS vendor_name, po.vendor_accurate_id AS vendor_id,
       i.item_no, i.item_name, i.quantity, i.unit, i.unit_price, i.total_price
     FROM accurate_purchase_order_items i JOIN accurate_purchase_orders po ON po.accurate_id = i.po_accurate_id
     LEFT JOIN accurate_vendors v ON v.accurate_id = po.vendor_accurate_id
     WHERE i.item_accurate_id = ? AND i.unit_price > 0
     ORDER BY po.trans_date DESC, po.accurate_id DESC, i.line_id DESC LIMIT 200`,
    [id],
  )
  if (!history.length) fail(404, 'Belum ada riwayat pembelian untuk barang ini.')
  const [[item]] = await db.query<Row[]>('SELECT item_no, name, category, unit, quantity_on_hand FROM accurate_items WHERE accurate_id = ?', [id])
  const rows = history.map((h) => Object.assign({}, h as Record<string, unknown>, { quantity: n(h.quantity), unit_price: Number(h.unit_price), total_price: n(h.total_price) }))
  // Per supplier: harga terakhir, termurah, jumlah pembelian
  const perVendor = new Map<string, { vendor_name: string; terakhir: number; tanggal: string; termurah: number; pembelian: number }>()
  for (const r of rows) {
    const key = String(r.vendor_id ?? r.vendor_name)
    const cur = perVendor.get(key)
    if (!cur) perVendor.set(key, { vendor_name: String(r.vendor_name ?? '—'), terakhir: r.unit_price, tanggal: String(r.trans_date), termurah: r.unit_price, pembelian: 1 })
    else {
      cur.termurah = Math.min(cur.termurah, r.unit_price)
      cur.pembelian++
    }
  }
  return NextResponse.json({
    item: { id, item_no: item?.item_no ?? rows[0].item_no, name: item?.name ?? rows[0].item_name, category: item?.category ?? null, unit: item?.unit ?? rows[0].unit, stok: n(item?.quantity_on_hand) },
    history: rows,
    vendors: [...perVendor.values()].sort((a, b) => a.terakhir - b.terakhir),
  })
})
