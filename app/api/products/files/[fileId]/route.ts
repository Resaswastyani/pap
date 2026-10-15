import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, requireUser } from '@/lib/api'
import { canManageProduct, canViewProducts, requireMenu } from '@/lib/customers'
import { db } from '@/lib/db'

type Ctx = { params: Promise<{ fileId: string }> }
type FileRow = RowDataPacket & { id: number; product_id: number; name: string; mime: string; size: number; data: Buffer }

// Lihat / cetak / unduh desain. ?download=1 untuk mengunduh, selain itu tampil di browser (bisa langsung dicetak)
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireMenu(user, canViewProducts(user))
  const id = int((await ctx.params).fileId) ?? fail(404, 'File tidak ditemukan.')
  const [[file]] = await db.query<FileRow[]>('SELECT id, product_id, name, mime, size, data FROM customer_product_files WHERE id = ?', [id])
  if (!file) fail(404, 'File tidak ditemukan.')
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

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  if (!canManageProduct(user)) fail(403, 'Anda tidak punya akses untuk menghapus desain.')
  const id = int((await ctx.params).fileId) ?? fail(404, 'File tidak ditemukan.')
  await db.query('DELETE FROM customer_product_files WHERE id = ?', [id])
  return NextResponse.json({ ok: true })
})
