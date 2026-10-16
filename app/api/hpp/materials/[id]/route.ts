import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canEditPrices, readMaterialInput, requireHpp } from '@/lib/hpp'

type Ctx = { params: Promise<{ id: string }> }

// Ubah bahan baku; perubahan harga dicatat di riwayat harga
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireHpp(user)
  if (!canEditPrices(user)) fail(403, 'Hanya Purchasing / Admin / GM yang dapat mengubah bahan baku.')
  const id = int((await ctx.params).id) ?? fail(404, 'Bahan tidak ditemukan.')
  const [[old]] = await db.query<(RowDataPacket & { harga: string })[]>('SELECT harga FROM raw_materials WHERE id = ?', [id])
  if (!old) fail(404, 'Bahan tidak ditemukan.')
  const m = readMaterialInput(await readJson(request))
  await db.query(
    'UPDATE raw_materials SET kode = ?, nama = ?, jenis = ?, satuan = ?, harga = ?, density = ?, keterangan = ?, aktif = ?, updated_by = ? WHERE id = ?',
    [m.kode, m.nama, m.jenis, m.satuan, m.harga, m.density, m.keterangan, m.aktif, user.id, id],
  )
  if (Number(old.harga) !== m.harga) await db.query('INSERT INTO raw_material_prices (material_id, harga, updated_by) VALUES (?, ?, ?)', [id, m.harga, user.id])
  return NextResponse.json({ ok: true })
})

// Riwayat harga
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireHpp(user)
  const id = int((await ctx.params).id) ?? fail(404, 'Bahan tidak ditemukan.')
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT p.harga, p.created_at, u.name AS updated_by_name FROM raw_material_prices p LEFT JOIN users u ON u.id = p.updated_by WHERE p.material_id = ? ORDER BY p.id DESC LIMIT 50',
    [id],
  )
  return NextResponse.json({ items: rows.map((r) => ({ ...r, harga: Number(r.harga) })) })
})
