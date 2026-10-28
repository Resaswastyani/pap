import { fail, handle, int, requireUser, publicOrigin } from '@/lib/api'
import { purchaseDocHtml, purchaseRequestView } from '@/lib/purchase-doc'
import { wordResponse } from '@/lib/so-document'

type Ctx = { params: Promise<{ id: string }> }

// Ekspor formulir Pengajuan Pembelian ke Word (.doc berformat HTML)
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  const view = await purchaseRequestView(int((await ctx.params).id) ?? fail(404, 'Pengajuan pembelian tidak ditemukan.'), user)
  return wordResponse(view.nomor, await purchaseDocHtml(view, `${publicOrigin(request)}/logo-pap.png`))
})
