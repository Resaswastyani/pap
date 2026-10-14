import type { RowDataPacket } from 'mysql2'
import { db } from '@/lib/db'

export const REMINDER_MINUTES = 15

export type NotificationType = 'meeting_baru' | 'meeting_diubah' | 'meeting_reminder' | 'planning_pic'

type NotificationInput = {
  type: NotificationType
  title: string
  body?: string | null
  meetingId?: number | null
  planningId?: number | null
  // Kunci unik per user; notifikasi dengan kunci sama tidak dibuat dua kali
  refKey: string
}

type Queryable = { query: typeof db.query }

export async function notify(userIds: number[], input: NotificationInput, conn: Queryable = db) {
  const ids = [...new Set(userIds)]
  if (!ids.length) return
  await conn.query(
    'INSERT IGNORE INTO notifications (user_id, type, title, body, meeting_id, planning_id, ref_key) VALUES ?',
    [ids.map((userId) => [userId, input.type, input.title.slice(0, 200), input.body?.slice(0, 500) ?? null, input.meetingId ?? null, input.planningId ?? null, input.refKey.slice(0, 120)])],
  )
}

// "2026-10-14 09:30:00" -> "14 Okt 2026 09:30"
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
export function formatWaktu(value: string) {
  const [date, time = ''] = value.split(' ')
  const [y, m, d] = date.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y} ${time.slice(0, 5)}`.trim()
}

export const meetingBody = (meeting: { waktu: string; tempat: string | null }) => [formatWaktu(meeting.waktu), meeting.tempat].filter(Boolean).join(' · ')

// Reminder dibuat saat user membuka/polling notifikasi (tanpa cron):
// meeting yang diikuti user, masih terjadwal, dan mulai dalam REMINDER_MINUTES menit.
// ref_key memuat waktu meeting sehingga meeting yang dijadwal ulang mendapat reminder baru.
export async function createDueReminders(userId: number) {
  const [rows] = await db.query<(RowDataPacket & { id: number; judul: string; waktu: string; tempat: string | null })[]>(
    `SELECT m.id, m.judul, m.waktu, m.tempat FROM meetings m
     JOIN meeting_participants mp ON mp.meeting_id = m.id AND mp.user_id = ?
     WHERE m.status = 'terjadwal' AND m.waktu > NOW() AND m.waktu <= NOW() + INTERVAL ? MINUTE`,
    [userId, REMINDER_MINUTES],
  )
  for (const meeting of rows) {
    await notify([userId], {
      type: 'meeting_reminder',
      title: `Meeting segera dimulai: ${meeting.judul}`,
      body: meetingBody(meeting),
      meetingId: meeting.id,
      refKey: `reminder:${meeting.id}:${meeting.waktu}`,
    })
  }
}
