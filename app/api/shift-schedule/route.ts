import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { softDelete } from '@/lib/recycle-bin'
import { canSyncShift, createShiftSchedule, getShiftSchedule, isShiftPeriode, requireShift } from '@/lib/shift-schedule'

async function manager() {
  const user = await requireUser()
  requireShift(user)
  if (!canSyncShift(user)) fail(403, 'Jadwal shift dikelola PPIC, HRD, dan kepala Produksi.')
  return user
}

// Jadwal shift satu bulan (?periode=2026-10), default bulan ini / jadwal terbaru
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireShift(user)
  const periode = new URL(request.url).searchParams.get('periode')
  return NextResponse.json({ ...(await getShiftSchedule(periode)), canSync: canSyncShift(user) })
})

// Buat jadwal bulan baru: { periode, salin_karyawan } (karyawan disalin dari jadwal bulan sebelumnya, tanggal kosong)
export const POST = handle(async (request: Request) => {
  const user = await manager()
  const body = await readJson(request)
  if (!isShiftPeriode(body.periode)) fail(400, 'Bulan tidak valid.')
  return NextResponse.json(await createShiftSchedule(body.periode as string, user.id, body.salin_karyawan !== false), { status: 201 })
})

// Hapus jadwal satu bulan (?periode=YYYY-MM); masuk Data Terhapus. Tab di Google Sheet tidak ikut dihapus.
export const DELETE = handle(async (request: Request) => {
  const user = await manager()
  const periode = new URL(request.url).searchParams.get('periode')
  if (!isShiftPeriode(periode)) fail(400, 'Bulan tidak valid.')
  const [[row]] = await db.query<(RowDataPacket & { id: number })[]>('SELECT id FROM shift_schedules WHERE periode = ?', [periode])
  if (!row) fail(404, 'Jadwal bulan ini tidak ditemukan.')
  await softDelete({ table: 'shift_schedules', id: row.id, modul: 'Jadwal Shift', label: `Jadwal shift ${periode}`, user })
  const { applyShiftSchedule } = await import('@/lib/attendance')
  await applyShiftSchedule([periode!])
  return NextResponse.json({ ok: true })
})
