import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { PERMISSIONS } from '@/lib/permissions'
import { loadNote, loadPlanning, noteAbilities, planningAbilities } from '@/lib/planning'

type Ctx = { params: Promise<{ fileId: string }> }
type FileRow = RowDataPacket & { id: number; planning_id: number; note_id: number | null; type: 'link' | 'file'; name: string; url: string | null; mime: string | null; uploaded_by: number }

async function loadFile(ctx: Ctx, withData = false) {
  const id = int((await ctx.params).fileId) ?? fail(404, 'File tidak ditemukan.')
  const [rows] = await db.query<FileRow[]>(`SELECT id, planning_id, note_id, type, name, url, mime, uploaded_by${withData ? ', data' : ''} FROM planning_files WHERE id = ?`, [id])
  return rows[0] ?? fail(404, 'File tidak ditemukan.')
}

// Unduh / tampilkan lampiran (hanya user yang bisa melihat planning-nya)
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser(PERMISSIONS.planningView)
  const file = await loadFile(ctx, true)
  await loadPlanning(user, file.planning_id)
  if (file.type === 'link') return NextResponse.redirect(file.url!)
  const inline = new URL(request.url).searchParams.get('download') !== '1' && /^(image\/|application\/pdf)/.test(file.mime ?? '')
  return new Response(new Uint8Array(file.data as Buffer), {
    headers: {
      'Content-Type': file.mime ?? 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  })
})

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser(PERMISSIONS.planningView)
  const file = await loadFile(ctx)
  const planning = await loadPlanning(user, file.planning_id)
  const ability = planningAbilities(user, planning)
  const allowed = file.note_id
    ? noteAbilities(user, planning, await loadNote(file.note_id)).edit
    : ability.edit || (ability.attach && file.uploaded_by === user.id)
  if (!allowed) fail(403, 'Anda tidak dapat menghapus lampiran ini.')
  await db.query('DELETE FROM planning_files WHERE id = ?', [file.id])
  return NextResponse.json({ ok: true })
})
