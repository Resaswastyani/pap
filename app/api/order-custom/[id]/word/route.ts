import { fail, handle, int, publicOrigin, requireUser } from '@/lib/api'
import { blankChecklist, loadChecklist, requireOrderCustom } from '@/lib/order-custom'
import { OC_WORD_CSS, orderCustomHtml, orderCustomSettings } from '@/lib/order-custom-document'

type Ctx = { params: Promise<{ id: string }> }

// Ekspor Form Checklist Order Custom ke Word (.doc berformat HTML). id 'kosong' = formulir kosong.
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireOrderCustom(user)
  const raw = (await ctx.params).id
  const c = raw === 'kosong' ? blankChecklist() : await loadChecklist(int(raw) ?? fail(404, 'Checklist order custom tidak ditemukan.'))
  const body = orderCustomHtml(c, await orderCustomSettings(), `${publicOrigin(request)}/logo-pap.png`, false)
  const name = c.id ? c.nomor : 'Formulir-Kosong'
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>Checklist Order Custom ${name}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>${OC_WORD_CSS}</style></head><body>${body}</body></html>`
  return new Response(`﻿${html}`, {
    headers: {
      'Content-Type': 'application/msword; charset=utf-8',
      'Content-Disposition': `attachment; filename="Checklist-Order-Custom-${name.replace(/[^\w.-]+/g, '_')}.doc"`,
      'Cache-Control': 'no-store',
    },
  })
})
