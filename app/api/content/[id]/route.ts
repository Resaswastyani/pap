import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { canEditContent, loadContent, readContentInput, requireContent } from '@/lib/content'
import { db } from '@/lib/db'

type Ctx = { params: Promise<{ id: string }> }
const contentId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Rencana konten tidak ditemukan.')

export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireContent(user)
  return NextResponse.json({ item: await loadContent(await contentId(ctx)), canEdit: canEditContent(user) })
})

export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireContent(user)
  if (!canEditContent(user)) fail(403, 'Kalender konten dikelola Marketing Digital.')
  const item = await loadContent(await contentId(ctx))
  const c = readContentInput(await readJson(request))
  await db.query(
    `UPDATE content_plans SET judul = ?, platform = ?, jenis = ?, jadwal_tayang = ?, status = ?, tujuan = ?, target_sektor = ?, caption = ?, anggaran = ?,
       link_hasil = ?, reach = ?, engagement = ?, leads = ?, catatan = ?, pic_id = ? WHERE id = ?`,
    [c.judul, c.platform, c.jenis, c.jadwal_tayang, c.status, c.tujuan, c.target_sektor, c.caption, c.anggaran, c.link_hasil, c.reach, c.engagement, c.leads, c.catatan, c.pic_id, item.id],
  )
  return NextResponse.json({ ok: true })
})

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireContent(user)
  if (!canEditContent(user)) fail(403, 'Kalender konten dikelola Marketing Digital.')
  await db.query('DELETE FROM content_plans WHERE id = ?', [await contentId(ctx)])
  return NextResponse.json({ ok: true })
})
