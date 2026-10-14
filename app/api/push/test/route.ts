import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { handle, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { notify } from '@/lib/notifications'
import { pushEnabled, pushToUsers } from '@/lib/push'

// Tombol "Kirim notifikasi uji": kirim notifikasi ke semua perangkat milik user yang login
export const POST = handle(async () => {
  const user = await requireUser()
  const [[count]] = await db.query<(RowDataPacket & { n: number })[]>('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?', [user.id])
  const created = await notify([user.id], {
    type: 'sistem',
    title: 'Tes notifikasi PAP-MS',
    body: 'Jika pesan ini muncul di layar HP/laptop, notifikasi sudah berfungsi.',
    refKey: `test:${Date.now()}`,
  })
  await pushToUsers(created)
  return NextResponse.json({ ok: true, enabled: pushEnabled(), devices: Number(count.n) })
})
