import { NextResponse } from 'next/server'
import { fail, handle, int, requireUser } from '@/lib/api'
import { addAttachment, isNoteOwner, listAttachments, type NoteOwner } from '@/lib/attachments'
import { noteAccess } from '@/lib/note-access'

type Ctx = { params: Promise<{ owner: string; id: string }> }

async function target(ctx: Ctx) {
  const { owner, id } = await ctx.params
  if (!isNoteOwner(owner)) fail(404, 'Jenis catatan tidak dikenal.')
  return { owner: owner as NoteOwner, id: int(id) ?? fail(404, 'Catatan tidak ditemukan.') }
}

// Lampiran sebuah catatan (follow-up, catatan status request, catatan produksi)
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  const { owner, id } = await target(ctx)
  const access = await noteAccess(owner, id, user)
  return NextResponse.json({ items: await listAttachments(owner, id), canAdd: access.canAdd })
})

// Tambah lampiran: multipart "file" (semua format, maks 2 MB) atau "url" (+ "name")
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  const { owner, id } = await target(ctx)
  const access = await noteAccess(owner, id, user)
  if (!access.canAdd) fail(403, 'Anda tidak dapat menambah lampiran pada catatan ini.')
  const form = await request.formData().catch(() => fail(400, 'Data upload tidak valid.'))
  await addAttachment(owner, id, form, user.id)
  return NextResponse.json({ items: await listAttachments(owner, id) }, { status: 201 })
})
