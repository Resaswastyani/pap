import { NextResponse } from 'next/server'
import { handle, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'

// Tandai dibaca: { ids: [1, 2] } atau { all: true }
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  const body = await readJson(request)
  if (body.all === true) {
    await db.query('UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL', [user.id])
  } else {
    const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Number.isInteger).slice(0, 100)
    if (ids.length) await db.query('UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL AND id IN (?)', [user.id, ids])
  }
  return NextResponse.json({ ok: true })
})
