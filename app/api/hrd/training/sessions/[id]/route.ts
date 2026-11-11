import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { logActivity } from '@/lib/activity'
import { db } from '@/lib/db'
import { softDelete } from '@/lib/recycle-bin'
import { canManageTraining, requireTraining } from '@/lib/training'
import { readSession, saveParticipants } from '@/lib/training-sessions'

type Ctx = { params: Promise<{ id: string }> }
async function load(ctx: Ctx) {
  const user = await requireUser()
  requireTraining(user)
  if (!canManageTraining(user)) fail(403, 'Jadwal training dikelola HRD.')
  const id = int((await ctx.params).id) ?? fail(404, 'Sesi training tidak ditemukan.')
  const [[row]] = await db.query<RowDataPacket[]>('SELECT id, judul FROM training_sessions WHERE id = ?', [id])
  if (!row) fail(404, 'Sesi training tidak ditemukan.')
  return { user, id: id!, judul: String(row!.judul) }
}

export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const { user, id } = await load(ctx)
  const v = readSession(await readJson(request))
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('UPDATE training_sessions SET judul = ?, batch = ?, tanggal = ?, jam_mulai = ?, jam_selesai = ?, tempat = ?, pemateri = ?, catatan = ?, status = ? WHERE id = ?',
      [v.judul, v.batch, v.tanggal, v.jam_mulai, v.jam_selesai, v.tempat, v.pemateri, v.catatan, v.status, id])
    await saveParticipants(conn, id, v.peserta)
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
  await logActivity(request, user, { module: 'Training', action: 'update', entity: null, description: `Ubah sesi training ${v.judul} ${v.tanggal}` })
  return NextResponse.json({ ok: true })
})

// Hapus sesi (peserta ikut; masuk Data Terhapus)
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const { user, id, judul } = await load(ctx)
  await softDelete({ table: 'training_sessions', id, modul: 'Training', label: `Sesi training ${judul}`, user })
  return NextResponse.json({ ok: true })
})
