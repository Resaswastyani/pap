import type { RowDataPacket } from 'mysql2'
import { fail, handle, int, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { fetchThumbnail } from '@/lib/drive'
import { requireOrderCustom } from '@/lib/order-custom'

type Ctx = { params: Promise<{ fileId: string }> }

// Preview desain Master Data untuk pengguna Checklist Order Custom (PPIC / Operasional tidak harus punya menu Master Data)
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  if (!user.menus.includes('dokumen-order' as never)) requireOrderCustom(user)
  const fileId = str((await ctx.params).fileId, 100)
  const [[file]] = await db.query<(RowDataPacket & { id: string })[]>('SELECT id FROM drive_files WHERE id = ?', [fileId])
  if (!file) fail(404, 'File tidak ditemukan.')
  const size = Math.min(1200, Math.max(120, int(new URL(request.url).searchParams.get('s')) ?? 400))
  const thumb = await fetchThumbnail(file.id, size).catch(() => null)
  if (!thumb) fail(404, 'Preview tidak tersedia.')
  return new Response(new Uint8Array(thumb!.data), {
    headers: { 'Content-Type': thumb!.type, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' },
  })
})
