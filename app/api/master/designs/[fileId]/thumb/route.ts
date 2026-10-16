import type { RowDataPacket } from 'mysql2'
import { fail, handle, int, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { fetchThumbnail } from '@/lib/drive'
import { requireMaster } from '@/lib/master'

type Ctx = { params: Promise<{ fileId: string }> }

// Preview gambar desain (thumbnail Google Drive, diambil lewat server). ?s=400 (lebar maksimal px)
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireMaster(user)
  const fileId = str((await ctx.params).fileId, 100)
  // Hanya file yang terdaftar dari folder sumber (bukan sembarang id Drive)
  const [[file]] = await db.query<(RowDataPacket & { id: string })[]>('SELECT id FROM drive_files WHERE id = ?', [fileId])
  if (!file) fail(404, 'File tidak ditemukan.')
  const size = Math.min(1600, Math.max(120, int(new URL(request.url).searchParams.get('s')) ?? 400))
  const thumb = await fetchThumbnail(file.id, size).catch(() => null)
  if (!thumb) fail(404, 'Preview tidak tersedia.')
  return new Response(new Uint8Array(thumb!.data), {
    headers: { 'Content-Type': thumb!.type, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' },
  })
})
