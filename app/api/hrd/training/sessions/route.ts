import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { logActivity } from '@/lib/activity'
import { db } from '@/lib/db'
import { canManageTraining, requireTraining } from '@/lib/training'
import { loadSchedule } from '@/lib/training-schedule'
import { listSessions, readSession, saveParticipants } from '@/lib/training-sessions'

// Sesi training (SIMPAP): semua yang punya menu Training melihat; HRD menambah / mengubah / menghapus
export const GET = handle(async () => {
  const user = await requireUser()
  requireTraining(user)
  const manage = canManageTraining(user)
  const [employees] = manage
    ? await db.query<RowDataPacket[]>("SELECT id, nama, nip, jabatan, divisi FROM employees WHERE tgl_berhenti IS NULL AND COALESCE(status_karyawan, '') NOT LIKE '%resign%' ORDER BY nama")
    : [[] as RowDataPacket[]]
  return NextResponse.json({ items: await listSessions(), employees, can: { manage } })
})

// Tambah sesi, atau { impor: true } untuk menyalin sesi dari spreadsheet jadwal (tab BATCH) yang belum ada
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireTraining(user)
  if (!canManageTraining(user)) fail(403, 'Jadwal training dikelola HRD.')
  const body = await readJson(request)
  if (body.impor) {
    const schedule = await loadSchedule()
    if (!schedule?.batches.length) fail(400, 'Belum ada jadwal dari spreadsheet. Sinkron spreadsheet jadwal dulu.')
    const judul = (schedule!.judul ?? 'Training').replace(/^jadwal\s+(rencana\s+)?/i, '').trim() || 'Training'
    const [existing] = await db.query<RowDataPacket[]>("SELECT batch, DATE_FORMAT(tanggal, '%Y-%m-%d') AS tanggal, jam_mulai FROM training_sessions")
    const have = new Set(existing.map((e) => `${e.batch}|${e.tanggal}|${e.jam_mulai ?? ''}`))
    let added = 0
    for (const b of schedule!.batches) {
      for (const s of b.sesi) {
        const [mulai, selesai] = (s.jam ?? '').split('-').map((x) => x.trim().replace('.', ':').padStart(5, '0'))
        const jamMulai = /^\d{2}:\d{2}$/.test(mulai ?? '') ? mulai : null
        if (have.has(`${b.nama}|${s.tanggal}|${jamMulai ?? ''}`)) continue
        const [res] = await db.query<ResultSetHeader>(
          'INSERT INTO training_sessions (judul, batch, tanggal, jam_mulai, jam_selesai, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [judul.slice(0, 200), b.nama, s.tanggal, jamMulai, /^\d{2}:\d{2}$/.test(selesai ?? '') ? selesai : null, s.tanggal < new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10) ? 'selesai' : 'terjadwal', user.id],
        )
        await saveParticipants(db, res.insertId, s.peserta.map((nama) => ({ nama, employee_id: null, kehadiran: 'terdaftar' })))
        added++
      }
    }
    await logActivity(request, user, { module: 'Training', action: 'import', entity: null, description: `Impor ${added} sesi training dari spreadsheet jadwal` })
    return NextResponse.json({ added })
  }
  const v = readSession(body)
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    const [res] = await conn.query<ResultSetHeader>(
      'INSERT INTO training_sessions (judul, batch, tanggal, jam_mulai, jam_selesai, tempat, pemateri, catatan, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [v.judul, v.batch, v.tanggal, v.jam_mulai, v.jam_selesai, v.tempat, v.pemateri, v.catatan, v.status, user.id],
    )
    await saveParticipants(conn, res.insertId, v.peserta)
    await conn.commit()
    await logActivity(request, user, { module: 'Training', action: 'create', entity: null, description: `Sesi training ${v.judul} ${v.tanggal}` })
    return NextResponse.json({ id: res.insertId }, { status: 201 })
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
})
