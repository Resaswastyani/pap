import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { loadMeeting, loadMeetingFiles, meetingAbilities } from '@/lib/meeting'
import { PERMISSIONS } from '@/lib/permissions'
import { validLink, validUpload } from '@/lib/planning'

type Ctx = { params: Promise<{ id: string }> }

// Tambah lampiran hasil meeting: multipart (field "file") untuk upload, atau JSON { name, url } untuk link.
// Boleh oleh pembuat, lead/admin, dan peserta (sama dengan yang boleh mengisi hasil meeting).
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser(PERMISSIONS.meetingView)
  const row = await loadMeeting(user, int((await ctx.params).id) ?? fail(404, 'Meeting tidak ditemukan.'))
  if (!meetingAbilities(user, row).result) fail(403, 'Anda tidak dapat menambah lampiran hasil meeting ini.')

  if ((request.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
    const form = await request.formData().catch(() => fail(400, 'Upload tidak valid.'))
    const file = validUpload(form.get('file'))
    await db.query(
      "INSERT INTO meeting_files (meeting_id, type, name, mime, size, data, uploaded_by) VALUES (?, 'file', ?, ?, ?, ?, ?)",
      [row.id, file.name.slice(0, 255), file.type, file.size, Buffer.from(await file.arrayBuffer()), user.id],
    )
  } else {
    const link = validLink(await readJson(request))
    await db.query("INSERT INTO meeting_files (meeting_id, type, name, url, uploaded_by) VALUES (?, 'link', ?, ?, ?)", [row.id, link.name, link.url, user.id])
  }
  return NextResponse.json({ files: await loadMeetingFiles(row.id) }, { status: 201 })
})
