import { fail, handle, int, publicOrigin, requireUser } from '@/lib/api'
import { loadAnalysis, requireTechAnalysis } from '@/lib/tech-analysis'
import { TA_WORD_CSS, techAnalysisHtml, techAnalysisSettings } from '@/lib/tech-analysis-document'

type Ctx = { params: Promise<{ id: string }> }

// Ekspor Analisa Teknik Order ke Word (.doc berformat HTML, bisa diedit di Microsoft Word)
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTechAnalysis(user)
  const a = await loadAnalysis(int((await ctx.params).id) ?? fail(404, 'Analisa teknik tidak ditemukan.'))
  const body = techAnalysisHtml(a, await techAnalysisSettings(), `${publicOrigin(request)}/logo-pap.png`)
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${a.nomor}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>${TA_WORD_CSS}</style></head><body>${body}</body></html>`
  return new Response(`﻿${html}`, {
    headers: {
      'Content-Type': 'application/msword; charset=utf-8',
      'Content-Disposition': `attachment; filename="Analisa-Teknik-${a.nomor.replace(/[^\w.-]+/g, '_')}.doc"`,
      'Cache-Control': 'no-store',
    },
  })
})
