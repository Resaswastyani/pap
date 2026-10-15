import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { canManageProduct, canViewProducts, loadCustomer, requireMenu } from '@/lib/customers'
import { db } from '@/lib/db'
import { loadProduct, PRODUCT_OF_CUSTOMER, PRODUCT_SELECT, productJenisList, readProductInput, serializeProduct } from '@/lib/products'

// Daftar produk (Marketing, PPIC, Produksi, Purchasing, Keuangan).
// Produk dari Accurate dibuat otomatis dari barang yang pernah dipesan lewat Sales Order.
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireMenu(user, canViewProducts(user))
  const params = new URL(request.url).searchParams
  const where: string[] = []
  const args: unknown[] = []
  const q = str(params.get('q'), 100)
  if (q) where.push('(p.nama LIKE ? OR p.kode LIKE ? OR c.name LIKE ? OR p.spesifikasi LIKE ? OR p.bahan LIKE ?)'), args.push(...Array(5).fill(`%${q}%`))
  const customer = int(params.get('customer'))
  if (customer) where.push(PRODUCT_OF_CUSTOMER), args.push(customer, customer)
  const jenis = str(params.get('jenis'), 80)
  if (jenis) where.push('p.jenis = ?'), args.push(jenis)
  const status = params.get('status')
  if (status === 'aktif' || status === 'nonaktif') where.push('p.status = ?'), args.push(status)
  if (params.get('lengkap') === '0') where.push("(p.spesifikasi IS NULL OR p.spesifikasi = '' OR NOT EXISTS (SELECT 1 FROM customer_product_files f WHERE f.product_id = p.id))")
  const page = Math.max(1, int(params.get('page')) ?? 1)
  const pageSize = 50
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''
  const [items] = await db.query<RowDataPacket[]>(
    `${PRODUCT_SELECT} ${whereSql} ORDER BY (last_order IS NULL), last_order DESC, p.updated_at DESC LIMIT ? OFFSET ?`,
    [...args, pageSize, (page - 1) * pageSize],
  )
  const [[{ total }]] = await db.query<(RowDataPacket & { total: number })[]>(
    `SELECT COUNT(*) AS total FROM customer_products p LEFT JOIN customers c ON c.id = p.customer_id ${whereSql}`,
    args,
  )
  return NextResponse.json({
    items: items.map(serializeProduct),
    total: Number(total),
    page,
    pageSize,
    jenis: await productJenisList(),
    canManage: canManageProduct(user),
  })
})

// Tambah produk manual (mis. produk baru yang belum ada di Accurate)
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
