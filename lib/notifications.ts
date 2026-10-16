import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { db } from '@/lib/db'
import { pushToUsers } from '@/lib/push'

export const REMINDER_MINUTES = 15
// Sales butuh waktu perjalanan: reminder visit dikirim 60 menit sebelumnya
export const VISIT_REMINDER_MINUTES = 60

export type NotificationType = 'meeting_baru' | 'meeting_diubah' | 'meeting_reminder' | 'planning_pic' | 'planning_baru' | 'sistem' | 'prospek_baru' | 'visit_reminder' | 'followup_due' | 'sample_update' | 'desain_update'

type NotificationInput = {
  type: NotificationType
  title: string
  body?: string | null
  meetingId?: number | null
  planningId?: number | null
  prospectId?: number | null
  visitId?: number | null
  sampleId?: number | null
  designId?: number | null
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
      'INSERT IGNORE INTO notifications (user_id, type, title, body, meeting_id, planning_id, prospect_id, visit_id, sample_id, design_id, ref_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [userId, input.type, input.title.slice(0, 200), input.body?.slice(0, 500) ?? null, input.meetingId ?? null, input.planningId ?? null, input.prospectId ?? null, input.visitId ?? null, input.sampleId ?? null, input.designId ?? null, input.refKey.slice(0, 120)],
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
  created.push(...(await createMarketingReminders(userId)))
  await pushToUsers(created)
  return created
}

// Reminder marketing: visit terjadwal yang mulai dalam VISIT_REMINDER_MINUTES menit (ke sales),
// dan follow-up prospek yang sudah jatuh tempo (ke sales / pembuat prospek).
async function createMarketingReminders(userId?: number) {
  const created: number[] = []
  const [visits] = await db.query<(RowDataPacket & { id: number; jadwal: string; sales_id: number; target: string | null; alamat: string | null })[]>(
    `SELECT v.id, v.jadwal, vs.user_id AS sales_id, v.alamat, COALESCE(p.nama_usaha, c.name) AS target FROM visits v JOIN visit_sales vs ON vs.visit_id = v.id
     LEFT JOIN prospects p ON p.id = v.prospect_id LEFT JOIN customers c ON c.id = v.customer_id
     WHERE v.status = 'terjadwal' AND v.jadwal > NOW() AND v.jadwal <= NOW() + INTERVAL ? MINUTE ${userId ? 'AND vs.user_id = ?' : ''}`,
    userId ? [VISIT_REMINDER_MINUTES, userId] : [VISIT_REMINDER_MINUTES],
  )
  for (const visit of visits) {
    created.push(...(await notify([visit.sales_id], {
      type: 'visit_reminder',
      title: `Visit segera: ${visit.target ?? 'jadwal visit'}`,
      body: [formatWaktu(visit.jadwal), visit.alamat].filter(Boolean).join(' · '),
      visitId: visit.id,
      refKey: `visit:${visit.id}:${visit.jadwal}`,
    })))
  }
  // Hanya follow-up yang jatuh tempo dalam 24 jam terakhir, agar data lama tidak membanjiri notifikasi
  const [due] = await db.query<(RowDataPacket & { id: number; nama_usaha: string; next_followup_at: string; owner: number })[]>(
    `SELECT p.id, p.nama_usaha, p.next_followup_at, COALESCE(IF(p.status = 'handover', p.maintenance_to, NULL), p.assigned_to, p.created_by) AS owner
     FROM prospects p WHERE p.status <> 'gagal' AND p.next_followup_at <= NOW() AND p.next_followup_at > NOW() - INTERVAL 1 DAY
     ${userId ? 'HAVING owner = ?' : ''}`,
    userId ? [userId] : [],
  )
  for (const p of due) {
    created.push(...(await notify([p.owner], {
      type: 'followup_due',
      title: `Waktunya follow-up: ${p.nama_usaha}`,
      body: `Jadwal follow-up ${formatWaktu(p.next_followup_at)}`,
      prospectId: p.id,
      refKey: `followup:${p.id}:${p.next_followup_at}`,
    })))
  }
  return created
}
