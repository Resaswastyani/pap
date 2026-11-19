import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { requireMenu } from '@/lib/customers'
import { canEditProjection, loadProjection, readProjection, saveProjection } from '@/lib/material-projection'
import { canViewProduction } from '@/lib/production'
import { softDelete } from '@/lib/recycle-bin'

type Ctx = { params: Promise<{ id: string }> }
const projectionId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Riset / proyeksi tidak ditemukan.')

export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireMenu(user, canViewProduction(user))
  return NextResponse.json({ item: await loadProjection(await projectionId(ctx)), can: { edit: canEditProjection(user) } })
})

export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireMenu(user, canViewProduction(user))
  if (!canEditProjection(user)) fail(403, 'Riset bahan baku diubah oleh PPIC / Purchasing / Kepala Produksi.')
  const id = await projectionId(ctx)
  const old = await loadProjection(id)
  const v = readProjection(await readJson(request))
  await saveProjection(id, v, user.id)
  await logActivity(request, user, {
    module: 'Rencana Produksi', action: 'update', entity: { type: 'material_projection', id, label: v.nama },
    description: `Mengubah riset bahan baku ${old.kode} ${v.nama} (${v.items.length} produk)`,
  })
  return NextResponse.json({ ok: true })
})

// Hapus (masuk Data Terhapus bersama daftar produknya, bisa dipulihkan)
export const DELETE = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireMenu(user, canViewProduction(user))
  if (!canEditProjection(user)) fail(403, 'Riset bahan baku dihapus oleh PPIC / Purchasing / Kepala Produksi.')
  const p = await loadProjection(await projectionId(ctx))
  await softDelete({ table: 'material_projections', id: p.id, modul: 'Riset Bahan Baku', label: `${p.kode} · ${p.nama}`, user })
  await logActivity(request, user, {
    module: 'Rencana Produksi', action: 'delete', entity: { type: 'material_projection', id: p.id, label: p.nama },
    description: `Menghapus riset bahan baku ${p.kode} ${p.nama}`,
  })
  return NextResponse.json({ ok: true })
})
