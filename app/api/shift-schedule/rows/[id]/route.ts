import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { softDelete } from '@/lib/recycle-bin'
import { afterShiftChange, canSyncShift, readShiftRowInput, requireShift } from '@/lib/shift-schedule'

type Ctx = { params: Promise<{ id: string }> }
const daysIn = (p: string) => new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)), 0)).getUTCDate()

async function load(ctx: Ctx) {
  const user = await requireUser()
  requireShift(user)
  if (!canSyncShift(user)) fail(403, 'Jadwal shift dikelola PPIC, HRD, dan kepala Produksi.')
  const id = int((await ctx.params).id) ?? fail(404, 'Baris jadwal tidak ditemukan.')
  const [[row]] = await db.query<(RowDataPacket & { id: number; nama: string; periode: string })[]>(
    'SELECT r.id, r.nama, s.periode FROM shift_schedule_rows r JOIN shift_schedules s ON s.id = r.schedule_id WHERE r.id = ?', [id],
  )
  if (!row) fail(404, 'Baris jadwal tidak ditemukan. Muat ulang halaman.')
  return { user, row: row! }
}

// Ubah data karyawan & shift per tanggal
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const { row } = await load(ctx)
  const v = readShiftRowInput(await readJson(request), daysIn(row.periode))
  await db.query('UPDATE shift_schedule_rows SET nama = ?, bagian = ?, nomor_induk = ?, pilihan_shift = ?, jadwal = ? WHERE id = ?', [v.nama, v.bagian, v.nomor_induk, v.pilihan_shift, JSON.stringify(v.jadwal), row.id])
  return NextResponse.json({ ok: true, warning: await afterShiftChange(row.periode) })
})

// Hapus karyawan dari jadwal bulan itu (masuk Data Terhapus)
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const { user, row } = await load(ctx)
  await softDelete({ table: 'shift_schedule_rows', id: row.id, modul: 'Jadwal Shift', label: `${row.nama} (jadwal ${row.periode})`, user })
  return NextResponse.json({ ok: true, warning: await afterShiftChange(row.periode) })
})
