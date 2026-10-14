import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { loadMeeting, loadParticipants, meetingAbilities, parseDateTime, serializeMeeting, validParticipants } from '@/lib/meeting'
import { MEETING_STATUS, PERMISSIONS } from '@/lib/permissions'
import { loadPlanning } from '@/lib/planning'

type Ctx = { params: Promise<{ id: string }> }

const meetingId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Meeting tidak ditemukan.')

export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser(PERMISSIONS.meetingView)
  const row = await loadMeeting(user, await meetingId(ctx))
  return NextResponse.json({ item: serializeMeeting(user, row), participants: await loadParticipants(row.id) })
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
  return NextResponse.json({ item: serializeMeeting(user, updated), participants: await loadParticipants(row.id) })
})

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser(PERMISSIONS.meetingView)
  const row = await loadMeeting(user, await meetingId(ctx))
  if (!meetingAbilities(user, row).delete) fail(403, 'Anda tidak punya akses untuk menghapus meeting ini.')
  await db.query('DELETE FROM meetings WHERE id = ?', [row.id])
  return NextResponse.json({ ok: true })
})
