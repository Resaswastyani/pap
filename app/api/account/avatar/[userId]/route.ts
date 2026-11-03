import type { RowDataPacket } from 'mysql2'
import { fail, handle, int, requireUser } from '@/lib/api'
import { db } from '@/lib/db'

type Ctx = { params: Promise<{ userId: string }> }

// Foto profil user (dilihat semua user yang login). URL memuat ?v=<versi>, jadi aman di-cache lama di browser.
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  await requireUser()
  const id = int((await ctx.params).userId) ?? fail(404, 'Foto tidak ditemukan.')
  const [[row]] = await db.query<(RowDataPacket & { data: Buffer; mime: string })[]>('SELECT data, mime FROM user_avatars WHERE user_id = ?', [id])
  if (!row) fail(404, 'Foto tidak ditemukan.')
  return new Response(new Uint8Array(row.data), {
    headers: { 'Content-Type': row.mime, 'Cache-Control': 'private, max-age=2592000, immutable', 'X-Content-Type-Options': 'nosniff' },
  })
})
