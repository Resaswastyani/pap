import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { handle, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { createDueReminders } from '@/lib/notifications'

// Dipolling halaman setiap ±30 detik: membuat reminder yang jatuh tempo, lalu
// mengembalikan 30 notifikasi terbaru + jumlah yang belum dibaca
export const GET = handle(async () => {
  const user = await requireUser()
  await createDueReminders(user.id)
  const [items] = await db.query<RowDataPacket[]>(
    `SELECT id, type, title, body, meeting_id, planning_id, prospect_id, visit_id, sample_id, design_id, customer_id, payment_id, read_at, created_at
     FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30`,
    [user.id],
  )
  const [[count]] = await db.query<(RowDataPacket & { unread: number })[]>('SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL', [user.id])
  return NextResponse.json({ items, unread: Number(count.unread) })
})
