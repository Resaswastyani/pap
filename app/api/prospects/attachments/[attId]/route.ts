import { NextResponse } from 'next/server'
import { fail, handle, int, requireUser } from '@/lib/api'
import { attachmentResponse, deleteAttachment, getAttachment } from '@/lib/attachments'
import { loadProspect, requireMarketing } from '@/lib/marketing'

type Ctx = { params: Promise<{ attId: string }> }

async function load(ctx: Ctx, user: Awaited<ReturnType<typeof requireUser>>) {
  const row = await getAttachment('prospect', int((await ctx.params).attId) ?? fail(404, 'Lampiran tidak ditemukan.'))
  await loadProspect(row.owner_id, user) // akses mengikuti akses prospek
  return row
}

// Lihat / unduh lampiran (?download=1)
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireMarketing(user, 'prospek')
  const row = await load(ctx, user)
  return attachmentResponse(row, new URL(request.url).searchParams.get('download') === '1')
})

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireMarketing(user, 'prospek')
  const row = await load(ctx, user)
  if (row.uploaded_by !== user.id && !user.role.isAdmin) fail(403, 'Hanya pengunggah yang dapat menghapus lampiran.')
  await deleteAttachment('prospect', row.id)
  return NextResponse.json({ ok: true })
})
