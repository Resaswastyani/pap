import type { RowDataPacket } from 'mysql2'
import { fail } from '@/lib/api'
import { db } from '@/lib/db'
import { PERMISSIONS, type MeetingStatus } from '@/lib/permissions'
import { can, type UserProfile } from '@/lib/users'

export type MeetingRow = RowDataPacket & {
  id: number
  nomor: string
  planning_id: number | null
  planning_nomor: string | null
  planning_judul: string | null
  division_id: number
  division_name: string
  judul: string
  waktu: string
  deskripsi: string | null
  tempat: string | null
  status: MeetingStatus
  hasil_meeting: string | null
  created_by: number
  created_by_name: string
  created_at: string
  updated_at: string
  participant_count: number
  is_participant: number
}

// ? pertama = id user yang sedang login (penanda is_participant)
export const MEETING_SELECT = `SELECT m.id, m.nomor, m.planning_id, p.nomor AS planning_nomor, p.judul AS planning_judul,
  m.division_id, d.name AS division_name, m.judul, m.waktu, m.deskripsi, m.tempat, m.status, m.hasil_meeting,
  m.created_by, cr.name AS created_by_name, m.created_at, m.updated_at,
  (SELECT COUNT(*) FROM meeting_participants mp WHERE mp.meeting_id = m.id) AS participant_count,
  EXISTS (SELECT 1 FROM meeting_participants mp WHERE mp.meeting_id = m.id AND mp.user_id = ?) AS is_participant
  FROM meetings m
  JOIN divisions d ON d.id = m.division_id
  JOIN users cr ON cr.id = m.created_by
  LEFT JOIN plannings p ON p.id = m.planning_id`

export const canViewAllMeetings = (user: UserProfile) => can(user, PERMISSIONS.meetingViewAll)

// Meeting terlihat bila: lihat-semua, satu divisi dengan pembuat, pembuatnya, atau peserta
export function visibilityClause(user: UserProfile): [string, unknown[]] {
  if (canViewAllMeetings(user)) return ['1 = 1', []]
  return [
    '(m.division_id = ? OR m.created_by = ? OR EXISTS (SELECT 1 FROM meeting_participants v WHERE v.meeting_id = m.id AND v.user_id = ?))',
    [user.division.id, user.id, user.id],
  ]
}

export function meetingAbilities(user: UserProfile, row: Pick<MeetingRow, 'division_id' | 'created_by' | 'is_participant'>) {
  const scoped = canViewAllMeetings(user) || row.division_id === user.division.id
  const edit = (scoped && can(user, PERMISSIONS.meetingManage)) || row.created_by === user.id
  return {
    edit,
    delete: edit,
    // Peserta boleh mengisi hasil meeting & status
    result: edit || !!Number(row.is_participant),
  }
}

export function serializeMeeting(user: UserProfile, row: MeetingRow) {
  return { ...row, participant_count: Number(row.participant_count), is_participant: !!Number(row.is_participant), can: meetingAbilities(user, row) }
}

export async function loadMeeting(user: UserProfile, id: number) {
  const [clause, args] = visibilityClause(user)
  const [rows] = await db.query<MeetingRow[]>(`${MEETING_SELECT} WHERE m.id = ? AND ${clause} LIMIT 1`, [user.id, id, ...args])
  return (rows[0] as MeetingRow) ?? fail(404, 'Meeting tidak ditemukan.')
}

export async function loadParticipants(meetingId: number) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT u.id, u.name, d.name AS division_name FROM meeting_participants mp
     JOIN users u ON u.id = mp.user_id JOIN divisions d ON d.id = u.division_id
     WHERE mp.meeting_id = ? ORDER BY d.sort_order, u.name`,
    [meetingId],
  )
  return rows
}

// "2026-10-14T09:30" (input datetime-local) -> "2026-10-14 09:30:00"
export function parseDateTime(value: unknown) {
  const match = typeof value === 'string' ? value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?$/) : null
  if (!match || Number.isNaN(Date.parse(`${match[1]}T${match[2]}`))) return fail(400, 'Waktu meeting tidak valid.')
  return `${match[1]} ${match[2]}:00`
}

// Peserta harus user aktif; pembuat selalu ikut sebagai peserta
export async function validParticipants(value: unknown, creatorId: number) {
  const ids = new Set<number>([creatorId])
  if (Array.isArray(value)) for (const id of value) if (Number.isInteger(Number(id))) ids.add(Number(id))
  const [rows] = await db.query<RowDataPacket[]>('SELECT id FROM users WHERE is_active = 1 AND id IN (?)', [[...ids]])
  if (rows.length !== ids.size) fail(400, 'Ada peserta yang tidak valid atau tidak aktif.')
  return [...ids]
}
