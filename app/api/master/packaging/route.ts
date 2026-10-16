import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageMaster, readPackagingInput, requireMaster } from '@/lib/master'

// Master produk packaging (PE, HD, PP, ...): semua divisi melihat, Admin/Super Admin mengelola
export const GET = handle(async () => {
  const user = await requireUser()
  requireMaster(user)
  const [items] = await db.query<RowDataPacket[]>(
    `SELECT t.*, u.name AS updated_by_name,
       (SELECT COUNT(*) FROM customer_products p WHERE p.jenis = t.kode OR p.jenis = t.nama) AS product_count
     FROM packaging_types t LEFT JOIN users u ON u.id = t.updated_by ORDER BY t.status, t.sort_order, t.nama`,
  )
  return NextResponse.json({ items: items.map((t) => ({ ...t, product_count: Number(t.product_count) })), canManage: canManageMaster(user) })
})

export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  if (!canManageMaster(user)) fail(403, 'Hanya Admin / Super Admin yang dapat mengubah master data.')
  const input = readPackagingInput(await readJson(request))
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO packaging_types (kode, nama, bahan, proses, ketebalan, kegunaan, keterangan, status, sort_order, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(t.sort_order), 0) + 1 FROM packaging_types t), ?)`,
    [input.kode, input.nama, input.bahan, input.proses, input.ketebalan, input.kegunaan, input.keterangan, input.status, user.id],
  )
  return NextResponse.json({ id: result.insertId }, { status: 201 })
})
