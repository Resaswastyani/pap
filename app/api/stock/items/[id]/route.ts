import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { deleteMaterial, materialForEdit, readMaterialInput, saveMaterial } from '@/lib/materials'
import { requireManageStock } from '@/lib/stock'

type Ctx = { params: Promise<{ id: string }> }
const itemId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Barang tidak ditemukan.')

// Isian form ubah, langsung dari Accurate (data terbaru)
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireManageStock(user)
  return NextResponse.json({ item: await materialForEdit(await itemId(ctx)) })
})

// Ubah data barang di Accurate (nama, kode, kategori, satuan, stok minimum, harga beli)
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireManageStock(user)
  const id = await itemId(ctx)
  const body = await readJson(request)
  const old = await materialForEdit(id)
  // Tanda "Diproduksi" / "Bahan Baku" mengikuti data lama di Accurate
  const v = readMaterialInput({ ...body, type: old.type, bahan_baku: old.bahan_baku, ...(old.diproduksi ? { diproduksi: true } : {}) })
  const item = await saveMaterial(v, id)
  await logActivity(request, user, { module: 'Stok', action: 'update', entity: null, description: `Mengubah barang ${item.name} (${item.no}) di Accurate` })
  return NextResponse.json({ item })
})

// Hapus di Accurate; barang yang sudah dipakai transaksi dinonaktifkan
export const DELETE = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireManageStock(user)
  const res = await deleteMaterial(await itemId(ctx))
  await logActivity(request, user, { module: 'Stok', action: 'delete', entity: null, description: `${res.deleted ? 'Menghapus' : 'Menonaktifkan'} barang ${res.name} di Accurate` })
  return NextResponse.json(res)
})
