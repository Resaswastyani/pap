import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { loadInventaris, requireInventaris, requireInventarisManage } from '@/lib/inventaris'

type Ctx = { params: Promise<{ id: string }> }
const itemId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Barang inventaris tidak ditemukan.')
// Foto dikompres di browser (<= 2 MB)
const FOTO_MAX = 2 * 1024 * 1024
const FOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']

// Foto barang; URL memuat ?v=<versi>, jadi aman di-cache lama
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireInventaris(user)
  const [[row]] = await db.query<(RowDataPacket & { foto: Buffer | null; foto_mime: string | null })[]>('SELECT foto, foto_mime FROM ga_inventaris WHERE id = ?', [await itemId(ctx)])
  if (!row?.foto) fail(404, 'Foto tidak ada.')
  return new Response(new Uint8Array(row.foto!), {
    headers: { 'Content-Type': row.foto_mime ?? 'image/jpeg', 'Cache-Control': 'private, max-age=2592000, immutable', 'X-Content-Type-Options': 'nosniff' },
  })
})

export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireInventarisManage(user)
  const item = await loadInventaris(await itemId(ctx))
  const form = await request.formData().catch(() => fail(400, 'Data upload tidak valid.'))
  const file = form.get('file')
  if (!(file instanceof File) || !file.size) fail(400, 'Pilih foto terlebih dahulu.')
  const photo = file as File
  if (!FOTO_TYPES.includes(photo.type)) fail(400, 'Foto harus berupa gambar JPG, PNG, atau WEBP.')
  if (photo.size > FOTO_MAX) fail(400, 'Ukuran foto maksimal 2 MB.')
  await db.query('UPDATE ga_inventaris SET foto = ?, foto_mime = ?, foto_at = NOW() WHERE id = ?', [Buffer.from(await photo.arrayBuffer()), photo.type, item.id])
  return NextResponse.json({ item: await loadInventaris(item.id) })
})

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireInventarisManage(user)
  const item = await loadInventaris(await itemId(ctx))
  await db.query('UPDATE ga_inventaris SET foto = NULL, foto_mime = NULL, foto_at = NULL WHERE id = ?', [item.id])
  return NextResponse.json({ item: await loadInventaris(item.id) })
})
