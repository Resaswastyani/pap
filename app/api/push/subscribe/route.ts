import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { endpointHash, pushEnabled, vapidPublicKey } from '@/lib/push'

// Kunci publik VAPID untuk pushManager.subscribe di browser
export const GET = handle(async () => {
  await requireUser()
  return NextResponse.json({ enabled: pushEnabled(), publicKey: vapidPublicKey() })
})

// Simpan langganan push perangkat ini: { endpoint, keys: { p256dh, auth } }
// Perangkat baru mulai dari notifikasi terbaru (tidak menerima tumpukan notifikasi lama)
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  const body = await readJson(request)
  const endpoint = str(body.endpoint, 1000)
  let url: URL | null = null
  try {
    url = new URL(endpoint)
  } catch {}
  if (!url || url.protocol !== 'https:') fail(400, 'Langganan notifikasi tidak valid.')
  const keys = (body.keys ?? {}) as Record<string, unknown>
  const [[latest]] = await db.query<(RowDataPacket & { id: number | null })[]>('SELECT MAX(id) AS id FROM notifications WHERE user_id = ?', [user.id])
  await db.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, endpoint_hash, p256dh, auth, user_agent, last_notification_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       -- dievaluasi kiri ke kanan: bandingkan user lama sebelum user_id diganti (perangkat dipakai akun lain)
       last_notification_id = IF(user_id = VALUES(user_id), last_notification_id, VALUES(last_notification_id)),
       user_id = VALUES(user_id), p256dh = VALUES(p256dh), auth = VALUES(auth), user_agent = VALUES(user_agent)`,
    [user.id, endpoint, endpointHash(endpoint), str(keys.p256dh), str(keys.auth), str(request.headers.get('user-agent')), latest.id ?? 0],
  )
  return NextResponse.json({ ok: true })
})

// Berhenti berlangganan (logout atau user mematikan notifikasi): { endpoint }
export const DELETE = handle(async (request: Request) => {
  const body = await readJson(request)
  const endpoint = str(body.endpoint, 1000)
  if (endpoint) await db.query('DELETE FROM push_subscriptions WHERE endpoint_hash = ?', [endpointHash(endpoint)])
  return NextResponse.json({ ok: true })
})
