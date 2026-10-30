import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageHr, canViewEmployees } from '@/lib/hrd'
import { listJobdesks, readJobdesk } from '@/lib/jobdesk'

// Daftar jobdesk per jabatan + karyawan aktif dan jobdesk terpasangnya
export const GET = handle(async () => {
  const user = await requireUser()
  if (!canViewEmployees(user)) fail(403, 'Anda tidak punya akses ke menu Karyawan.')
  return NextResponse.json({ ...(await listJobdesks()), can: { manage: canManageHr(user) } })
})

export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  if (!canManageHr(user)) fail(403, 'Jobdesk dikelola HRD.')
  const v = readJobdesk(await readJson(request))
  const [[dup]] = await db.query<RowDataPacket[]>('SELECT id FROM job_descriptions WHERE jabatan = ?', [v.jabatan])
  if (dup) fail(400, `Jobdesk ${v.jabatan} sudah ada.`)
  const [res] = await db.query<ResultSetHeader>('INSERT INTO job_descriptions SET ?, updated_by = ?', [v, user.id])
  return NextResponse.json({ id: res.insertId })
})
