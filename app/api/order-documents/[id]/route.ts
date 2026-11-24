import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { canDeleteDoc, deleteOrderDocument, loadOrderDocument, readDocInput, requireOrderDocAccess, updateOrderDocument } from '@/lib/order-documents'
import { syncOrderDocChecklists } from '@/lib/order-custom'
import { requireDokumenOrder } from '@/lib/so-document'

type Ctx = { params: Promise<{ id: string }> }
const docId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Dokumen order tidak ditemukan.')

export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  const item = await loadOrderDocument(await docId(ctx))
  await requireOrderDocAccess(user, item.quotation_id)
  return NextResponse.json({ item, can: { delete: canDeleteDoc(user, item) } })
})

export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  const id = await docId(ctx)
  await requireOrderDocAccess(user, (await loadOrderDocument(id)).quotation_id)
  const body = await readJson(request)
  const input = await readDocInput(body)
  await updateOrderDocument(user, id, input)
  const custom = input.jenis_order === 'custom' ? await syncOrderDocChecklists(id, input, body.custom, user) : null
  return NextResponse.json({ ok: true, custom })
})

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireDokumenOrder(user)
  await deleteOrderDocument(user, await docId(ctx))
  return NextResponse.json({ ok: true })
})
