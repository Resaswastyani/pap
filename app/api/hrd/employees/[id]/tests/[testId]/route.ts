import { NextResponse } from 'next/server'
import type { ResultSetHeader } from 'mysql2'
import { logActivity } from '@/lib/activity'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { readTestInput, TEST_JENIS } from '@/lib/employee-profile'
import { canManageHr } from '@/lib/hrd'

type Ctx = { params: Promise<{ id: string; testId: string }> }

async function target(ctx: Ctx) {
  const p = await ctx.params
  return { id: int(p.id) ?? fail(404, 'Karyawan tidak ditemukan.'), testId: int(p.testId) ?? fail(404, 'Hasil tes tidak ditemukan.') }
}

export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  if (!canManageHr(user)) fail(403, 'Hasil tes karyawan dikelola oleh HRD.')
  const { id, testId } = await target(ctx)
  const v = readTestInput(await readJson(request))
  const [res] = await db.query<ResultSetHeader>(
    'UPDATE employee_tests SET jenis = ?, tanggal = ?, hasil = ?, skor = ?, catatan = ?, lampiran_url = ? WHERE id = ? AND employee_id = ?',
    [v.jenis, v.tanggal, v.hasil, v.skor, v.catatan, v.lampiran_url, testId, id],
  )
  if (!res.affectedRows) fail(404, 'Hasil tes tidak ditemukan.')
  await logActivity(request, user, { module: 'Karyawan', action: 'update', entity: { type: 'karyawan', id }, description: `Mengubah hasil ${TEST_JENIS[v.jenis]} karyawan #${id}` })
  return NextResponse.json({ ok: true })
})

export const DELETE = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  if (!canManageHr(user)) fail(403, 'Hasil tes karyawan dikelola oleh HRD.')
  const { id, testId } = await target(ctx)
  const [res] = await db.query<ResultSetHeader>('DELETE FROM employee_tests WHERE id = ? AND employee_id = ?', [testId, id])
  if (!res.affectedRows) fail(404, 'Hasil tes tidak ditemukan.')
  await logActivity(request, user, { module: 'Karyawan', action: 'delete', entity: { type: 'karyawan', id }, description: `Menghapus hasil tes karyawan #${id}` })
  return NextResponse.json({ ok: true })
})
