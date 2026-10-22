import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { deleteMaterial, materialForEdit, readMaterialInput, saveMaterial } from '@/lib/materials'
import { requirePurchasingMenu } from '@/lib/purchasing'
import { requirePurchasingCan } from '@/lib/purchasing-write'

type Ctx = { params: Promise<{ id: string }> }
const itemId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Bahan tidak ditemukan.')

// Isian form ubah, langsung dari Accurate
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requirePurchasingMenu(user, 'harga-bahan')
  return NextResponse.json({ item: await materialForEdit(await itemId(ctx)) })
})

// Ubah bahan di Accurate
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requirePurchasingCan(user, 'price', 'mengubah bahan')
  return NextResponse.json({ item: await saveMaterial(readMaterialInput(await readJson(request)), await itemId(ctx)) })
})

// Hapus di Accurate (bahan yang sudah dipakai transaksi dinonaktifkan)
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requirePurchasingCan(user, 'priceDelete', 'menghapus bahan')
  return NextResponse.json(await deleteMaterial(await itemId(ctx)))
})
