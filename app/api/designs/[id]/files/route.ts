import { NextResponse } from 'next/server'
import { fail, handle, int, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canSupervise } from '@/lib/marketing'
import { readLink } from '@/lib/marketing'
import { PRODUCT_FILE_MAX_BYTES } from '@/lib/permissions'
import { DESIGN_TEAM, divisionUsers, isDesigner, leadDmUsers, loadDesign, notifyRequest, requireRequestMenu } from '@/lib/requests'

type Ctx = { params: Promise<{ id: string }> }

// Unggah file (multipart: "file" + "kind") atau link ("url" + "name" opsional): referensi oleh sales, desain oleh desainer.
// File boleh format apa saja (maks 4 MB); file besar / sumber desain (AI, CDR, PSD) bisa ditempel sebagai link.
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireRequestMenu(user, 'desain')
  const item = await loadDesign(int((await ctx.params).id) ?? fail(404, 'Request desain tidak ditemukan.'), user)
  const form = await request.formData().catch(() => fail(400, 'Data upload tidak valid.'))
  const kind = form.get('kind') === 'desain' ? 'desain' : 'referensi'
  const link = form.get('url') ? readLink(form.get('url'), form.get('name')) : null
  const raw = form.get('file')
  const file = link ? null : raw instanceof File && raw.size ? raw : fail(400, 'Pilih file atau isi link.')
  if (file && file.size > PRODUCT_FILE_MAX_BYTES) fail(400, `${file.name}: ukuran maksimal 4 MB. File lebih besar tempel sebagai link (Google Drive, dll.).`)
  if (['disetujui', 'batal'].includes(item.status)) fail(400, 'Request ini sudah selesai.')
  let versi = 0
  if (kind === 'desain') {
    if (!isDesigner(user)) fail(403, 'File desain diunggah oleh tim Digital Marketing.')
    if (!['dikerjakan', 'revisi'].includes(item.status)) fail(400, 'Desain diunggah saat status Dikerjakan atau Revisi.')
    versi = Number(item.revisi_ke) + 1
  } else if (item.requested_by !== user.id && !user.role.isAdmin && !canSupervise(user)) {
    fail(403, 'File referensi diunggah oleh sales yang mengajukan.')
  }
  await db.query('INSERT INTO design_request_files (design_id, kind, versi, name, mime, url, size, data, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', link
    ? [item.id, kind, versi, link.name.slice(0, 255), 'text/uri-list', link.url, 0, Buffer.alloc(0), user.id]
    : [item.id, kind, versi, file!.name.slice(0, 255), (file!.type || 'application/octet-stream').slice(0, 150), null, file!.size, Buffer.from(await file!.arrayBuffer()), user.id])
  const fileName = link ? link.name : file!.name
  // Desain baru diunggah: kabari rekan tim Digital Marketing, Lead Digital Marketing, dan marketing yang mengajukan
  if (kind === 'desain') {
    await notifyRequest([...(await divisionUsers(DESIGN_TEAM)), ...(await leadDmUsers()), item.requested_by], user.id, {
      type: 'desain_update',
      title: `Desain ${item.nomor ?? item.judul} diunggah (versi ${versi})`,
      body: [item.judul, item.target_name, `${fileName} · oleh ${user.name}`].filter(Boolean).join(' · '),
      designId: item.id,
      refKey: `desain-file:${item.id}:${versi}:${Date.now()}`,
    })
  }
  return NextResponse.json({ ok: true }, { status: 201 })
})
