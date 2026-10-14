import { createHash, createPrivateKey, sign } from 'node:crypto'
import type { RowDataPacket } from 'mysql2'
import { db } from '@/lib/db'

// Web Push (VAPID) tanpa library: push dikirim TANPA isi (tidak perlu enkripsi payload).
// Service worker yang menerima push lalu mengambil notifikasi baru lewat /api/push/pending.
// Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (base64url), VAPID_SUBJECT (mailto:...)

const b64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64url = (value: string) => Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

export const pushEnabled = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY ?? ''
export const endpointHash = (endpoint: string) => createHash('sha256').update(endpoint).digest('hex')

let privateKey: ReturnType<typeof createPrivateKey> | null = null
function vapidKey() {
  if (privateKey) return privateKey
  const pub = fromB64url(process.env.VAPID_PUBLIC_KEY!) // 65 byte: 0x04 || x || y
  privateKey = createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: process.env.VAPID_PRIVATE_KEY!, x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33, 65)) },
    format: 'jwk',
  })
  return privateKey
}

const jwtCache = new Map<string, { token: string; exp: number }>()
function vapidJwt(audience: string) {
  const now = Math.floor(Date.now() / 1000)
  const cached = jwtCache.get(audience)
  if (cached && cached.exp - now > 3600) return cached.token
  const exp = now + 12 * 3600
  const header = b64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const payload = b64url(Buffer.from(JSON.stringify({ aud: audience, exp, sub: process.env.VAPID_SUBJECT || 'mailto:admin@pap-ms.id' })))
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), { key: vapidKey(), dsaEncoding: 'ieee-p1363' })
  const token = `${header}.${payload}.${b64url(signature)}`
  jwtCache.set(audience, { token, exp })
  return token
}

type SubscriptionRow = RowDataPacket & { id: number; endpoint: string }

async function sendOne(sub: SubscriptionRow) {
  const audience = new URL(sub.endpoint).origin
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      TTL: String(24 * 3600),
      Urgency: 'high',
      Authorization: `vapid t=${vapidJwt(audience)}, k=${process.env.VAPID_PUBLIC_KEY}`,
      'Content-Length': '0',
    },
    signal: AbortSignal.timeout(8000),
  })
  // Langganan kedaluwarsa / dicabut user: hapus agar tidak dikirimi lagi
  if (res.status === 404 || res.status === 410) await db.query('DELETE FROM push_subscriptions WHERE id = ?', [sub.id])
  else if (!res.ok) console.warn('[push] gagal', res.status, await res.text().catch(() => ''))
}

// Kirim "ada notifikasi baru" ke semua perangkat milik user-user ini
export async function pushToUsers(userIds: number[]) {
  const ids = [...new Set(userIds)]
  if (!pushEnabled() || !ids.length) return
  try {
    const [subs] = await db.query<SubscriptionRow[]>('SELECT id, endpoint FROM push_subscriptions WHERE user_id IN (?)', [ids])
    await Promise.allSettled(subs.map(sendOne))
  } catch (error) {
    console.error('[push]', error)
  }
}
