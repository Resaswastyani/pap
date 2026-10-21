import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { LOG_SELECT, loadPlan, readPlanInput, serializeLog } from '@/lib/maintenance'
import { canManageTeknik, requireTeknikMenu } from '@/lib/teknik'

type Ctx = { params: Promise<{ id: string }> }
const planId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Jadwal perawatan tidak ditemukan.')

// Detail jadwal + riwayat checkup-nya
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTeknikMenu(user, 'perawatan-mesin', 'Perawatan Mesin')
  const plan = await loadPlan(await planId(ctx))
  const [logs] = await db.query<RowDataPacket[]>(`${LOG_SELECT} WHERE l.plan_id = ? ORDER BY l.tanggal DESC, l.id DESC LIMIT 100`, [plan.id])
  return NextResponse.json({ item: plan, logs: logs.map(serializeLog), can: { manage: canManageTeknik(user) } })
})

// Ubah jadwal; kirim { aktif } saja untuk menonaktifkan / mengaktifkan kembali
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTeknikMenu(user, 'perawatan-mesin', 'Perawatan Mesin')
  if (!canManageTeknik(user)) fail(403, 'Jadwal perawatan diatur oleh divisi Teknik.')
  const plan = await loadPlan(await planId(ctx))
  const body = await readJson(request)
  if (Object.keys(body).length === 1 && 'aktif' in body) {
    await db.query('UPDATE maintenance_plans SET aktif = ? WHERE id = ?', [body.aktif ? 1 : 0, plan.id])
  } else {
    const input = await readPlanInput(body)
    await db.query(
      'UPDATE maintenance_plans SET machine_id = ?, judul = ?, komponen = ?, interval_hari = ?, berikutnya = ?, pic_id = ?, catatan = ? WHERE id = ?',
      [input.machineId, input.judul, input.komponen, input.interval, input.berikutnya, input.picId, input.catatan, plan.id],
    )
  }
  return NextResponse.json({ item: await loadPlan(plan.id) })
})

// Hapus jadwal (riwayat checkup tetap tersimpan, tanpa jadwal)
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTeknikMenu(user, 'perawatan-mesin', 'Perawatan Mesin')
  if (!canManageTeknik(user)) fail(403, 'Jadwal perawatan diatur oleh divisi Teknik.')
  const plan = await loadPlan(await planId(ctx))
  await db.query('DELETE FROM maintenance_plans WHERE id = ?', [plan.id])
  return NextResponse.json({ ok: true })
})
