import type { ResultSetHeader } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, requireUser } from '@/lib/api'
import { canManageAccounting, requireAccounting } from '@/lib/accounting'
import { db } from '@/lib/db'

type Ctx = { params: Promise<{ id: string }> }

// Hapus catatan setor / lapor pajak (kembali ke status belum)
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireAccounting(user, 'pajak')
  if (!canManageAccounting(user)) fail(403, 'Pelaporan pajak dikelola oleh divisi Accounting.')
  const [res] = await db.query<ResultSetHeader>('DELETE FROM tax_filings WHERE id = ?', [int((await ctx.params).id) ?? 0])
  if (!res.affectedRows) fail(404, 'Catatan tidak ditemukan.')
  return NextResponse.json({ ok: true })
})
