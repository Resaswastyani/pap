import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { PERMISSIONS } from '@/lib/permissions'
import { db } from '@/lib/db'
import { insertAttachment, loadFiles, loadNote, loadNotes, loadPlanning, noteAbilities, planningAbilities, validLink, validUpload } from '@/lib/planning'

type Ctx = { params: Promise<{ id: string }> }

// Tambah lampiran: multipart (field "file") untuk upload, atau JSON { name, url } untuk link.
// Isi "note_id" untuk menambah lampiran ke catatan progress tertentu.
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser(PERMISSIONS.planningView)
  const row = await loadPlanning(user, int((await ctx.params).id) ?? fail(404, 'Planning tidak ditemukan.'))

  const multipart = (request.headers.get('content-type') ?? '').startsWith('multipart/form-data')
  const form = multipart ? await request.formData().catch(() => fail(400, 'Upload tidak valid.')) : null
  const body = multipart ? null : await readJson(request)
  const noteId = int(multipart ? form!.get('note_id') : body!.note_id)

  if (noteId) {
    const note = await loadNote(noteId)
    if (note.planning_id !== row.id) fail(404, 'Catatan tidak ditemukan.')
    if (!noteAbilities(user, row, note).edit) fail(403, 'Anda hanya dapat menambah lampiran pada catatan milik sendiri.')
  } else if (!planningAbilities(user, row).attach) {
    fail(403, 'Anda tidak dapat menambah lampiran pada planning ini.')
  }

  const target = { planningId: row.id, noteId: noteId ?? null, userId: user.id }
  if (multipart) await insertAttachment(db, target, { file: validUpload(form!.get('file')) })
  else await insertAttachment(db, target, { link: validLink(body!) })

  return NextResponse.json(noteId ? { notes: await loadNotes(user, row) } : { files: await loadFiles(row.id) }, { status: 201 })
})
