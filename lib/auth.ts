import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'

export const SESSION_COOKIE = 'pap_session'
const MAX_AGE = 60 * 60 * 8 // 8 jam

export type SessionUser = { id: number; name: string; email: string; role: string }

function secret() {
  const value = process.env.AUTH_SECRET
  if (!value) throw new Error('AUTH_SECRET belum diset di environment')
  return new TextEncoder().encode(value)
}

export async function createSession(user: SessionUser) {
  const token = await new SignJWT({ ...user })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret())
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE,
  })
}

export async function getSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret())
    return { id: Number(payload.sub), name: String(payload.name), email: String(payload.email), role: String(payload.role) }
  } catch {
    return null
  }
}

export async function destroySession() {
  ;(await cookies()).delete(SESSION_COOKIE)
}
