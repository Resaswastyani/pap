import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { loadVisit, requireMarketing } from '@/lib/marketing'

type Ctx = { params: Promise<{ attId: string }> }
type Row = RowDataPacket & { id: number; visit_id: number; kind: 'file' | 'link'; name: string; url: string | null; mime: string | null; size: number | null; data: Buffer | null; uploaded_by: number }

async function load(ctx: Ctx, user: Awaited<ReturnType<typeof requireUser>>) {
  const id = int((await ctx.params).attId) ?? fail(404, 'Lampiran tidak ditemukan.')
  const [[row]] = await db.query<Row[]>('SELECT * FROM visit_attachments WHERE id = ?', [id])
  if (!row) fail(404, 'Lampiran tidak ditemukan.')
  await loadVisit(row.visit_id, user) // akses mengikuti akses visit
  return row
}

// Lihat / unduh file lampiran (?download=1)
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireMarketing(user, 'visit')
  const row = await load(ctx, user)
  if (row.kind === 'link') return NextResponse.redirect(row.url!)
  const inline = new URL(request.url).searchParams.get('download') !== '1' && /^(image\/(jpeg|png|webp|gif)|application\/pdf)$/.test(row.mime ?? '')
  return new NextResponse(new Uint8Array(row.data!), {
    headers: {
      'Content-Type': inline ? row.mime! : 'application/octet-stream',
      'Content-Length': String(row.size ?? row.data!.length),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  })
})

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireMarketing(user, 'visit')
  const row = await load(ctx, user)
  if (row.uploaded_by !== user.id && !user.role.isAdmin) fail(403, 'Hanya pengunggah yang dapat menghapus lampiran.')
  await db.query('DELETE FROM visit_attachments WHERE id = ?', [row.id])
  return NextResponse.json({ ok: true })
})
