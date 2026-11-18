import { NextResponse } from 'next/server'
import type { ResultSetHeader } from 'mysql2'
import { logActivity } from '@/lib/activity'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { loadEmployeeRow } from '@/lib/employees'
import { employeeTests, readTestInput, TEST_JENIS } from '@/lib/employee-profile'
import { canManageHr } from '@/lib/hrd'

type Ctx = { params: Promise<{ id: string }> }

// Hasil tes karyawan (Papikostik, IQ, tes mata): HRD / GM / admin
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  if (!canManageHr(user)) fail(403, 'Hasil tes karyawan hanya untuk HRD.')
  const id = int((await ctx.params).id) ?? fail(404, 'Karyawan tidak ditemukan.')
  return NextResponse.json({ items: await employeeTests(id) })
})

export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  if (!canManageHr(user)) fail(403, 'Hasil tes karyawan dikelola oleh HRD.')
  const id = int((await ctx.params).id) ?? fail(404, 'Karyawan tidak ditemukan.')
  const emp = await loadEmployeeRow(id)
  const v = readTestInput(await readJson(request))
  const [res] = await db.query<ResultSetHeader>(
    'INSERT INTO employee_tests (employee_id, jenis, tanggal, hasil, skor, catatan, lampiran_url, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, v.jenis, v.tanggal, v.hasil, v.skor, v.catatan, v.lampiran_url, user.id],
  )
  await logActivity(request, user, { module: 'Karyawan', action: 'create', entity: { type: 'karyawan', id, label: String(emp.nama) }, description: `Menambah hasil ${TEST_JENIS[v.jenis]} ${emp.nama}` })
  return NextResponse.json({ id: res.insertId }, { status: 201 })
})
