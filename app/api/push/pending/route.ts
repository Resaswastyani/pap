import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { handle, readJson, str } from '@/lib/api'
import { db } from '@/lib/db'
import { endpointHash } from '@/lib/push'

type Sub = RowDataPacket & { id: number; user_id: number; last_notification_id: number }

// Dipanggil service worker saat menerima push: { endpoint } -> notifikasi yang belum tampil di perangkat ini.
// Tidak memakai cookie (sesi login bisa sudah berakhir); endpoint push yang acak menjadi penanda perangkat.
export const POST = handle(async (request: Request) => {
  const body = await readJson(request)
  const endpoint = str(body.endpoint, 1000)
  const [[sub]] = await db.query<Sub[]>('SELECT id, user_id, last_notification_id FROM push_subscriptions WHERE endpoint_hash = ?', [endpointHash(endpoint)])
  if (!sub) return NextResponse.json({ items: [] })
  const [items] = await db.query<RowDataPacket[]>(
    `SELECT id, type, title, body, meeting_id, planning_id, prospect_id, visit_id, sample_id, design_id, customer_id, payment_id, quotation_id, repair_id, target_page, target_id FROM notifications
     WHERE user_id = ? AND id > ? AND read_at IS NULL ORDER BY id DESC LIMIT 5`,
    [sub.user_id, sub.last_notification_id],
  )
  const maxId = items.reduce((max, item) => Math.max(max, item.id), 0)
  if (maxId) await db.query('UPDATE push_subscriptions SET last_notification_id = GREATEST(last_notification_id, ?) WHERE id = ?', [maxId, sub.id])
  return NextResponse.json({ items })
})
