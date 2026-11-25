import { fail, handle, int, publicOrigin, requireUser } from '@/lib/api'
import { analysisImages, prospectAnalysisSheets, requireTechAnalysis } from '@/lib/tech-analysis'
import { TA_WORD_CSS, techAnalysisHtml, techAnalysisSettings } from '@/lib/tech-analysis-document'

type Ctx = { params: Promise<{ id: string }> }

// Word: formulir Analisa Teknik semua produk satu prospek (satu halaman per produk)
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTechAnalysis(user)
  const { prospect, sheets } = await prospectAnalysisSheets(int((await ctx.params).id) ?? fail(404, 'Prospek tidak ditemukan.'), user)
  const doc = await techAnalysisSettings()
  const logo = `${publicOrigin(request)}/logo-pap.png`
  const images = await Promise.all(sheets.map((a) => (a.id ? analysisImages(a.id, `${publicOrigin(request)}/api/notes/attachments`) : Promise.resolve([]))))
  const body = sheets.map((a, i) => techAnalysisHtml(a, doc, logo, images[i], false)).join('<br clear="all" style="page-break-before:always">')
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>Analisa Teknik ${prospect.nama_usaha}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>${TA_WORD_CSS}</style></head><body>${body}</body></html>`
  const name = prospect.nama_usaha.replace(/[^\w.-]+/g, '_').slice(0, 60)
  return new Response(`﻿${html}`, {
    headers: {
      'Content-Type': 'application/msword; charset=utf-8',
      'Content-Disposition': `attachment; filename="Analisa-Teknik-${name}.doc"`,
      'Cache-Control': 'no-store',
    },
  })
})
