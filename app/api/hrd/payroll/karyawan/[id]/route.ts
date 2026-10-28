import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageHr, canViewPayroll } from '@/lib/hrd'
import { updatePayroll } from '@/lib/payroll'
import type { UserProfile } from '@/lib/users'
import { softDelete } from '@/lib/recycle-bin'

type Ctx = { params: Promise<{ id: string }> }

async function target(user: UserProfile, ctx: Ctx) {
  if (!canViewPayroll(user) || !canManageHr(user)) fail(403, 'Pengaturan gaji dikelola HRD.')
  return int((await ctx.params).id) ?? fail(404, 'Pengaturan gaji tidak ditemukan.')
}

export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  const id = await target(user, ctx)
  await updatePayroll(id, await readJson(request), user.id)
  return NextResponse.json({ ok: true })
})

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  const id = await target(user, ctx)
  await softDelete({ table: 'employee_payrolls', id, modul: 'Gaji Karyawan', user })
  return NextResponse.json({ ok: true })
})
