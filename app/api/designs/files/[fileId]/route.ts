import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { loadDesign, requireRequestMenu } from '@/lib/requests'

type Ctx = { params: Promise<{ fileId: string }> }
type FileRow = RowDataPacket & { id: number; design_id: number; name: string; mime: string; size: number; data: Buffer; uploaded_by: number }

async function loadFile(ctx: Ctx) {
  const id = int((await ctx.params).fileId) ?? fail(404, 'File tidak ditemukan.')
  const [[file]] = await db.query<FileRow[]>('SELECT id, design_id, name, mime, size, data, uploaded_by FROM design_request_files WHERE id = ?', [id])
  return file ?? fail(404, 'File tidak ditemukan.')
}

// Lihat / unduh file desain (?download=1). Akses mengikuti akses request desainnya.
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireRequestMenu(user, 'desain')
  const file = await loadFile(ctx)
  await loadDesign(file.design_id, user)
  const download = new URL(request.url).searchParams.get('download') === '1'
  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      'Content-Type': file.mime,
      'Content-Length': String(file.size),
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  })
})

// Hapus file yang diunggah sendiri, selama belum dipakai sebagai desain final
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireRequestMenu(user, 'desain')
  const file = await loadFile(ctx)
  const design = await loadDesign(file.design_id, user)
  if (file.uploaded_by !== user.id && !user.role.isAdmin) fail(403, 'Hanya pengunggah yang dapat menghapus file.')
  if (design.final_file_id === file.id || ['disetujui', 'batal'].includes(design.status)) fail(400, 'File pada request yang sudah selesai tidak dapat dihapus.')
  await db.query('DELETE FROM design_request_files WHERE id = ?', [file.id])
  return NextResponse.json({ ok: true })
})
