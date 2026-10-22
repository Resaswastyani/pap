import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { handle, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { requireFaktur } from '@/lib/sales-invoices'

// Cari barang Accurate untuk baris faktur: ?q= + harga jual terakhir dari SO
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireFaktur(user)
  const q = str(new URL(request.url).searchParams.get('q'), 100)
  const like = `%${q}%`
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT it.accurate_id AS id, it.item_no, it.name, it.unit, it.category, NULL AS vendor_price,
       (SELECT s.unit_price FROM accurate_sales_order_items s JOIN accurate_sales_orders o ON o.accurate_id = s.so_accurate_id
        WHERE s.item_accurate_id = it.accurate_id AND s.unit_price > 0 ORDER BY o.trans_date DESC LIMIT 1) AS harga_terakhir
     FROM accurate_items it WHERE it.suspended = 0 AND it.item_no IS NOT NULL ${q ? 'AND (it.name LIKE ? OR it.item_no LIKE ?)' : ''}
     ORDER BY it.name LIMIT 40`,
    q ? [like, like] : [],
  )
  return NextResponse.json({ items: rows.map((r) => ({ ...r, harga_terakhir: r.harga_terakhir === null ? null : Number(r.harga_terakhir) })) })
})
