import type { RowDataPacket } from 'mysql2'
import { fail, handle, int, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { driveEnabled, fetchThumbnail } from '@/lib/drive'
import { requireTraining } from '@/lib/training'

type Ctx = { params: Promise<{ mid: string }> }

// Thumbnail materi Drive lewat server (akun Google di Master Data, atau thumbnail publik). ?s=480
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTraining(user)
  const id = int((await ctx.params).mid) ?? fail(404, 'Materi tidak ditemukan.')
  const [[row]] = await db.query<(RowDataPacket & { drive_file_id: string | null })[]>('SELECT drive_file_id FROM training_materials WHERE id = ?', [id])
  if (!row?.drive_file_id) fail(404, 'Preview tidak tersedia.')
  const fileId = row!.drive_file_id!
  const size = Math.min(1200, Math.max(120, int(new URL(request.url).searchParams.get('s')) ?? 480))
  let thumb = (await driveEnabled().catch(() => false)) ? await fetchThumbnail(fileId, size).catch(() => null) : null
  if (!thumb) {
    const res = await fetch(`https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w${size}`, { redirect: 'follow' }).catch(() => null)
    const type = res?.headers.get('content-type') ?? ''
    if (res?.ok && type.startsWith('image/')) thumb = { data: Buffer.from(await res.arrayBuffer()), type }
  }
  if (!thumb) fail(404, 'Preview tidak tersedia.')
  return new Response(new Uint8Array(thumb!.data), { headers: { 'Content-Type': thumb!.type, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' } })
})
