import type { ResultSetHeader } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canManagePermit, listPermits, PERMIT_KATEGORI, readPermit, requirePermit } from '@/lib/permits'

// Perizinan perusahaan: daftar izin + status masa berlaku
export const GET = handle(async () => {
  const user = await requireUser()
  requirePermit(user)
  return NextResponse.json({ items: await listPermits(), kategori: PERMIT_KATEGORI, can: { manage: canManagePermit(user) } })
})

export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requirePermit(user)
  if (!canManagePermit(user)) fail(403, 'Perizinan dikelola HRD / GA / Accounting.')
  const v = readPermit(await readJson(request))
  const [res] = await db.query<ResultSetHeader>('INSERT INTO company_permits SET ?, created_by = ?, updated_by = ?', [v, user.id, user.id])
  return NextResponse.json({ id: res.insertId })
})
