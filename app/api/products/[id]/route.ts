import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { canManageProduct, canViewProducts, requireMenu } from '@/lib/customers'
import { db } from '@/lib/db'
import { loadProduct, loadProductFiles, readProductInput } from '@/lib/products'

type Ctx = { params: Promise<{ id: string }> }
const productId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Produk tidak ditemukan.')

export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireMenu(user, canViewProducts(user))
  const item = await loadProduct(await productId(ctx))
  return NextResponse.json({ item, files: await loadProductFiles(item.id), canManage: canManageProduct(user) })
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

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  if (!canManageProduct(user)) fail(403, 'Anda tidak punya akses untuk menghapus produk.')
  const item = await loadProduct(await productId(ctx))
  await db.query('DELETE FROM customer_products WHERE id = ?', [item.id])
  return NextResponse.json({ ok: true })
})
