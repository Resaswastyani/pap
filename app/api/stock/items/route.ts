import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { itemCategories, readMaterialInput, saveMaterial } from '@/lib/materials'
import { requireManageStock, STOCK_CATEGORY_GROUPS } from '@/lib/stock'

// Kategori untuk form barang stok (bahan baku: hanya kategori bahan baku)
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireManageStock(user)
  const jenis = new URL(request.url).searchParams.get('jenis')
  const all = await itemCategories()
  const categories = jenis === 'bahan' ? all.filter((c) => STOCK_CATEGORY_GROUPS.bahan.includes(c.toUpperCase().trim())) : all
  return NextResponse.json({ categories: categories.length ? categories : jenis === 'bahan' ? STOCK_CATEGORY_GROUPS.bahan : all })
})

// Tambah barang langsung di Accurate (Barang & Jasa); salinan SIMPAP ikut diperbarui
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireManageStock(user)
  const body = await readJson(request)
  const jenis = String(body.jenis ?? '')
  if (jenis !== 'bahan' && jenis !== 'jadi') fail(400, 'Jenis stok tidak valid.')
  const v = readMaterialInput({ ...body, type: 'INVENTORY', ...(jenis === 'jadi' ? { diproduksi: true } : { bahan_baku: true }) })
  if (jenis === 'bahan' && !STOCK_CATEGORY_GROUPS.bahan.includes(String(v.category ?? '').toUpperCase().trim())) {
    fail(400, `Kategori bahan baku harus salah satu dari: ${STOCK_CATEGORY_GROUPS.bahan.join(', ')}.`)
  }
  const item = await saveMaterial(v)
  await logActivity(request, user, { module: jenis === 'jadi' ? 'Stok Barang Jadi' : 'Stok Bahan Baku', action: 'create', entity: null, description: `Menambah barang ${item.name} (${item.no}) di Accurate` })
  return NextResponse.json({ item }, { status: 201 })
})
