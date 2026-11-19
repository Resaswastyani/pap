import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { addSignature, canSignQuotation, listSignatures, mySignature, quotationHash, ROLE_LABEL } from '@/lib/quotation-signature'
import { loadQuotation, requireQuotation } from '@/lib/quotations'

type Ctx = { params: Promise<{ id: string }> }

// Tanda tangan digital penawaran: daftar + status keabsahan, tanda tangan tersimpan milik user
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireQuotation(user)
  const id = int((await ctx.params).id) ?? fail(404, 'Quotation tidak ditemukan.')
  await loadQuotation(id, user)
  const [items, mine] = await Promise.all([listSignatures(id, await quotationHash(id, user)), mySignature(user.id)])
  return NextResponse.json({ items, mine, can: { sign: canSignQuotation(user) } })
})

// Tandatangani: { peran: 'perusahaan' | 'customer', nama, jabatan, image (data URL PNG), setuju: true, simpan?: true }
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireQuotation(user)
  if (!canSignQuotation(user)) fail(403, 'Hanya Marketing / GM yang bisa menandatangani penawaran.')
  const id = int((await ctx.params).id) ?? fail(404, 'Quotation tidak ditemukan.')
  const h = request.headers
  const res = await addSignature(id, user, await readJson(request), {
    ip: h.get('x-forwarded-for')?.split(',')[0].trim() || h.get('x-real-ip') || null, ua: h.get('user-agent'),
  })
  await logActivity(request, user, {
    module: 'Quotation', action: 'update', entity: { type: 'quotation', id, label: String(res.q.nomor) },
    description: `Tanda tangan digital ${ROLE_LABEL[res.peran].toLowerCase()} pada ${res.q.nomor} oleh ${res.nama}`,
  })
  return NextResponse.json({ ok: true, token: res.token })
})
