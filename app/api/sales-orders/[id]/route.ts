import { NextResponse } from 'next/server'
import { fail, handle, int, requireUser } from '@/lib/api'
import { loadSoDocument, requireDokumenOrder, soDocNomor } from '@/lib/so-document'

type Ctx = { params: Promise<{ id: string }> }

// Ringkasan SO dari Accurate untuk dialog dokumen (total, uang muka, DP di keterangan)
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireDokumenOrder(user)
  const so = await loadSoDocument(int((await ctx.params).id) ?? fail(404, 'Sales order tidak ditemukan.'))
  return NextResponse.json({ item: { ...so, proforma_nomor: soDocNomor(so, 'proforma') } })
})
