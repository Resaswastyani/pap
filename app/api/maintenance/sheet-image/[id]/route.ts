import type { RowDataPacket } from 'mysql2'
import { fail, handle, int, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { requireMaintenanceSheet } from '@/lib/maintenance-sheet'

type Ctx = { params: Promise<{ id: string }> }

// Gambar part Lembar Perawatan Mesin (dari spreadsheet Google Drive)
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireMaintenanceSheet(user)
  const id = int((await ctx.params).id) ?? fail(404, 'Gambar tidak ditemukan.')
  const [[img]] = await db.query<(RowDataPacket & { mime: string; data: Buffer; name: string | null })[]>('SELECT mime, data, name FROM maintenance_sheet_images WHERE id = ?', [id])
  if (!img) fail(404, 'Gambar tidak ditemukan.')
  return new Response(new Uint8Array(img.data), {
    headers: { 'Content-Type': img.mime, 'Cache-Control': 'private, max-age=86400', 'Content-Disposition': `inline; filename="${(img.name ?? 'gambar').replace(/[^\w.-]+/g, '_')}"` },
  })
})
