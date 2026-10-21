import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { SOP_KATEGORI } from '@/lib/sop'
import { canManageTeknik, requireTeknikMenu } from '@/lib/teknik'

type Ctx = { params: Promise<{ id: string }> }

// Betulkan kelompok mesin sebuah video: { kategori, lini } — tidak ditimpa sinkron berikutnya
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTeknikMenu(user, 'sop-mesin', 'SOP Mesin')
  if (!canManageTeknik(user)) fail(403, 'Kelompok SOP diatur oleh divisi Teknik.')
  const id = int((await ctx.params).id) ?? fail(404, 'Video tidak ditemukan.')
  const body = await readJson(request)
  const kategori = str(body.kategori, 60)
  if (!(SOP_KATEGORI as readonly string[]).includes(kategori)) fail(400, 'Kelompok mesin tidak valid.')
  const lini = ['PP', 'HD'].includes(str(body.lini, 5)) ? str(body.lini, 5) : null
  const [res] = await db.query<ResultSetHeader>('UPDATE sop_videos SET kategori = ?, lini = ?, kategori_manual = 1 WHERE id = ?', [kategori, lini, id])
  if (!res.affectedRows) fail(404, 'Video tidak ditemukan.')
  const [[item]] = await db.query<RowDataPacket[]>('SELECT id, kategori, lini, kategori_manual FROM sop_videos WHERE id = ?', [id])
  return NextResponse.json({ item: { ...item, kategori_manual: !!item.kategori_manual } })
})
