import type { ResultSetHeader } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageHr, canViewPayroll } from '@/lib/hrd'
import { readOvertime } from '@/lib/payroll-overtime'

type Ctx = { params: Promise<{ id: string }> }
async function guard(ctx: Ctx) {
  const user = await requireUser()
  if (!canViewPayroll(user) || !canManageHr(user)) fail(403, 'Lembur manual dikelola oleh HRD.')
  return int((await ctx.params).id) ?? fail(404, 'Data lembur tidak ditemukan.')
}

export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const id = await guard(ctx)
  const v = await readOvertime(await readJson(request))
  const [res] = await db.query<ResultSetHeader>(
    'UPDATE overtime_entries SET nip = ?, tanggal = ?, jam = ?, hari = ?, mode = ?, keterangan = ? WHERE id = ?',
    [v.nip, v.tanggal, v.jam, v.hari, v.mode, v.keterangan, id],
  )
  if (!res.affectedRows) fail(404, 'Data lembur tidak ditemukan.')
  return NextResponse.json({ ok: true })
})

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const id = await guard(ctx)
  const [res] = await db.query<ResultSetHeader>('DELETE FROM overtime_entries WHERE id = ?', [id])
  if (!res.affectedRows) fail(404, 'Data lembur tidak ditemukan.')
  return NextResponse.json({ ok: true })
})
