import type { RowDataPacket } from 'mysql2'
import { fail, handle, int, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { driveEnabled, fetchThumbnail } from '@/lib/drive'
import { requireTeknikMenu } from '@/lib/teknik'

type Ctx = { params: Promise<{ id: string }> }

// Thumbnail video SOP lewat server: akun Google di Master Data, atau thumbnail publik Drive bila folder dibagikan publik. ?s=480
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTeknikMenu(user, 'sop-mesin', 'SOP Mesin')
  const id = int((await ctx.params).id) ?? fail(404, 'Video tidak ditemukan.')
  const [[row]] = await db.query<(RowDataPacket & { drive_file_id: string })[]>('SELECT drive_file_id FROM sop_videos WHERE id = ?', [id])
  if (!row) fail(404, 'Video tidak ditemukan.')
  const size = Math.min(1200, Math.max(120, int(new URL(request.url).searchParams.get('s')) ?? 480))
  let thumb = (await driveEnabled().catch(() => false)) ? await fetchThumbnail(row.drive_file_id, size).catch(() => null) : null
  if (!thumb) {
    const res = await fetch(`https://drive.google.com/thumbnail?id=${encodeURIComponent(row.drive_file_id)}&sz=w${size}`, { redirect: 'follow' }).catch(() => null)
    const type = res?.headers.get('content-type') ?? ''
    if (res?.ok && type.startsWith('image/')) thumb = { data: Buffer.from(await res.arrayBuffer()), type }
  }
  if (!thumb) fail(404, 'Preview tidak tersedia.')
  return new Response(new Uint8Array(thumb!.data), {
    headers: { 'Content-Type': thumb!.type, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' },
  })
})
