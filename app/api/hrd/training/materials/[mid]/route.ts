import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageTraining, requireTraining } from '@/lib/training'

type Ctx = { params: Promise<{ mid: string }> }

// Hapus link materi yang ditambahkan manual (materi dari Drive dihapus di folder Drive)
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTraining(user)
  if (!canManageTraining(user)) fail(403, 'Materi training dikelola HRD.')
  const id = int((await ctx.params).mid) ?? fail(404, 'Materi tidak ditemukan.')
  const [[row]] = await db.query<(RowDataPacket & { sumber: string })[]>('SELECT sumber FROM training_materials WHERE id = ?', [id])
  if (!row) fail(404, 'Materi tidak ditemukan.')
  if (row.sumber === 'drive') fail(400, 'Materi ini dari folder Google Drive. Hapus file-nya di Drive, lalu sinkron.')
  await db.query('DELETE FROM training_materials WHERE id = ?', [id])
  return NextResponse.json({ ok: true })
})
