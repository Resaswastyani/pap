import { fail, handle, int, requireUser, publicOrigin } from '@/lib/api'
import { documentNomor, loadQuotationDocument, quotationDocumentHtml, readJenis, WORD_CSS } from '@/lib/quotation-document'

type Ctx = { params: Promise<{ id: string }> }

// Ekspor surat penawaran / surat order / proforma ke Word (.doc berformat HTML, dibuka & diedit langsung di Microsoft Word)
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  const url = new URL(request.url)
  const jenis = readJenis(url.searchParams.get('jenis'))
  const data = await loadQuotationDocument(int((await ctx.params).id) ?? fail(404, 'Quotation tidak ditemukan.'), user, jenis)
  if (data.missingOrder) fail(400, 'Surat order belum dibuat. Buka penawaran yang sudah Diterima lalu isi data order.')
  const nomor = documentNomor(data.q, jenis)
  // Word mengambil logo lewat URL lengkap
  const body = quotationDocumentHtml(data, jenis, `${publicOrigin(request)}/logo-pap.png`)
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${nomor}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>${WORD_CSS}</style></head><body>${body}</body></html>`
  return new Response(`﻿${html}`, {
    headers: {
      'Content-Type': 'application/msword; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nomor.replace(/[^\w.-]+/g, '_')}.doc"`,
      'Cache-Control': 'no-store',
    },
  })
})
