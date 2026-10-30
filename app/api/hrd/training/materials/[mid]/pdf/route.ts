import type { RowDataPacket } from 'mysql2'
import { fail, handle, int, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { DriveError, drivePdf } from '@/lib/drive'
import { requireTraining } from '@/lib/training'

export const maxDuration = 60

type Ctx = { params: Promise<{ mid: string }> }

// Preview materi sebagai PDF lewat server (akun Google di Master Data), agar karyawan tanpa akses folder tetap bisa melihat
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTraining(user)
  const id = int((await ctx.params).mid) ?? fail(404, 'Materi tidak ditemukan.')
  const [[row]] = await db.query<(RowDataPacket & { drive_file_id: string | null; mime: string | null })[]>('SELECT drive_file_id, mime FROM training_materials WHERE id = ?', [id])
  if (!row?.drive_file_id || !(row.mime === 'application/pdf' || row.mime?.startsWith('application/vnd.google-apps.'))) fail(404, 'Preview tidak tersedia.')
  try {
    const pdf = await drivePdf(row!.drive_file_id!, row!.mime)
    return new Response(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } })
  } catch (error) {
    if (error instanceof DriveError) fail(error.status === 404 ? 404 : 502, error.message)
    throw error
  }
})
