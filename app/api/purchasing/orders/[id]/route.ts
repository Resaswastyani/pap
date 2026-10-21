import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { requirePurchasingMenu } from '@/lib/purchasing'
import { deletePo, poForEdit, readPoInput, requirePurchasingCan, updatePo } from '@/lib/purchasing-write'

type Ctx = { params: Promise<{ id: string }> }
const poId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'PO tidak ditemukan.')

// Isi PO terbaru langsung dari Accurate (untuk form ubah)
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requirePurchasingMenu(user, 'po-pembelian')
  return NextResponse.json({ item: await poForEdit(await poId(ctx)) })
})

// Ubah PO di Accurate (hanya bila belum ada penerimaan barang)
export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requirePurchasingCan(user, 'poUpdate', 'mengubah PO pembelian')
  return NextResponse.json(await updatePo(await poId(ctx), readPoInput(await readJson(request)), user.id))
})

// Hapus PO di Accurate (hanya bila belum ada penerimaan barang)
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requirePurchasingCan(user, 'poDelete', 'menghapus PO pembelian')
  return NextResponse.json({ ok: true, ...(await deletePo(await poId(ctx))) })
})
