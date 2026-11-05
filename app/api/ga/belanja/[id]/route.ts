import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { canManageBelanja, loadBelanja, readBelanjaInput, requireBelanja, requireBelanjaManage, saveBelanja } from '@/lib/belanja'
import { softDelete } from '@/lib/recycle-bin'

type Ctx = { params: Promise<{ id: string }> }
const notaId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Catatan belanja tidak ditemukan.')

export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireBelanja(user)
  return NextResponse.json({ item: await loadBelanja(await notaId(ctx)), can: { manage: canManageBelanja(user) } })
})

// Ubah nota (item diganti seluruhnya dengan isi form)
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireBelanjaManage(user)
  const item = await loadBelanja(await notaId(ctx))
  await saveBelanja(readBelanjaInput(await readJson(request)), user.id, item.id)
  return NextResponse.json({ item: await loadBelanja(item.id) })
})

// Hapus -> Data Terhapus (bisa dipulihkan)
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireBelanjaManage(user)
  const id = await notaId(ctx)
  const item = await loadBelanja(id)
  await softDelete({ table: 'ga_belanja', id, modul: 'Belanja ATK & RTK', label: `${item.kategori} ${item.tanggal}${item.toko ? ` · ${item.toko}` : ''}`, user })
  return NextResponse.json({ ok: true })
})
