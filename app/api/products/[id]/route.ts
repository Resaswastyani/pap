import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { canManageProduct, canViewProducts, requireMenu } from '@/lib/customers'
import { db } from '@/lib/db'
import { loadProduct, loadProductFiles, loadProductOrders, readProductInput } from '@/lib/products'

type Ctx = { params: Promise<{ id: string }> }
const productId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Produk tidak ditemukan.')

export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireMenu(user, canViewProducts(user))
  const item = await loadProduct(await productId(ctx))
  // Semua customer yang pernah memesan produk ini
  const [buyers] = item.accurate_item_id
    ? await db.query<RowDataPacket[]>(
        `SELECT c.id, c.name, c.customer_no, COUNT(DISTINCT so.accurate_id) AS order_count, MAX(so.trans_date) AS last_order
         FROM accurate_sales_order_items soi JOIN accurate_sales_orders so ON so.accurate_id = soi.so_accurate_id
         JOIN customers c ON c.accurate_id = so.customer_accurate_id
         WHERE soi.item_accurate_id = ? GROUP BY c.id ORDER BY order_count DESC, last_order DESC LIMIT 20`,
        [item.accurate_item_id],
      )
    : [[]]
  return NextResponse.json({
    item,
    files: await loadProductFiles(item.id),
    orders: await loadProductOrders(item.accurate_item_id),
    buyers: buyers.map((b) => ({ ...b, order_count: Number(b.order_count) })),
    canManage: canManageProduct(user),
  })
})

export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  if (!canManageProduct(user)) fail(403, 'Anda tidak punya akses untuk mengedit produk.')
  const item = await loadProduct(await productId(ctx))
  const input = readProductInput(await readJson(request))
  await db.query(
    `UPDATE customer_products SET kode = ?, nama = ?, jenis = ?, spesifikasi = ?, bahan = ?, keterangan = ?, status = ?, updated_by = ? WHERE id = ?`,
    [input.kode, input.nama, input.jenis, input.spesifikasi, input.bahan, input.keterangan, input.status, user.id, item.id],
  )
  return NextResponse.json({ item: await loadProduct(item.id) })
})

// Produk dari Accurate tidak dihapus (akan muncul lagi saat sinkron); jadikan nonaktif saja
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  if (!canManageProduct(user)) fail(403, 'Anda tidak punya akses untuk menghapus produk.')
  const item = await loadProduct(await productId(ctx))
  if (item.accurate_item_id) fail(400, 'Produk dari Accurate tidak bisa dihapus. Ubah statusnya menjadi nonaktif.')
  await db.query('DELETE FROM customer_products WHERE id = ?', [item.id])
  return NextResponse.json({ ok: true })
})
