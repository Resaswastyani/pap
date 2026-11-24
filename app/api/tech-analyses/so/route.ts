import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canPpicSection, requireTechAnalysis } from '@/lib/tech-analysis'

// Sales Order Accurate untuk pengajuan analisa teknik PPIC: ?q= cari nomor SO / customer / barang (180 hari terakhir),
// ?id= satu SO beserta barangnya (customer & produk terisi dari SO; data produk SIMPAP ikut bila ada)
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireTechAnalysis(user)
  if (!canPpicSection(user)) fail(403, 'Pengajuan dari Sales Order dibuat oleh PPIC.')
  const p = new URL(request.url).searchParams
  const id = int(p.get('id'))
  if (id) {
    const [[so]] = await db.query<RowDataPacket[]>(
      `SELECT so.accurate_id AS id, so.number, DATE_FORMAT(so.trans_date, '%Y-%m-%d') AS tanggal, so.status, c.id AS customer_id, c.name AS customer_name, c.customer_no
       FROM accurate_sales_orders so LEFT JOIN customers c ON c.accurate_id = so.customer_accurate_id WHERE so.accurate_id = ?`, [id],
    )
    if (!so) fail(404, 'Sales Order tidak ditemukan. Sinkronkan Sales Order Accurate dulu.')
    const [lines] = await db.query<RowDataPacket[]>(
      `SELECT i.line_id, i.item_accurate_id, i.item_no, i.item_name, i.quantity, i.unit, i.notes,
         cp.id AS product_id, cp.jenis, cp.spesifikasi,
         (SELECT a.nomor FROM prospect_tech_analyses a WHERE a.so_accurate_id = i.so_accurate_id AND a.nama_produk = i.item_name ORDER BY a.id DESC LIMIT 1) AS sudah_diajukan
       FROM accurate_sales_order_items i LEFT JOIN customer_products cp ON cp.accurate_item_id = i.item_accurate_id
       WHERE i.so_accurate_id = ? ORDER BY i.line_id`, [id],
    )
    return NextResponse.json({ item: { ...so, lines: lines.map((l) => ({ ...l, quantity: l.quantity === null ? null : Number(l.quantity) })) } })
  }
  const q = str(p.get('q'), 100)
  const where = ['so.trans_date >= CURDATE() - INTERVAL 180 DAY']
  const args: unknown[] = []
  if (q) {
    where.push('(so.number LIKE ? OR c.name LIKE ? OR EXISTS (SELECT 1 FROM accurate_sales_order_items i WHERE i.so_accurate_id = so.accurate_id AND i.item_name LIKE ?))')
    args.push(`%${q}%`, `%${q}%`, `%${q}%`)
  }
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT so.accurate_id AS id, so.number, DATE_FORMAT(so.trans_date, '%Y-%m-%d') AS tanggal, so.status, c.name AS customer_name,
       (SELECT COUNT(*) FROM accurate_sales_order_items i WHERE i.so_accurate_id = so.accurate_id) AS baris,
       (SELECT GROUP_CONCAT(i.item_name ORDER BY i.line_id SEPARATOR ' · ') FROM accurate_sales_order_items i WHERE i.so_accurate_id = so.accurate_id) AS barang
     FROM accurate_sales_orders so LEFT JOIN customers c ON c.accurate_id = so.customer_accurate_id
     WHERE ${where.join(' AND ')} ORDER BY so.trans_date DESC, so.accurate_id DESC LIMIT 40`, args,
  )
  return NextResponse.json({ items: rows.map((r) => ({ ...r, baris: Number(r.baris) })) })
})
