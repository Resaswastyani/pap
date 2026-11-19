import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { requireMenu } from '@/lib/customers'
import { canEditProjection, listProjections, readProjection, saveProjection } from '@/lib/material-projection'
import { canViewProduction } from '@/lib/production'

// Riset & Proyeksi bahan baku: daftar dokumen + ringkasan hitungannya
export const GET = handle(async () => {
  const user = await requireUser()
  requireMenu(user, canViewProduction(user))
  return NextResponse.json({ items: await listProjections(), can: { edit: canEditProjection(user) } })
})

// Buat riset baru
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireMenu(user, canViewProduction(user))
  if (!canEditProjection(user)) fail(403, 'Riset bahan baku dibuat oleh PPIC / Purchasing / Kepala Produksi.')
  const v = readProjection(await readJson(request))
  const res = await saveProjection(null, v, user.id)
  await logActivity(request, user, {
    module: 'Rencana Produksi', action: 'create', entity: { type: 'material_projection', id: res.id, label: v.nama },
    description: `Riset bahan baku ${res.kode} ${v.nama} (${v.items.length} produk)`,
  })
  return NextResponse.json({ ok: true, ...res })
})
