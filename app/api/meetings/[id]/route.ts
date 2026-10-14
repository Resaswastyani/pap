import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { loadMeeting, loadParticipants, meetingAbilities, parseDateTime, serializeMeeting, validParticipants, type MeetingRow } from '@/lib/meeting'
import { meetingBody, notify } from '@/lib/notifications'
import { MEETING_STATUS, PERMISSIONS } from '@/lib/permissions'
import type { UserProfile } from '@/lib/users'
import { loadPlanning } from '@/lib/planning'

type Ctx = { params: Promise<{ id: string }> }

// Peserta baru mendapat notifikasi "meeting baru"; peserta lama diberi tahu bila jadwal/tempat berubah
async function notifyMeetingChanges(user: UserProfile, before: MeetingRow, after: MeetingRow, oldIds: number[], newIds: number[]) {
  const added = oldIds.length ? newIds.filter((id) => !oldIds.includes(id)) : []
  await notify(added.filter((id) => id !== user.id), {
    type: 'meeting_baru',
    title: `Meeting baru: ${after.judul}`,
    body: `${meetingBody(after)} · dari ${user.name}`,
    meetingId: after.id,
    refKey: `meeting_baru:${after.id}`,
  })
  const rescheduled = before.waktu !== after.waktu || before.tempat !== after.tempat
  const cancelled = before.status !== 'dibatalkan' && after.status === 'dibatalkan'
  if (!rescheduled && !cancelled) return
  await notify(newIds.filter((id) => id !== user.id && !added.includes(id)), {
    type: 'meeting_diubah',
    title: cancelled ? `Meeting dibatalkan: ${after.judul}` : `Jadwal meeting diubah: ${after.judul}`,
    body: `${meetingBody(after)} · oleh ${user.name}`,
    meetingId: after.id,
    refKey: `meeting_diubah:${after.id}:${Date.now()}`,
  })
}

const meetingId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Meeting tidak ditemukan.')

export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser(PERMISSIONS.meetingView)
  const row = await loadMeeting(user, await meetingId(ctx))
  // Planning yang dibuat dari meeting ini (ringkasan; detail tetap mengikuti hak akses planning)
  const [plannings] = await db.query<RowDataPacket[]>(
    `SELECT p.id, p.nomor, p.judul, p.status, p.progress, d.name AS division_name FROM plannings p
     JOIN divisions d ON d.id = p.division_id WHERE p.meeting_id = ? ORDER BY p.id`,
    [row.id],
  )
  return NextResponse.json({ item: serializeMeeting(user, row), participants: await loadParticipants(row.id), plannings })
})

// Edit meeting:
// - edit (pembuat, atau lead/admin dengan meeting.manage): semua field & peserta
// - result (peserta): status & hasil meeting saja
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser(PERMISSIONS.meetingView)
  const row = await loadMeeting(user, await meetingId(ctx))
  const ability = meetingAbilities(user, row)
  const body = await readJson(request)
  const detailKeys = ['judul', 'planning_id', 'waktu', 'deskripsi', 'tempat', 'participant_ids']
  if (detailKeys.some((key) => key in body) && !ability.edit) fail(403, 'Anda hanya dapat mengisi status dan hasil meeting.')
  if (!ability.result) fail(403, 'Anda tidak punya akses untuk mengubah meeting ini.')

  const sets: string[] = []
  const args: unknown[] = []
  if ('judul' in body) {
    const judul = str(body.judul, 200)
    if (!judul) fail(400, 'Judul meeting wajib diisi.')
    sets.push('judul = ?'), args.push(judul)
  }
  if ('deskripsi' in body) sets.push('deskripsi = ?'), args.push(str(body.deskripsi, 5000) || null)
  if ('waktu' in body) sets.push('waktu = ?'), args.push(parseDateTime(body.waktu))
  if ('tempat' in body) sets.push('tempat = ?'), args.push(str(body.tempat, 500) || null)
  if ('planning_id' in body) {
    const planningId = body.planning_id ? (body.planning_id === row.planning_id ? row.planning_id : (await loadPlanning(user, Number(body.planning_id))).id) : null
    sets.push('planning_id = ?'), args.push(planningId)
  }
  if ('status' in body) {
    if (typeof body.status !== 'string' || !(body.status in MEETING_STATUS)) fail(400, 'Status tidak valid.')
    sets.push('status = ?'), args.push(body.status)
  }
  if ('hasil_meeting' in body) sets.push('hasil_meeting = ?'), args.push(str(body.hasil_meeting, 10000) || null)

  const participants = 'participant_ids' in body ? await validParticipants(body.participant_ids, row.created_by) : null
  if (!sets.length && !participants) fail(400, 'Tidak ada perubahan.')
  const before = participants ? (await loadParticipants(row.id)).map((p) => Number(p.id)) : []

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    if (sets.length) await conn.query(`UPDATE meetings SET ${sets.join(', ')} WHERE id = ?`, [...args, row.id])
    if (participants) {
      await conn.query('DELETE FROM meeting_participants WHERE meeting_id = ?', [row.id])
      await conn.query('INSERT INTO meeting_participants (meeting_id, user_id) VALUES ?', [participants.map((userId) => [row.id, userId])])
    }
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
  const updated = await loadMeeting(user, row.id)
  const current = await loadParticipants(row.id)
  await notifyMeetingChanges(user, row, updated, before, current.map((p) => Number(p.id)))
  return NextResponse.json({ item: serializeMeeting(user, updated), participants: current })
})

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser(PERMISSIONS.meetingView)
  const row = await loadMeeting(user, await meetingId(ctx))
  if (!meetingAbilities(user, row).delete) fail(403, 'Anda tidak punya akses untuk menghapus meeting ini.')
  await db.query('DELETE FROM meetings WHERE id = ?', [row.id])
  return NextResponse.json({ ok: true })
})
