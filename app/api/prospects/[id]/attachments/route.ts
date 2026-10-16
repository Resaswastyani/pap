import { NextResponse } from 'next/server'
import { fail, handle, int, requireUser } from '@/lib/api'
import { addAttachment, listAttachments } from '@/lib/attachments'
import { loadProspect, requireMarketing } from '@/lib/marketing'

type Ctx = { params: Promise<{ id: string }> }

const prospectOf = async (ctx: Ctx, user: Awaited<ReturnType<typeof requireUser>>) => loadProspect(int((await ctx.params).id) ?? fail(404, 'Prospek tidak ditemukan.'), user)

export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireMarketing(user, 'prospek')
  const prospect = await prospectOf(ctx, user)
  return NextResponse.json({ items: await listAttachments('prospect', prospect.id) })
})

// Tambah lampiran prospek: multipart "file" (semua format, maks 2 MB) atau "url" (+ "name")
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireMarketing(user, 'prospek')
  const prospect = await prospectOf(ctx, user)
  const form = await request.formData().catch(() => fail(400, 'Data upload tidak valid.'))
  await addAttachment('prospect', prospect.id, form, user.id)
  return NextResponse.json({ items: await listAttachments('prospect', prospect.id) }, { status: 201 })
})
