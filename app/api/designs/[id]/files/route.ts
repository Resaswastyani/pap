import { NextResponse } from 'next/server'
import { fail, handle, int, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canSupervise } from '@/lib/marketing'
import { validProductFile } from '@/lib/products'
import { loadDesign, requireRequestMenu } from '@/lib/requests'

type Ctx = { params: Promise<{ id: string }> }

// Unggah file (multipart: "file" + "kind"): referensi oleh sales, desain oleh desainer yang mengerjakan.
// Satu file per request (batas body Vercel 4,5 MB).
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireRequestMenu(user, 'desain')
  const item = await loadDesign(int((await ctx.params).id) ?? fail(404, 'Request desain tidak ditemukan.'), user)
  const form = await request.formData().catch(() => fail(400, 'Data upload tidak valid.'))
  const kind = form.get('kind') === 'desain' ? 'desain' : 'referensi'
  const file = validProductFile(form.get('file'))
  if (['disetujui', 'batal'].includes(item.status)) fail(400, 'Request ini sudah selesai.')
  let versi = 0
  if (kind === 'desain') {
    if (item.designer_id !== user.id && !user.role.isAdmin) fail(403, 'Ambil request ini terlebih dahulu untuk mengunggah desain.')
    if (!['dikerjakan', 'revisi'].includes(item.status)) fail(400, 'Desain diunggah saat status Dikerjakan atau Revisi.')
    versi = Number(item.revisi_ke) + 1
  } else if (item.requested_by !== user.id && !user.role.isAdmin && !canSupervise(user)) {
    fail(403, 'File referensi diunggah oleh sales yang mengajukan.')
  }
  await db.query('INSERT INTO design_request_files (design_id, kind, versi, name, mime, size, data, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
    item.id, kind, versi, file.name.slice(0, 255), file.type, file.size, Buffer.from(await file.arrayBuffer()), user.id,
  ])
  return NextResponse.json({ ok: true }, { status: 201 })
})
