import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageMaster, readPackagingInput } from '@/lib/master'
import { softDelete } from '@/lib/recycle-bin'

type Ctx = { params: Promise<{ id: string }> }

export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  if (!canManageMaster(user)) fail(403, 'Hanya Admin / Super Admin yang dapat mengubah master data.')
  const id = int((await ctx.params).id) ?? fail(404, 'Data tidak ditemukan.')
  const input = readPackagingInput(await readJson(request))
  await db.query(
    'UPDATE packaging_types SET kode = ?, nama = ?, bahan = ?, proses = ?, ketebalan = ?, kegunaan = ?, keterangan = ?, status = ?, updated_by = ? WHERE id = ?',
    [input.kode, input.nama, input.bahan, input.proses, input.ketebalan, input.kegunaan, input.keterangan, input.status, user.id, id],
  )
  return NextResponse.json({ ok: true })
})

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  if (!canManageMaster(user)) fail(403, 'Hanya Admin / Super Admin yang dapat mengubah master data.')
  await softDelete({ table: 'packaging_types', id: int((await ctx.params).id) ?? 0, modul: 'Master Data', user })
  return NextResponse.json({ ok: true })
})
