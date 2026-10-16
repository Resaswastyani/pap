import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/users'
import { connectDriveAccount } from '@/lib/drive'
import { canManageMaster } from '@/lib/master'

const STATE_COOKIE = 'pap_drive_oauth'

// Google mengarahkan kembali ke sini setelah admin menekan "Izinkan".
// Hasil (berhasil / gagal) dikirim ke halaman Master Data lewat ?drive=...
export async function GET(request: Request) {
  const url = new URL(request.url)
  const back = (result: string) => NextResponse.redirect(`${url.origin}/?drive=${encodeURIComponent(result)}`)
  const store = await cookies()
  const expected = store.get(STATE_COOKIE)?.value
  store.delete({ name: STATE_COOKIE, path: '/api/master/drive/oauth' })

  const user = await getCurrentUser()
  if (!user || !canManageMaster(user)) return back('error:Hanya Admin / Super Admin yang dapat menghubungkan Google Drive.')
  if (url.searchParams.get('error')) return back(`error:${url.searchParams.get('error') === 'access_denied' ? 'Izin Google dibatalkan.' : `Google: ${url.searchParams.get('error')}`}`)
  const state = url.searchParams.get('state')
  const code = url.searchParams.get('code')
  if (!expected || !state || state !== expected || !code) return back('error:Sesi menghubungkan Google kedaluwarsa. Ulangi klik "Hubungkan akun Google".')
  try {
    const email = await connectDriveAccount(code, `${url.origin}/api/master/drive/oauth/callback`, user.id)
    return back(`ok:${email}`)
  } catch (error) {
    console.error('[drive/oauth]', error)
    return back(`error:${(error as Error).message}`)
  }
}
