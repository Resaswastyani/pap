import type { ResultSetHeader } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canManagePermit, readPermit, requirePermit } from '@/lib/permits'
import { softDelete } from '@/lib/recycle-bin'

type Ctx = { params: Promise<{ id: string }> }

async function guard(ctx: Ctx) {
  const user = await requireUser()
  requirePermit(user)
  if (!canManagePermit(user)) fail(403, 'Perizinan dikelola HRD / GA / Accounting.')
  return { user, id: int((await ctx.params).id) ?? fail(404, 'Izin tidak ditemukan.') }
}

export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const { user, id } = await guard(ctx)
  const [res] = await db.query<ResultSetHeader>('UPDATE company_permits SET ?, updated_by = ? WHERE id = ?', [readPermit(await readJson(request)), user.id, id])
  if (!res.affectedRows) fail(404, 'Izin tidak ditemukan.')
  return NextResponse.json({ ok: true })
})

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const { id } = await guard(ctx)
  await softDelete({ table: 'company_permits', id, modul: 'Perizinan', user: await requireUser() })
  return NextResponse.json({ ok: true })
})
