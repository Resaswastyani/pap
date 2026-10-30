import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageHr } from '@/lib/hrd'
import { readJobdesk } from '@/lib/jobdesk'
import { softDelete } from '@/lib/recycle-bin'

type Ctx = { params: Promise<{ id: string }> }

async function guard(ctx: Ctx) {
  const user = await requireUser()
  if (!canManageHr(user)) fail(403, 'Jobdesk dikelola HRD.')
  return { user, id: int((await ctx.params).id) ?? fail(404, 'Jobdesk tidak ditemukan.') }
}

export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const { user, id } = await guard(ctx)
  const v = readJobdesk(await readJson(request))
  const [[dup]] = await db.query<RowDataPacket[]>('SELECT id FROM job_descriptions WHERE jabatan = ? AND id <> ?', [v.jabatan, id])
  if (dup) fail(400, `Jobdesk ${v.jabatan} sudah ada.`)
  const [res] = await db.query<ResultSetHeader>('UPDATE job_descriptions SET ?, updated_by = ? WHERE id = ?', [v, user.id, id])
  if (!res.affectedRows) fail(404, 'Jobdesk tidak ditemukan.')
  return NextResponse.json({ ok: true })
})

// Masuk Data Terhapus bersama pemasangannya ke karyawan, sehingga bisa dipulihkan
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const { user, id } = await guard(ctx)
  await softDelete({ table: 'job_descriptions', id, modul: 'Jobdesk', user })
  return NextResponse.json({ ok: true })
})
