import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { loadMeeting, meetingAbilities } from '@/lib/meeting'
import { PERMISSIONS } from '@/lib/permissions'

type Ctx = { params: Promise<{ fileId: string }> }
type FileRow = RowDataPacket & { id: number; meeting_id: number; type: 'link' | 'file'; name: string; url: string | null; mime: string | null; uploaded_by: number; data?: Buffer }

async function loadFile(ctx: Ctx, withData = false) {
  const id = int((await ctx.params).fileId) ?? fail(404, 'File tidak ditemukan.')
  const [rows] = await db.query<FileRow[]>(`SELECT id, meeting_id, type, name, url, mime, uploaded_by${withData ? ', data' : ''} FROM meeting_files WHERE id = ?`, [id])
  return (rows[0] as FileRow) ?? fail(404, 'File tidak ditemukan.')
}

// Unduh / tampilkan lampiran (hanya user yang bisa melihat meeting-nya)
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser(PERMISSIONS.meetingView)
  const file = await loadFile(ctx, true)
  await loadMeeting(user, file.meeting_id)
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

// Hapus: pembuat/lead/admin meeting, atau peserta yang mengunggah lampiran itu
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser(PERMISSIONS.meetingView)
  const file = await loadFile(ctx)
  const ability = meetingAbilities(user, await loadMeeting(user, file.meeting_id))
  if (!ability.edit && !(ability.result && file.uploaded_by === user.id)) fail(403, 'Anda tidak dapat menghapus lampiran ini.')
  await db.query('DELETE FROM meeting_files WHERE id = ?', [file.id])
  return NextResponse.json({ ok: true })
})
