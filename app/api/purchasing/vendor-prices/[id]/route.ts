import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { requirePurchasingMenu } from '@/lib/purchasing'
import { requirePurchasingCan } from '@/lib/purchasing-write'
import { deleteVendorPrice, readVendorPriceInput, saveVendorPrice, vendorPriceDetail } from '@/lib/vendor-prices'

type Ctx = { params: Promise<{ id: string }> }
const docId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Harga pemasok tidak ditemukan.')

export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requirePurchasingMenu(user, 'harga-bahan')
  return NextResponse.json({ item: await vendorPriceDetail(await docId(ctx)) })
})

export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requirePurchasingCan(user, 'price', 'mengubah harga pemasok')
  return NextResponse.json(await saveVendorPrice(readVendorPriceInput(await readJson(request)), await docId(ctx)))
})

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requirePurchasingCan(user, 'priceDelete', 'menghapus harga pemasok')
  return NextResponse.json({ ok: true, ...(await deleteVendorPrice(await docId(ctx))) })
})
