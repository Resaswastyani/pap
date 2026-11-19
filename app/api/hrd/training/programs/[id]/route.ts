import type { ResultSetHeader } from 'mysql2'
import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { softDelete } from '@/lib/recycle-bin'
import { canManageTraining, requireTraining } from '@/lib/training'
import { loadProgram, nextProgramKode, readProgram } from '@/lib/training-programs'

type Ctx = { params: Promise<{ id: string }> }
const programId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Program training tidak ditemukan.')

// Detail program + sesi Jadwal Training yang terhubung
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTraining(user)
  return NextResponse.json({ item: await loadProgram(await programId(ctx)), can: { manage: canManageTraining(user) } })
})

export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTraining(user)
  if (!canManageTraining(user)) fail(403, 'Program training dikelola HRD.')
  const id = await programId(ctx)
  const old = await loadProgram(id)
  const v = readProgram(await readJson(request))
  // Pindah tahun: kode ikut tahun baru
  const kode = v.tahun !== old.tahun ? await nextProgramKode(v.tahun) : old.kode
  const [res] = await db.query<ResultSetHeader>('UPDATE training_programs SET ? WHERE id = ?', [{ ...v, kode, updated_by: user.id }, id])
  if (!res.affectedRows) fail(404, 'Program training tidak ditemukan.')
  await logActivity(request, user, { module: 'Training', action: 'update', entity: { type: 'training_program', id, label: v.nama }, description: `Mengubah program training ${kode} ${v.nama}` })
  return NextResponse.json({ ok: true, kode })
})

// Hapus (masuk Data Terhapus, bisa dipulihkan); sesi yang terhubung tetap ada tanpa program
export const DELETE = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTraining(user)
  if (!canManageTraining(user)) fail(403, 'Program training dikelola HRD.')
  const p = await loadProgram(await programId(ctx))
  await softDelete({ table: 'training_programs', id: p.id, modul: 'Program Training', label: `${p.kode} · ${p.nama}`, user })
  await logActivity(request, user, { module: 'Training', action: 'delete', entity: { type: 'training_program', id: p.id, label: p.nama }, description: `Menghapus program training ${p.kode} ${p.nama}` })
  return NextResponse.json({ ok: true })
})
