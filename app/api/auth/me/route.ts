import { NextResponse } from 'next/server'
import { captchaConfig } from '@/lib/recaptcha'
import { getCurrentUser } from '@/lib/users'

export async function GET() {
  try {
    const user = await getCurrentUser()
    // Config captcha ikut dikirim agar halaman login tidak perlu request tambahan
    if (!user) return NextResponse.json({ user: null, captcha: captchaConfig() }, { status: 401 })
    return NextResponse.json({ user })
  } catch (error) {
    console.error('[auth/me]', error)
    return NextResponse.json({ user: null, error: 'Tidak dapat terhubung ke database.' }, { status: 500 })
  }
}
