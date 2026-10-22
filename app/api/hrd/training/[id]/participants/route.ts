import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageTraining, requireTraining } from '@/lib/training'

type Ctx = { params: Promise<{ id: string }> }
const STATUS = ['terdaftar', 'selesai', 'tidak_lulus']

// Catat peserta (bisa banyak sekaligus): { employee_ids: [], status, tanggal, nilai, catatan }
export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTraining(user)
  if (!canManageTraining(user)) fail(403, 'Peserta training dicatat HRD.')
  const id = int((await ctx.params).id) ?? fail(404, 'Modul training tidak ditemukan.')
  const body = await readJson(request)
  const ids = [...new Set((Array.isArray(body.employee_ids) ? body.employee_ids : []).map((x) => int(x)).filter((x): x is number => !!x))]
  if (!ids.length) fail(400, 'Pilih minimal satu karyawan.')
  if (ids.length > 500) fail(400, 'Maksimal 500 karyawan sekaligus.')
  const status = str(body.status, 20) || 'terdaftar'
  if (!STATUS.includes(status)) fail(400, 'Status tidak valid.')
  const tanggal = str(body.tanggal, 10) || null
  if (tanggal && !/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) fail(400, 'Tanggal tidak valid.')
  const nilai = body.nilai === '' || body.nilai == null ? null : Number(String(body.nilai).replace(',', '.'))
  if (nilai !== null && (!Number.isFinite(nilai) || nilai < 0 || nilai > 100)) fail(400, 'Nilai harus 0–100.')
  await db.query(
    `INSERT INTO training_participants (module_id, employee_id, status, tanggal, nilai, catatan, updated_by) VALUES ?
     ON DUPLICATE KEY UPDATE status = VALUES(status), tanggal = COALESCE(VALUES(tanggal), tanggal), nilai = COALESCE(VALUES(nilai), nilai),
       catatan = COALESCE(VALUES(catatan), catatan), updated_by = VALUES(updated_by)`,
    [ids.map((e) => [id, e, status, tanggal, nilai, str(body.catatan, 500) || null, user.id])],
  )
  return NextResponse.json({ ok: true, jumlah: ids.length })
})

// Hapus peserta: ?employee_id=
export const DELETE = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTraining(user)
  if (!canManageTraining(user)) fail(403, 'Peserta training dicatat HRD.')
  const id = int((await ctx.params).id) ?? fail(404, 'Modul training tidak ditemukan.')
  const employee = int(new URL(request.url).searchParams.get('employee_id')) ?? fail(400, 'Karyawan tidak valid.')
  await db.query('DELETE FROM training_participants WHERE module_id = ? AND employee_id = ?', [id, employee])
  return NextResponse.json({ ok: true })
})
