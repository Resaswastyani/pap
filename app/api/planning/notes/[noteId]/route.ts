import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { PERMISSIONS } from '@/lib/permissions'
import { loadNote, loadNotes, loadPlanning, noteAbilities } from '@/lib/planning'

type Ctx = { params: Promise<{ noteId: string }> }

async function load(ctx: Ctx) {
  const user = await requireUser(PERMISSIONS.planningView)
  const note = await loadNote(int((await ctx.params).noteId) ?? fail(404, 'Catatan tidak ditemukan.'))
  const planning = await loadPlanning(user, note.planning_id)
  return { user, note, planning, can: noteAbilities(user, planning, note) }
}

// Ubah isi teks catatan (progress & waktu catatan tetap sebagai riwayat)
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const { user, note, planning, can } = await load(ctx)
  if (!can.edit) fail(403, 'Anda hanya dapat mengubah catatan milik sendiri.')
  const body = await readJson(request)
  await db.query('UPDATE planning_progress_notes SET catatan = ? WHERE id = ?', [str(body.catatan, 5000) || null, note.id])
  return NextResponse.json({ notes: await loadNotes(user, planning) })
})

// Hapus catatan beserta lampirannya (progress planning tidak berubah)
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const { user, note, planning, can } = await load(ctx)
  if (!can.delete) fail(403, 'Anda hanya dapat menghapus catatan milik sendiri.')
  await db.query('DELETE FROM planning_progress_notes WHERE id = ?', [note.id])
  return NextResponse.json({ notes: await loadNotes(user, planning) })
})
