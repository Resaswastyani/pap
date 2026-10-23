import { fail, handle, int, requireUser } from '@/lib/api'
import { WORD_CSS } from '@/lib/quotation-document'
import { loadSoDocument, readSoJenis, requireDokumenOrder, soDocNomor, soDocumentHtml } from '@/lib/so-document'

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
  const nomor = soDocNomor(so, jenis)
  const body = await soDocumentHtml(so, jenis, `${url.origin}/logo-pap.png`, { dp })
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${nomor}</title>
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
