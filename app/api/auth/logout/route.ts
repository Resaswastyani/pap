import { NextResponse } from 'next/server'
import { insertLog } from '@/lib/activity'
import { destroySession, getSession } from '@/lib/auth'
import { findUserById } from '@/lib/users'

export async function POST(request: Request) {
  const session = await getSession().catch(() => null)
  const user = session ? await findUserById(session.id).catch(() => null) : null
  if (user) await insertLog(request, { id: user.id, name: user.name }, { module: 'Autentikasi', action: 'logout', entity: { type: 'user', id: user.id, label: user.email }, description: 'Logout dari sistem' })
  await destroySession()
  return NextResponse.json({ ok: true })
}
