import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageTraining, isVideoLink, requireTraining } from '@/lib/training'

type Ctx = { params: Promise<{ id: string }> }

// Tambah link materi: { judul, url } (YouTube / Google Drive / Vimeo diputar di SIMPAP; link lain dibuka di tab baru)
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTraining(user)
  if (!canManageTraining(user)) fail(403, 'Materi training dikelola HRD.')
  const id = int((await ctx.params).id) ?? fail(404, 'Modul training tidak ditemukan.')
  const body = await readJson(request)
  const url = str(body.url, 1000)
  if (!/^https?:\/\/\S+$/i.test(url)) fail(400, 'Isi link yang diawali http:// atau https://')
  const judul = str(body.judul, 255) || url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 80)
  await db.query(
    "INSERT INTO training_materials (module_id, sumber, judul, jenis, url, urut, created_by) VALUES (?, 'manual', ?, ?, ?, 999, ?)",
    [id, judul, isVideoLink(url) ? 'video' : 'link', url, user.id],
  )
  return NextResponse.json({ ok: true }, { status: 201 })
})
