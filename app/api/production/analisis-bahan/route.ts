import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { requireMenu } from '@/lib/customers'
import { analyzeMaterials, canEditMaterialPrice, readOptions, saveMaterialPrice } from '@/lib/material-analysis'
import { canViewProduction } from '@/lib/production'

export const maxDuration = 60

// Analisis Bahan Baku: ?sumber=rencana|realisasi|pesanan&from=YYYY-MM-DD&to=YYYY-MM-DD&harga=rata|po&ppn=1
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireMenu(user, canViewProduction(user))
  const result = await analyzeMaterials(readOptions(new URL(request.url).searchParams))
  return NextResponse.json({ ...result, can: { price: canEditMaterialPrice(user) } })
})

// Harga acuan bahan: { item_accurate_id, harga (null = pakai harga Accurate), catatan }
export const PUT = handle(async (request: Request) => {
  const user = await requireUser()
  requireMenu(user, canViewProduction(user))
  if (!canEditMaterialPrice(user)) fail(403, 'Harga acuan bahan diatur PPIC / Purchasing / Kepala Produksi.')
  const res = await saveMaterialPrice(await readJson(request), user.id)
  await logActivity(request, user, {
    module: 'Rencana Produksi', action: 'update', entity: null,
    description: res.harga === null ? `Harga acuan bahan ${res.name} dihapus (kembali ke harga Accurate)` : `Harga acuan bahan ${res.name}: Rp ${Math.round(res.harga).toLocaleString('id-ID')}`,
  })
  return NextResponse.json({ ok: true })
})
