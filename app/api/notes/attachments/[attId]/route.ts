import { NextResponse } from 'next/server'
import { fail, handle, int, requireUser } from '@/lib/api'
import { attachmentResponse, deleteAttachment, getNoteAttachment } from '@/lib/attachments'
import { noteAccess } from '@/lib/note-access'

type Ctx = { params: Promise<{ attId: string }> }

async function load(ctx: Ctx, user: Awaited<ReturnType<typeof requireUser>>) {
  const row = await getNoteAttachment(int((await ctx.params).attId) ?? fail(404, 'Lampiran tidak ditemukan.'))
  await noteAccess(row.owner_type, row.owner_id, user) // akses mengikuti catatan induknya
  return row
}

// Lihat / unduh lampiran catatan (?download=1)
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  const row = await load(ctx, user)
  return attachmentResponse(row, new URL(request.url).searchParams.get('download') === '1')
})

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  const row = await load(ctx, user)
  if (row.uploaded_by !== user.id && !user.role.isAdmin) fail(403, 'Hanya pengunggah yang dapat menghapus lampiran.')
  await deleteAttachment(row.owner_type, row.id)
  return NextResponse.json({ ok: true })
})
