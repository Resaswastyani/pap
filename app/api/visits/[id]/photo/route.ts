import type { RowDataPacket } from 'mysql2'
import { fail, handle, int, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { requireMarketing, visitScope } from '@/lib/marketing'

type Ctx = { params: Promise<{ id: string }> }

// Foto bukti check-in visit
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireMarketing(user, 'visit')
  const scope = visitScope(user)
  const [[row]] = await db.query<(RowDataPacket & { foto: Buffer | null; foto_mime: string | null })[]>(
    `SELECT v.foto, v.foto_mime FROM visits v WHERE v.id = ? AND ${scope.sql}`,
    [int((await ctx.params).id) ?? 0, ...scope.params],
  )
  if (!row?.foto) fail(404, 'Foto tidak ditemukan.')
  return new Response(new Uint8Array(row.foto!), { headers: { 'Content-Type': row.foto_mime ?? 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } })
})
