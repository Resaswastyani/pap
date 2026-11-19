import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { canSignQuotation, revokeSignature, ROLE_LABEL } from '@/lib/quotation-signature'
import { loadQuotation, requireQuotation } from '@/lib/quotations'

type Ctx = { params: Promise<{ id: string; sigId: string }> }

// Cabut tanda tangan (riwayat tetap tersimpan): { alasan }
export const DELETE = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireQuotation(user)
  if (!canSignQuotation(user)) fail(403, 'Hanya Marketing / GM yang bisa mencabut tanda tangan.')
  const p = await ctx.params
  const id = int(p.id) ?? fail(404, 'Quotation tidak ditemukan.')
  const q = await loadQuotation(id, user)
  const body = await readJson(request).catch(() => ({}) as Record<string, unknown>)
  const res = await revokeSignature(id, int(p.sigId) ?? fail(404, 'Tanda tangan tidak ditemukan.'), user, str(body.alasan, 255))
  await logActivity(request, user, {
    module: 'Quotation', action: 'update', entity: { type: 'quotation', id, label: String(q.nomor) },
    description: `Mencabut tanda tangan ${ROLE_LABEL[res.peran].toLowerCase()} (${res.nama}) pada ${q.nomor}`,
  })
  return NextResponse.json({ ok: true })
})
