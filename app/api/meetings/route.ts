import type { ResultSetHeader } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canViewAllMeetings, MEETING_SELECT, parseDateTime, serializeMeeting, validParticipants, visibilityClause, type MeetingRow } from '@/lib/meeting'
import { MEETING_STATUS, PERMISSIONS } from '@/lib/permissions'
import { loadPlanning } from '@/lib/planning'

// Daftar meeting yang boleh dilihat user + ringkasan
export const GET = handle(async (request: Request) => {
  const user = await requireUser(PERMISSIONS.meetingView)
  const params = new URL(request.url).searchParams
  const [clause, clauseArgs] = visibilityClause(user)
  const where = [clause]
  const args: unknown[] = [...clauseArgs]

  const division = int(params.get('division'))
  if (division && canViewAllMeetings(user)) where.push('m.division_id = ?'), args.push(division)
  const planning = int(params.get('planning'))
  if (planning) where.push('m.planning_id = ?'), args.push(planning)
  const status = params.get('status')
  if (status && status in MEETING_STATUS) where.push('m.status = ?'), args.push(status)
  if (params.get('mine') === '1') where.push('(m.created_by = ? OR EXISTS (SELECT 1 FROM meeting_participants x WHERE x.meeting_id = m.id AND x.user_id = ?))'), args.push(user.id, user.id)
  const q = str(params.get('q'), 100)
  if (q) where.push('(m.judul LIKE ? OR m.deskripsi LIKE ? OR m.nomor LIKE ? OR m.tempat LIKE ? OR p.judul LIKE ?)'), args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`)

  const [rows] = await db.query<MeetingRow[]>(
    `${MEETING_SELECT} WHERE ${where.join(' AND ')}
     ORDER BY (m.status IN ('selesai','dibatalkan')), CASE WHEN m.status IN ('selesai','dibatalkan') THEN NULL ELSE m.waktu END ASC, m.waktu DESC LIMIT 500`,
    [user.id, ...args],
  )
  const items = rows.map((row) => serializeMeeting(user, row))
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
  const summary = {
    total: items.length,
    hari_ini: items.filter((item) => item.waktu.startsWith(today) && item.status !== 'dibatalkan').length,
    terjadwal: items.filter((item) => item.status === 'terjadwal').length,
    selesai: items.filter((item) => item.status === 'selesai').length,
  }
  return NextResponse.json({ items, summary })
})

// Buat meeting (lead/admin/super admin). planning_id opsional (kosong = meeting dadakan)
export const POST = handle(async (request: Request) => {
  const user = await requireUser(PERMISSIONS.meetingCreate)
  const body = await readJson(request)
  const judul = str(body.judul, 200)
  if (!judul) fail(400, 'Judul meeting wajib diisi.')
  const waktu = parseDateTime(body.waktu)
  let planningId: number | null = null
  if (body.planning_id) planningId = (await loadPlanning(user, Number(body.planning_id))).id
  const participants = await validParticipants(body.participant_ids, user.id)

  const conn = await db.getConnection()
  let id = 0
  try {
    await conn.beginTransaction()
    const [result] = await conn.query<ResultSetHeader>(
      'INSERT INTO meetings (planning_id, division_id, judul, waktu, deskripsi, tempat, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [planningId, user.division.id, judul, waktu, str(body.deskripsi, 5000) || null, str(body.tempat, 500) || null, user.id],
    )
    id = result.insertId
    await conn.query("UPDATE meetings SET nomor = CONCAT('MTG-', DATE_FORMAT(created_at, '%Y%m'), '-', LPAD(id, 4, '0')) WHERE id = ?", [id])
    await conn.query('INSERT INTO meeting_participants (meeting_id, user_id) VALUES ?', [participants.map((userId) => [id, userId])])
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
  const [rows] = await db.query<MeetingRow[]>(`${MEETING_SELECT} WHERE m.id = ?`, [user.id, id])
  return NextResponse.json({ item: serializeMeeting(user, rows[0]) }, { status: 201 })
})
