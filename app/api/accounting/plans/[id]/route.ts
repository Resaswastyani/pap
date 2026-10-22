import type { ResultSetHeader } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { canManageAccounting, requireAccounting } from '@/lib/accounting'
import { readPlan } from '@/lib/accounting-input'
import { db } from '@/lib/db'

type Ctx = { params: Promise<{ id: string }> }
async function guard(ctx: Ctx) {
  const user = await requireUser()
  requireAccounting(user, 'arus-kas')
  if (!canManageAccounting(user)) fail(403, 'Rencana kas dikelola oleh divisi Accounting.')
  return int((await ctx.params).id) ?? fail(404, 'Rencana tidak ditemukan.')
}

export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const id = await guard(ctx)
  const v = readPlan(await readJson(request))
  const [res] = await db.query<ResultSetHeader>(
    'UPDATE cash_plans SET jenis = ?, kategori = ?, keterangan = ?, tanggal = ?, nominal = ?, berulang = ?, sampai = ?, aktif = ? WHERE id = ?',
    [v.jenis, v.kategori, v.keterangan, v.tanggal, v.nominal, v.berulang, v.sampai, v.aktif, id],
  )
  if (!res.affectedRows) fail(404, 'Rencana tidak ditemukan.')
  return NextResponse.json({ ok: true })
})

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const id = await guard(ctx)
  const [res] = await db.query<ResultSetHeader>('DELETE FROM cash_plans WHERE id = ?', [id])
  if (!res.affectedRows) fail(404, 'Rencana tidak ditemukan.')
  return NextResponse.json({ ok: true })
})
