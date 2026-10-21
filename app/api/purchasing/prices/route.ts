import { NextResponse } from 'next/server'
import { handle, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { n, requirePurchasingMenu, type Row } from '@/lib/purchasing'

// Database harga bahan: harga beli terakhir per barang dari baris PO Accurate, dibanding pembelian sebelumnya
// dan rentang 12 bulan. ?q=&kategori=&berubah=naik|turun
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requirePurchasingMenu(user, 'harga-bahan')
  const params = new URL(request.url).searchParams
  const q = (params.get('q') ?? '').trim().slice(0, 100)
  const kategori = (params.get('kategori') ?? '').trim().slice(0, 150)

  const where = ['h.rn = 1']
  const args: unknown[] = []
  if (q) where.push('(h.item_name LIKE ? OR h.item_no LIKE ? OR v.name LIKE ?)'), args.push(`%${q}%`, `%${q}%`, `%${q}%`)
  if (kategori) where.push('it.category = ?'), args.push(kategori)
  const [rows] = await db.query<Row[]>(
    `WITH h AS (
       SELECT i.item_accurate_id, i.item_no, i.item_name, i.unit, i.unit_price, po.trans_date, po.number, po.vendor_accurate_id,
         ROW_NUMBER() OVER (PARTITION BY i.item_accurate_id ORDER BY po.trans_date DESC, po.accurate_id DESC, i.line_id DESC) AS rn,
         LEAD(i.unit_price) OVER (PARTITION BY i.item_accurate_id ORDER BY po.trans_date DESC, po.accurate_id DESC, i.line_id DESC) AS prev_price,
         LEAD(po.trans_date) OVER (PARTITION BY i.item_accurate_id ORDER BY po.trans_date DESC, po.accurate_id DESC, i.line_id DESC) AS prev_date,
         COUNT(*) OVER (PARTITION BY i.item_accurate_id) AS pembelian
       FROM accurate_purchase_order_items i JOIN accurate_purchase_orders po ON po.accurate_id = i.po_accurate_id
       WHERE i.item_accurate_id IS NOT NULL AND i.unit_price > 0
     ), r AS (
       SELECT i.item_accurate_id, MIN(i.unit_price) AS min_12m, MAX(i.unit_price) AS max_12m, SUM(i.total_price) / NULLIF(SUM(i.quantity), 0) AS avg_12m,
         COUNT(DISTINCT po.vendor_accurate_id) AS supplier_12m
       FROM accurate_purchase_order_items i JOIN accurate_purchase_orders po ON po.accurate_id = i.po_accurate_id
       WHERE i.unit_price > 0 AND po.trans_date >= CURDATE() - INTERVAL 12 MONTH GROUP BY i.item_accurate_id
     )
     SELECT h.item_accurate_id AS id, h.item_no, h.item_name, COALESCE(it.unit, h.unit) AS unit, h.unit AS po_unit, it.category,
       h.unit_price AS harga, h.trans_date AS tanggal, h.number AS po_number, v.name AS vendor_name, h.prev_price, h.prev_date, h.pembelian,
       r.min_12m, r.max_12m, r.avg_12m, r.supplier_12m
     FROM h LEFT JOIN r ON r.item_accurate_id = h.item_accurate_id
     LEFT JOIN accurate_items it ON it.accurate_id = h.item_accurate_id
     LEFT JOIN accurate_vendors v ON v.accurate_id = h.vendor_accurate_id
     WHERE ${where.join(' AND ')}
     ORDER BY h.trans_date DESC, h.item_name LIMIT 2000`,
    args,
  )
  const [categories] = await db.query<Row[]>(
    `SELECT DISTINCT it.category FROM accurate_purchase_order_items i JOIN accurate_items it ON it.accurate_id = i.item_accurate_id
     WHERE it.category IS NOT NULL ORDER BY it.category`,
  )
  const items = rows.map((r) => {
    const harga = Number(r.harga)
    const prev = n(r.prev_price)
    return {
      ...(r as Record<string, unknown>), tanggal: r.tanggal as string | null, harga, prev_price: prev, pembelian: Number(r.pembelian), min_12m: n(r.min_12m), max_12m: n(r.max_12m), avg_12m: n(r.avg_12m), supplier_12m: n(r.supplier_12m),
      perubahan: prev ? Math.round(((harga - prev) / prev) * 1000) / 10 : null,
    }
  })
  const berubah = params.get('berubah')
  return NextResponse.json({
    items: berubah === 'naik' ? items.filter((i) => (i.perubahan ?? 0) > 0) : berubah === 'turun' ? items.filter((i) => (i.perubahan ?? 0) < 0) : items,
    stats: {
      barang: items.length,
      naik: items.filter((i) => (i.perubahan ?? 0) > 0).length,
      turun: items.filter((i) => (i.perubahan ?? 0) < 0).length,
      bulan_ini: items.filter((i) => String(i.tanggal ?? '').slice(0, 7) === new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7)).length,
    },
    categories: categories.map((c) => String(c.category)),
  })
})
