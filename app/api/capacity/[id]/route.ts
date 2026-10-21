import type { ResultSetHeader } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { canManageCapacity, readCapacityInput, requireCapacity } from '@/lib/capacity'
import { db } from '@/lib/db'

type Ctx = { params: Promise<{ id: string }> }

async function guard(ctx: Ctx) {
  const user = await requireUser()
  requireCapacity(user)
  if (!canManageCapacity(user)) fail(403, 'Kapasitas produksi diatur PPIC, kepala Produksi, atau GM.')
  const id = int((await ctx.params).id) ?? fail(404, 'Data kapasitas tidak ditemukan.')
  return { user, id }
}

export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const { user, id } = await guard(ctx)
  const v = readCapacityInput(await readJson(request))
  const [res] = await db.query<ResultSetHeader>(
    `UPDATE production_capacities SET jenis_plastik = ?, lebar_maks_cm = ?, kapasitas_maks_ton = ?, efisiensi_pct = ?, mesin = ?, jumlah_mesin = ?, catatan = ?, updated_by = ?
     WHERE id = ?`,
    [v.jenis_plastik, v.lebar_maks_cm, v.kapasitas_maks_ton, v.efisiensi_pct, v.mesin, v.jumlah_mesin, v.catatan, user.id, id],
  )
  if (!res.affectedRows) fail(404, 'Data kapasitas tidak ditemukan.')
  return NextResponse.json({ ok: true })
})

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const { id } = await guard(ctx)
  const [res] = await db.query<ResultSetHeader>('DELETE FROM production_capacities WHERE id = ?', [id])
  if (!res.affectedRows) fail(404, 'Data kapasitas tidak ditemukan.')
  return NextResponse.json({ ok: true })
})
