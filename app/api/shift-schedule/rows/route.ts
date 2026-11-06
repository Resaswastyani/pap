import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { afterShiftChange, canSyncShift, isShiftPeriode, readShiftRowInput, requireShift } from '@/lib/shift-schedule'

const daysIn = (p: string) => new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)), 0)).getUTCDate()

// Tambah karyawan ke jadwal bulan: { periode, nama, bagian, nomor_induk, pilihan_shift, jadwal[] }
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireShift(user)
  if (!canSyncShift(user)) fail(403, 'Jadwal shift dikelola PPIC, HRD, dan kepala Produksi.')
  const body = await readJson(request)
  if (!isShiftPeriode(body.periode)) fail(400, 'Bulan tidak valid.')
  const periode = body.periode as string
  const [[s]] = await db.query<(RowDataPacket & { id: number })[]>('SELECT id FROM shift_schedules WHERE periode = ?', [periode])
  if (!s) fail(404, 'Buat jadwal bulan ini dulu.')
  const v = readShiftRowInput(body, daysIn(periode))
  const [[u]] = await db.query<(RowDataPacket & { n: number })[]>('SELECT COALESCE(MAX(urut), 0) + 1 AS n FROM shift_schedule_rows WHERE schedule_id = ?', [s.id])
  const [res] = await db.query<ResultSetHeader>(
    'INSERT INTO shift_schedule_rows (schedule_id, urut, nama, bagian, nomor_induk, pilihan_shift, jadwal) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [s.id, u.n, v.nama, v.bagian, v.nomor_induk, v.pilihan_shift, JSON.stringify(v.jadwal)],
  )
  return NextResponse.json({ id: res.insertId, warning: await afterShiftChange(periode) }, { status: 201 })
})
