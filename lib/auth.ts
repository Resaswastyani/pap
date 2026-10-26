import { SignJWT, decodeJwt, jwtVerify } from 'jose'
import { cookies, headers } from 'next/headers'

export const SESSION_COOKIE = 'pap_session'
const MAX_AGE = 60 * 60 * 8 // 8 jam

// Sesi per tab: tiap tab punya "slot" (id acak di sessionStorage) yang dikirim lewat header X-PAP-Slot,
// dan cookie pap_s_<slot> berisi sesinya. Jadi dua tab di browser yang sama bisa login dengan akun berbeda.
// Cookie pap_session tetap ada sebagai sesi tab yang terakhir aktif, dipakai oleh request tanpa header
// (link cetak, unduh file, gambar).
export const SLOT_HEADER = 'x-pap-slot'
const SLOT_PREFIX = 'pap_s_'
const MAX_SLOTS = 10
const validSlot = (slot: string | null | undefined): slot is string => !!slot && /^[a-z0-9]{8,24}$/.test(slot)
const slotCookie = (slot: string) => `${SLOT_PREFIX}${slot}`

// Sesi hanya menyimpan id user; role & hak akses selalu dibaca ulang dari database
export type SessionUser = { id: number }

function secret() {
  const value = process.env.AUTH_SECRET
  if (!value) throw new Error('AUTH_SECRET belum diset di environment')
  return new TextEncoder().encode(value)
}

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge,
})

async function sign(userId: number, exp?: number) {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(exp ?? `${MAX_AGE}s`)
    .sign(secret())
}

async function verify(token: string | undefined) {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret())
    return payload.sub && payload.exp ? { id: Number(payload.sub), exp: payload.exp, iat: payload.iat ?? 0 } : null
  } catch {
    return null
  }
}

const remaining = (exp: number) => Math.max(1, exp - Math.floor(Date.now() / 1000))

async function requestSlot() {
  const slot = (await headers()).get(SLOT_HEADER)
  return validSlot(slot) ? slot : null
}

// Simpan sesi ke slot tab; slot yang lewat batas (tab lama/ditutup) dibuang mulai dari yang paling lama
async function setSlot(slot: string, token: string, exp: number) {
  const store = await cookies()
  const others = store.getAll().filter((c) => c.name.startsWith(SLOT_PREFIX) && c.name !== slotCookie(slot))
  const aged = others.map((c) => {
    try { return { name: c.name, iat: decodeJwt(c.value).iat ?? 0, exp: decodeJwt(c.value).exp ?? 0 } } catch { return { name: c.name, iat: 0, exp: 0 } }
  })
  const now = Math.floor(Date.now() / 1000)
  aged.filter((c) => c.exp <= now).forEach((c) => store.delete(c.name))
  aged.filter((c) => c.exp > now).sort((a, b) => b.iat - a.iat).slice(MAX_SLOTS - 1).forEach((c) => store.delete(c.name))
  store.set(slotCookie(slot), token, cookieOptions(remaining(exp)))
}

export async function createSession(user: SessionUser) {
  const token = await sign(user.id)
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE
  const store = await cookies()
  store.set(SESSION_COOKIE, token, cookieOptions(MAX_AGE))
  const slot = await requestSlot()
  if (slot) await setSlot(slot, token, exp)
}

export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies()
  const slot = await requestSlot()
  // Tab yang punya slot hanya memakai sesinya sendiri, tidak ikut sesi tab lain
  const session = await verify(slot ? store.get(slotCookie(slot))?.value : store.get(SESSION_COOKIE)?.value)
  return session ? { id: session.id } : null
}

// Dipanggil saat tab dibuka/aktif. Tab baru mengambil sesi browser saat ini sebagai sesinya sendiri;
// tab yang sudah punya sesi menjadikannya sesi aktif (untuk link cetak/unduh dari tab itu).
export async function syncSlot() {
  const slot = await requestSlot()
  if (!slot) return
  const store = await cookies()
  const own = await verify(store.get(slotCookie(slot))?.value)
  if (own) {
    const current = await verify(store.get(SESSION_COOKIE)?.value)
    if (!current || current.id !== own.id) store.set(SESSION_COOKIE, store.get(slotCookie(slot))!.value, cookieOptions(remaining(own.exp)))
    return
  }
  const shared = await verify(store.get(SESSION_COOKIE)?.value)
  if (shared) await setSlot(slot, await sign(shared.id, shared.exp), shared.exp)
}

export async function destroySession() {
  const store = await cookies()
  const slot = await requestSlot()
  if (slot) {
    const own = await verify(store.get(slotCookie(slot))?.value)
    const shared = await verify(store.get(SESSION_COOKIE)?.value)
    store.delete(slotCookie(slot))
    // Sesi bersama ikut dihapus bila milik akun yang sama, agar link cetak/unduh tidak tetap login
    if (!own || !shared || shared.id === own.id) store.delete(SESSION_COOKIE)
    return
  }
  store.delete(SESSION_COOKIE)
}
