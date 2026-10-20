import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { handle, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { requireFormulations } from '@/lib/formulations'

// Cari produk customer (Data Produk) untuk dihubungkan ke formulasi: ?q=
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireFormulations(user)
  const q = str(new URL(request.url).searchParams.get('q'), 100)
  if (q.length < 2) return NextResponse.json({ items: [] })
  const [items] = await db.query<RowDataPacket[]>(
    `SELECT p.id, p.nama, p.kode, p.jenis, c.name AS customer_name FROM customer_products p LEFT JOIN customers c ON c.id = p.customer_id
     WHERE p.status = 'aktif' AND (p.nama LIKE ? OR p.kode LIKE ? OR c.name LIKE ?) ORDER BY p.nama LIMIT 20`,
    Array(3).fill(`%${q}%`),
  )
  return NextResponse.json({ items })
})
