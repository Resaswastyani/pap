import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { deleteInvoice, fakturCan, invoiceDetail, readInvoiceInput, requireFaktur, requireFakturCan, updateInvoice } from '@/lib/sales-invoices'

type Ctx = { params: Promise<{ id: string }> }
const invoiceId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Faktur tidak ditemukan.')

// Faktur lengkap langsung dari Accurate
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireFaktur(user)
  return NextResponse.json({ item: await invoiceDetail(await invoiceId(ctx)), can: fakturCan(user) })
})

export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireFaktur(user)
  requireFakturCan(user, 'update', 'mengubah faktur')
  return NextResponse.json(await updateInvoice(await invoiceId(ctx), readInvoiceInput(await readJson(request)), user.id))
})

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireFaktur(user)
  requireFakturCan(user, 'delete', 'menghapus faktur')
  return NextResponse.json({ ok: true, ...(await deleteInvoice(await invoiceId(ctx))) })
})
