import type { ResultSetHeader } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, requireUser } from '@/lib/api'
import { canManageAccounting, requireAccounting } from '@/lib/accounting'
import { db } from '@/lib/db'
import { softDelete } from '@/lib/recycle-bin'

type Ctx = { params: Promise<{ id: string }> }

// Hapus catatan pencocokan saldo
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireAccounting(user, 'kas-bank')
  if (!canManageAccounting(user)) fail(403, 'Pencocokan saldo dikelola oleh divisi Accounting.')
  await softDelete({ table: 'cash_reconciliations', id: int((await ctx.params).id) ?? 0, modul: 'Kas & Bank', label: 'Pencocokan saldo', user })
  return NextResponse.json({ ok: true })
})
