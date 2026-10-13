import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'

export const SESSION_COOKIE = 'pap_session'
const MAX_AGE = 60 * 60 * 8 // 8 jam

// Sesi hanya menyimpan id user; role & hak akses selalu dibaca ulang dari database
export type SessionUser = { id: number }

function secret() {
  const value = process.env.AUTH_SECRET
  if (!value) throw new Error('AUTH_SECRET belum diset di environment')
  return new TextEncoder().encode(value)
}

export async function createSession(user: SessionUser) {
  const token = await new SignJWT({})
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
    return payload.sub ? { id: Number(payload.sub) } : null
  } catch {
    return null
  }
}

export async function destroySession() {
  ;(await cookies()).delete(SESSION_COOKIE)
}
