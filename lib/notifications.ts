import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { db } from '@/lib/db'
import { pushToUsers } from '@/lib/push'

export const REMINDER_MINUTES = 15

export type NotificationType = 'meeting_baru' | 'meeting_diubah' | 'meeting_reminder' | 'planning_pic' | 'planning_baru'

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

// Simpan notifikasi; mengembalikan user yang benar-benar mendapat notifikasi baru (untuk push).
// Dipanggil di dalam transaksi: kirim push SETELAH commit lewat pushToUsers(hasilnya).
export async function notify(userIds: number[], input: NotificationInput, conn: Queryable = db) {
  const created: number[] = []
  for (const userId of new Set(userIds)) {
    const [result] = await conn.query<ResultSetHeader>(
      'INSERT IGNORE INTO notifications (user_id, type, title, body, meeting_id, planning_id, ref_key) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, input.type, input.title.slice(0, 200), input.body?.slice(0, 500) ?? null, input.meetingId ?? null, input.planningId ?? null, input.refKey.slice(0, 120)],
    )
    if (result.affectedRows) created.push(userId)
  }
  return created
}

// "2026-10-14 09:30:00" -> "14 Okt 2026 09:30"
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
export function formatWaktu(value: string) {
  const [date, time = ''] = value.split(' ')
  const [y, m, d] = date.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y} ${time.slice(0, 5)}`.trim()
}

export const meetingBody = (meeting: { waktu: string; tempat: string | null }) => [formatWaktu(meeting.waktu), meeting.tempat].filter(Boolean).join(' · ')

// Reminder untuk peserta meeting yang masih terjadwal dan mulai dalam REMINDER_MINUTES menit.
// - userId diisi: dipanggil saat user polling notifikasi (aplikasi terbuka)
// - userId kosong: dipanggil cron tiap menit untuk semua peserta (agar push sampai walau aplikasi ditutup)
// ref_key memuat waktu meeting sehingga meeting yang dijadwal ulang mendapat reminder baru.
export async function createDueReminders(userId?: number) {
  const [rows] = await db.query<(RowDataPacket & { id: number; judul: string; waktu: string; tempat: string | null; user_id: number })[]>(
    `SELECT m.id, m.judul, m.waktu, m.tempat, mp.user_id FROM meetings m
     JOIN meeting_participants mp ON mp.meeting_id = m.id
     WHERE m.status = 'terjadwal' AND m.waktu > NOW() AND m.waktu <= NOW() + INTERVAL ? MINUTE ${userId ? 'AND mp.user_id = ?' : ''}`,
    userId ? [REMINDER_MINUTES, userId] : [REMINDER_MINUTES],
  )
  const created: number[] = []
  for (const meeting of rows) {
    created.push(...(await notify([meeting.user_id], {
      type: 'meeting_reminder',
      title: `Meeting segera dimulai: ${meeting.judul}`,
      body: meetingBody(meeting),
      meetingId: meeting.id,
      refKey: `reminder:${meeting.id}:${meeting.waktu}`,
    })))
  }
  await pushToUsers(created)
  return created
}
