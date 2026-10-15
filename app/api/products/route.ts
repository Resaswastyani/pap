import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { canManageProduct, canViewProducts, loadCustomer, requireMenu } from '@/lib/customers'
import { db } from '@/lib/db'
import { loadProduct, PRODUCT_JENIS, PRODUCT_SELECT, readProductInput } from '@/lib/products'

// Daftar produk semua customer (Marketing, PPIC, Produksi, Purchasing, Keuangan)
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireMenu(user, canViewProducts(user))
  const params = new URL(request.url).searchParams
  const where: string[] = []
  const args: unknown[] = []
  const q = str(params.get('q'), 100)
  if (q) where.push('(p.nama LIKE ? OR p.kode LIKE ? OR c.name LIKE ? OR p.spesifikasi LIKE ? OR p.bahan LIKE ?)'), args.push(...Array(5).fill(`%${q}%`))
  const customer = int(params.get('customer'))
  if (customer) where.push('p.customer_id = ?'), args.push(customer)
  const jenis = str(params.get('jenis'), 80)
  if (jenis) where.push('p.jenis = ?'), args.push(jenis)
  const status = params.get('status')
  if (status === 'aktif' || status === 'nonaktif') where.push('p.status = ?'), args.push(status)
  const [items] = await db.query<RowDataPacket[]>(
    `${PRODUCT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.updated_at DESC LIMIT 300`,
    args,
  )
  return NextResponse.json({
    items: items.map((row) => ({ ...row, file_count: Number(row.file_count) })),
    jenis: PRODUCT_JENIS,
    canManage: canManageProduct(user),
  })
})

// Tambah produk untuk customer
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  if (!canManageProduct(user)) fail(403, 'Anda tidak punya akses untuk menambah produk.')
  const body = await readJson(request)
  const customer = await loadCustomer(int(body.customer_id) ?? fail(400, 'Customer wajib dipilih.'))
  const input = readProductInput(body)
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO customer_products (customer_id, kode, nama, jenis, spesifikasi, bahan, keterangan, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [customer.id, input.kode, input.nama, input.jenis, input.spesifikasi, input.bahan, input.keterangan, input.status, user.id],
  )
  return NextResponse.json({ item: await loadProduct(result.insertId) }, { status: 201 })
})
