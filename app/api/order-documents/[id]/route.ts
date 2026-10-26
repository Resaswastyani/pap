import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { canDeleteDoc, deleteOrderDocument, loadOrderDocument, readDocInput, updateOrderDocument } from '@/lib/order-documents'
import { requireDokumenOrder } from '@/lib/so-document'

type Ctx = { params: Promise<{ id: string }> }
const docId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Dokumen order tidak ditemukan.')

export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireDokumenOrder(user)
  const item = await loadOrderDocument(await docId(ctx))
  return NextResponse.json({ item, can: { delete: canDeleteDoc(user, item) } })
})

export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireDokumenOrder(user)
  await updateOrderDocument(user, await docId(ctx), readDocInput(await readJson(request)))
  return NextResponse.json({ ok: true })
})

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireDokumenOrder(user)
  await deleteOrderDocument(user, await docId(ctx))
  return NextResponse.json({ ok: true })
})
