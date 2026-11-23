import { fail, handle, int, requireUser, publicOrigin } from '@/lib/api'
import { OC_ART_WORD_CSS, OC_WORD_CSS, orderDocCustomAppendix } from '@/lib/order-custom-document'
import { loadOrderDocument, orderDocumentView } from '@/lib/order-documents'
import { orderDocumentHtml, requireDokumenOrder, wordResponse } from '@/lib/so-document'

type Ctx = { params: Promise<{ id: string }> }

// Ekspor dokumen order tersimpan ke Word (.doc berformat HTML). Order custom: + Form Order per produk + daftar Gambar Desain (link)
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireDokumenOrder(user)
  const doc = await loadOrderDocument(int((await ctx.params).id) ?? fail(404, 'Dokumen order tidak ditemukan.'))
  const logo = `${publicOrigin(request)}/logo-pap.png`
  let body = await orderDocumentHtml(orderDocumentView(doc), logo)
  if (doc.jenis_order !== 'custom') return wordResponse(doc.nomor, body)
  const a = await orderDocCustomAppendix(doc.id, logo, false)
  const pb = '<br clear="all" style="page-break-before:always">'
  body += [...a.forms, ...(a.gambar ? [a.gambar] : [])].map((h) => pb + h).join('')
  // CSS checklist tanpa @page/body ganda
  return wordResponse(doc.nomor, body, OC_WORD_CSS.replace(/@page[^}]*}|body \{[^}]*}/g, '') + OC_ART_WORD_CSS)
})
