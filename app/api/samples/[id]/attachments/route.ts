import { NextResponse } from 'next/server'
import { fail, handle, int, requireUser } from '@/lib/api'
import { addAttachment, listAttachments } from '@/lib/attachments'
import { loadSample, requireRequestMenu } from '@/lib/requests'

type Ctx = { params: Promise<{ id: string }> }

const sampleOf = async (ctx: Ctx, user: Awaited<ReturnType<typeof requireUser>>) => loadSample(int((await ctx.params).id) ?? fail(404, 'Request sample tidak ditemukan.'), user)

export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireRequestMenu(user, 'sample')
  const sample = await sampleOf(ctx, user)
  return NextResponse.json({ items: await listAttachments('sample', sample.id) })
})

// Lampiran sample (file apa pun maks 2 MB, foto langsung, atau link): oleh semua yang terlibat (Marketing, PPIC, Produksi)
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireRequestMenu(user, 'sample')
  const sample = await sampleOf(ctx, user)
  if (sample.status === 'batal') fail(400, 'Request sample ini sudah dibatalkan.')
  const form = await request.formData().catch(() => fail(400, 'Data upload tidak valid.'))
  await addAttachment('sample', sample.id, form, user.id)
  return NextResponse.json({ items: await listAttachments('sample', sample.id) }, { status: 201 })
})
