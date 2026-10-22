import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { canEditContent, loadContent, readContentInput, requireContent } from '@/lib/content'
import { contentSheetDelete, contentSheetUpdate, type ContentRow } from '@/lib/content-sheet'
import { db } from '@/lib/db'
import { trySheet } from '@/lib/sheet-write'

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
  // Perubahan ikut ditulis ke baris Google Sheet asalnya (konten tanpa baris sheet ditambahkan sebagai baris baru)
  const warning = await trySheet('baris konten', async () => contentSheetUpdate((await loadContent(item.id)) as unknown as ContentRow, item as unknown as ContentRow))
  return NextResponse.json({ ok: true, warning })
})

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireContent(user)
  if (!canEditContent(user)) fail(403, 'Kalender konten dikelola Marketing Digital.')
  const item = await loadContent(await contentId(ctx))
  await db.query('DELETE FROM content_plans WHERE id = ?', [item.id])
  const warning = await trySheet('baris konten', () => contentSheetDelete(item as unknown as ContentRow))
  return NextResponse.json({ ok: true, warning })
})
