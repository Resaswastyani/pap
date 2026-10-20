import type { RowDataPacket } from 'mysql2'
import { fail, handle, int, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { fetchThumbnail } from '@/lib/drive'

type Ctx = { params: Promise<{ fileId: string }> }

// Preview foto / video critical point mesin (thumbnail Google Drive lewat server, seperti Master Data desain). ?s=400
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  if (!user.menus.includes('data-mesin') && !user.menus.includes('perbaikan-mesin')) fail(403, 'Anda tidak punya akses ke Data Mesin.')
  const fileId = str((await ctx.params).fileId, 100)
  // Hanya file yang tercantum di data mesin (bukan sembarang id Drive)
  const [[row]] = await db.query<RowDataPacket[]>(
    'SELECT 1 AS ok FROM machine_checkpoints WHERE drive_file_id = ? UNION SELECT 1 FROM machine_documents WHERE drive_file_id = ? LIMIT 1',
    [fileId, fileId],
  )
  if (!row) fail(404, 'File tidak ditemukan.')
  const size = Math.min(1600, Math.max(120, int(new URL(request.url).searchParams.get('s')) ?? 400))
  const thumb = await fetchThumbnail(fileId, size).catch(() => null)
  if (!thumb) fail(404, 'Preview tidak tersedia.')
  return new Response(new Uint8Array(thumb!.data), {
    headers: { 'Content-Type': thumb!.type, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' },
  })
})
