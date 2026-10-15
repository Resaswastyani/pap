import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { PRODUCT_OF_CUSTOMER } from '@/lib/products'
import { canManageCustomer, canManageProduct, canViewCustomers, canViewProducts, loadCustomer, readCustomerInput, refreshCustomerFromAccurate, requireMenu, saveCustomerToAccurate, upsertLocalCustomer, type CustomerInput } from '@/lib/customers'

type Ctx = { params: Promise<{ id: string }> }
const customerId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Customer tidak ditemukan.')

// Detail customer: data Accurate, ringkasan CRM, faktur terakhir, dan produk
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireMenu(user, canViewCustomers(user) || canViewProducts(user))
  let customer = await loadCustomer(await customerId(ctx))
  // Ambil detail terbaru (termasuk alamat) dari Accurate setiap kali customer dibuka
  if (await refreshCustomerFromAccurate(customer.accurate_id)) customer = await loadCustomer(customer.id)
  const [invoices] = customer.accurate_id
    ? await db.query<RowDataPacket[]>(
        'SELECT accurate_id, number, trans_date, total_amount, status FROM accurate_sales_invoices WHERE customer_accurate_id = ? ORDER BY trans_date DESC, accurate_id DESC LIMIT 20',
        [customer.accurate_id],
      )
    : [[]]
  // Produk yang pernah dipesan customer ini (Sales Order Accurate) + produk manual miliknya
  const [products] = await db.query<RowDataPacket[]>(
    `SELECT p.id, p.kode, p.nama, p.jenis, p.status, p.updated_at, (SELECT COUNT(*) FROM customer_product_files f WHERE f.product_id = p.id) AS file_count,
       (SELECT MAX(so.trans_date) FROM accurate_sales_order_items soi JOIN accurate_sales_orders so ON so.accurate_id = soi.so_accurate_id
        WHERE soi.item_accurate_id = p.accurate_item_id AND so.customer_accurate_id = ?) AS last_order
     FROM customer_products p WHERE ${PRODUCT_OF_CUSTOMER} ORDER BY p.status, (last_order IS NULL), last_order DESC, p.nama LIMIT 100`,
    [customer.accurate_id, customer.id, customer.id],
  )
  return NextResponse.json({
    item: { ...customer, order_count: Number(customer.order_count), total_amount: Number(customer.total_amount) },
    invoices: invoices.map((row) => ({ ...row, total_amount: row.total_amount === null ? null : Number(row.total_amount) })),
    products: products.map((row) => ({ ...row, file_count: Number(row.file_count) })),
    can: { edit: canManageCustomer(user), product: canManageProduct(user) },
  })
})

// Edit customer: disimpan ke Accurate dulu, lalu ke database PAP-MS
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  if (!canManageCustomer(user)) fail(403, 'Anda tidak punya akses untuk mengedit customer.')
  const id = await customerId(ctx)
  const input = readCustomerInput(await readJson(request))
  // Bandingkan dengan data terbaru dari Accurate; hanya field yang berubah yang dikirim
  await refreshCustomerFromAccurate((await loadCustomer(id)).accurate_id)
  const customer = await loadCustomer(id)
  const saved = await saveCustomerToAccurate(input, customer.accurate_id, customer as Partial<CustomerInput>)
  await upsertLocalCustomer(input, saved.accurateId, saved.customerNo ?? customer.customer_no)
  return NextResponse.json({ item: await loadCustomer(customer.id) })
})
