import { NextResponse } from 'next/server'
import { fail, handle, int, requireUser } from '@/lib/api'
import { canRequest, isPPIC, isProduksi, loadLogs, loadSample, loadSampleItems, requireRequestMenu } from '@/lib/requests'

type Ctx = { params: Promise<{ id: string }> }

export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireRequestMenu(user, 'sample')
  const item = await loadSample(int((await ctx.params).id) ?? fail(404, 'Request sample tidak ditemukan.'), user)
  return NextResponse.json({
    item: { ...item, item_count: Number(item.item_count) },
    items: await loadSampleItems(item.id),
    logs: await loadLogs('sample_id', item.id),
    roles: { canRequest: canRequest(user), ppic: isPPIC(user), produksi: isProduksi(user), isRequester: item.requested_by === user.id || user.role.isAdmin },
  })
})
