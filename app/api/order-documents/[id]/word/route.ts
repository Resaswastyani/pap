import { fail, handle, int, requireUser, publicOrigin } from '@/lib/api'
import { loadOrderDocument, orderDocumentView } from '@/lib/order-documents'
import { orderDocumentHtml, requireDokumenOrder, wordResponse } from '@/lib/so-document'

type Ctx = { params: Promise<{ id: string }> }

// Ekspor dokumen order tersimpan ke Word (.doc berformat HTML)
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireDokumenOrder(user)
  const doc = await loadOrderDocument(int((await ctx.params).id) ?? fail(404, 'Dokumen order tidak ditemukan.'))
  return wordResponse(doc.nomor, await orderDocumentHtml(orderDocumentView(doc), `${publicOrigin(request)}/logo-pap.png`))
})
