import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageTraining, requireTraining } from '@/lib/training'
import { copyPrograms, listPrograms, nextProgramKode, programYears, readProgram } from '@/lib/training-programs'

const thisYear = () => new Date(Date.now() + 7 * 3600e3).getUTCFullYear()

// Program training tahunan: semua pengguna menu Training melihat; HRD / GM / admin mengelola
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireTraining(user)
  const q = Number(new URL(request.url).searchParams.get('tahun'))
  const tahun = Number.isInteger(q) && q >= 2020 && q <= 2100 ? q : thisYear()
  const [items, years, [modules], [divisi]] = await Promise.all([
    listPrograms(tahun), programYears(),
    db.query<RowDataPacket[]>('SELECT id, judul FROM training_modules WHERE aktif = 1 ORDER BY judul'),
    db.query<RowDataPacket[]>('SELECT DISTINCT divisi FROM employees WHERE divisi IS NOT NULL AND tgl_berhenti IS NULL ORDER BY divisi'),
  ])
  return NextResponse.json({
    tahun, items,
    years: [...new Set([thisYear() + 1, thisYear(), tahun, ...years])].sort((a, b) => b - a),
    modules: modules.map((m) => ({ id: Number(m.id), judul: String(m.judul) })),
    divisi: [...new Set([...divisi.map((d) => String(d.divisi)), 'Operator Produksi'])].sort((a, b) => a.localeCompare(b)),
    can: { manage: canManageTraining(user) },
  })
})

// Tambah program, atau { salin: { dari, ke } } untuk menyalin program tahun lalu
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireTraining(user)
  if (!canManageTraining(user)) fail(403, 'Program training dikelola HRD.')
  const body = await readJson(request)
  if (body.salin && typeof body.salin === 'object') {
    const { dari, ke } = body.salin as { dari: number; ke: number }
    if (!Number.isInteger(Number(dari)) || !Number.isInteger(Number(ke)) || Number(dari) === Number(ke)) fail(400, 'Pilih tahun asal dan tujuan yang berbeda.')
    const res = await copyPrograms(Number(dari), Number(ke), user.id)
    await logActivity(request, user, { module: 'Training', action: 'create', entity: null, description: `Menyalin ${res.added} program training ${dari} ke ${ke}` })
    return NextResponse.json(res)
  }
  const v = readProgram(body)
  const kode = await nextProgramKode(v.tahun)
  const [res] = await db.query<ResultSetHeader>('INSERT INTO training_programs SET ?', [{ ...v, kode, created_by: user.id, updated_by: user.id }])
  await logActivity(request, user, { module: 'Training', action: 'create', entity: { type: 'training_program', id: res.insertId, label: v.nama }, description: `Program training ${kode} ${v.nama}` })
  return NextResponse.json({ id: res.insertId, kode }, { status: 201 })
})
