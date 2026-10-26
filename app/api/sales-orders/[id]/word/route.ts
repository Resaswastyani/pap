import { fail, handle, int, requireUser } from '@/lib/api'
import { loadSoDocument, readSoJenis, requireDokumenOrder, soDocNomor, soDocumentHtml, wordResponse } from '@/lib/so-document'

type Ctx = { params: Promise<{ id: string }> }

// Ekspor Surat Order / Proforma Invoice dari SO ke Word (.doc berformat HTML)
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireDokumenOrder(user)
  const url = new URL(request.url)
  const jenis = readSoJenis(url.searchParams.get('jenis'))
  const dpRaw = url.searchParams.get('dp')
  const dp = dpRaw === null ? undefined : Number(dpRaw) > 0 && Number(dpRaw) <= 100 ? Number(dpRaw) : null
  const so = await loadSoDocument(int((await ctx.params).id) ?? fail(404, 'Sales order tidak ditemukan.'))
  return wordResponse(soDocNomor(so, jenis), await soDocumentHtml(so, jenis, `${url.origin}/logo-pap.png`, { dp }))
})
