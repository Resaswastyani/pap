import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { ACTIVITY_ACTIONS } from '@/lib/activity-types'
import { handle, int, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { PERMISSIONS } from '@/lib/permissions'

const PAGE = 50

// Log aktivitas seluruh sistem, terbaru dulu. ?module=&action=&user=&q=&before=<id>
export const GET = handle(async (request: Request) => {
  await requireUser(PERMISSIONS.usersManage)
  const params = new URL(request.url).searchParams
  const where: string[] = []
  const args: unknown[] = []

  const moduleName = params.get('module')
  if (moduleName) where.push('l.module = ?'), args.push(moduleName.slice(0, 40))
  const action = params.get('action')
  if (action && action in ACTIVITY_ACTIONS) where.push('l.action = ?'), args.push(action)
  // Aktivitas yang dilakukan user ini, atau yang dilakukan terhadap akunnya
  const userId = int(params.get('user'))
  if (userId) where.push("(l.actor_id = ? OR (l.entity_type = 'user' AND l.entity_id = ?))"), args.push(userId, String(userId))
  const q = params.get('q')?.trim().slice(0, 100)
  if (q) {
    where.push('(l.actor_name LIKE ? OR l.entity_label LIKE ? OR l.description LIKE ? OR l.device LIKE ? OR l.device_brand LIKE ? OR l.device_model LIKE ? OR l.ip_address LIKE ?)')
    args.push(...Array(7).fill(`%${q}%`))
  }
  const before = int(params.get('before'))
  if (before) where.push('l.id < ?'), args.push(before)

  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT l.id, l.actor_id, l.actor_name, l.module, l.action, l.entity_type, l.entity_id, l.entity_label, l.description,
       l.changes, l.device, l.device_type, l.device_brand, l.device_model, l.ip_address, l.user_agent, l.created_at
     FROM activity_logs l ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY l.id DESC LIMIT ${PAGE + 1}`,
    args,
  )
  const items = rows.slice(0, PAGE).map((row) => ({ ...row, changes: typeof row.changes === 'string' ? JSON.parse(row.changes) : row.changes }))
  return NextResponse.json({ items, hasMore: rows.length > PAGE })
})
