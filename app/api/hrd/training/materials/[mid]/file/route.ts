import type { RowDataPacket } from 'mysql2'
import { fail, handle, int, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { requireTraining } from '@/lib/training'

type Ctx = { params: Promise<{ mid: string }> }

// Hanya tipe berikut yang dibuka di browser; lainnya (termasuk HTML / SVG) selalu diunduh
const INLINE = /^(application\/pdf|image\/(png|jpeg|gif|webp)|video\/(mp4|webm))$/

// File materi yang diunggah HRD
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTraining(user)
  const id = int((await ctx.params).mid) ?? fail(404, 'Materi tidak ditemukan.')
  const [[row]] = await db.query<(RowDataPacket & { nama_file: string; data: Buffer; mime: string | null })[]>(
    'SELECT f.nama_file, f.data, m.mime FROM training_material_files f JOIN training_materials m ON m.id = f.material_id WHERE f.material_id = ?', [id],
  )
  if (!row) fail(404, 'File tidak ditemukan.')
  const mime = row!.mime ?? 'application/octet-stream'
  const inline = INLINE.test(mime)
  return new Response(new Uint8Array(row!.data), {
    headers: {
      'Content-Type': inline ? mime : 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row!.nama_file)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  })
})
