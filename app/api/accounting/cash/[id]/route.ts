import type { ResultSetHeader } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, requireUser } from '@/lib/api'
import { canManageAccounting, requireAccounting } from '@/lib/accounting'
import { db } from '@/lib/db'

type Ctx = { params: Promise<{ id: string }> }

// Hapus catatan pencocokan saldo
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireAccounting(user, 'kas-bank')
  if (!canManageAccounting(user)) fail(403, 'Pencocokan saldo dikelola oleh divisi Accounting.')
  const [res] = await db.query<ResultSetHeader>('DELETE FROM cash_reconciliations WHERE id = ?', [int((await ctx.params).id) ?? 0])
  if (!res.affectedRows) fail(404, 'Catatan tidak ditemukan.')
  return NextResponse.json({ ok: true })
})
