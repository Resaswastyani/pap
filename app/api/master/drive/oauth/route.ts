import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { fail, handle, requireUser, publicOrigin } from '@/lib/api'
import { disconnectDriveAccount, driveAuthUrl, oauthConfigured } from '@/lib/drive'
import { canManageMaster } from '@/lib/master'

const STATE_COOKIE = 'pap_drive_oauth'
const callbackUrl = (request: Request) => `${publicOrigin(request)}/api/master/drive/oauth/callback`

// Admin: mulai "Hubungkan akun Google" -> diarahkan ke halaman izin Google
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  if (!canManageMaster(user)) fail(403, 'Hanya Admin / Super Admin yang dapat menghubungkan Google Drive.')
  if (!oauthConfigured()) fail(400, 'GOOGLE_OAUTH_CLIENT_ID dan GOOGLE_OAUTH_CLIENT_SECRET belum diisi di environment server.')
  const state = randomBytes(24).toString('base64url')
  ;(await cookies()).set(STATE_COOKIE, state, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/api/master/drive/oauth', maxAge: 600 })
  return NextResponse.redirect(driveAuthUrl(callbackUrl(request), state))
})

// Admin: putuskan akun Google (izin di Google ikut dicabut)
export const DELETE = handle(async () => {
  const user = await requireUser()
  if (!canManageMaster(user)) fail(403, 'Hanya Admin / Super Admin yang dapat memutuskan Google Drive.')
  await disconnectDriveAccount()
  return NextResponse.json({ ok: true })
})
