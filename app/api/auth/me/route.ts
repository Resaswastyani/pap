import { NextResponse } from 'next/server'
import { captchaConfig } from '@/lib/recaptcha'
import { getCurrentUser } from '@/lib/users'

export async function GET() {
  try {
    // Koneksi pool yang sudah diputus server langsung gagal sekali; coba ulang dengan koneksi baru
    const user = await getCurrentUser().catch(() => getCurrentUser())
    // Belum login = jawaban normal (200, user null) agar tidak tercatat sebagai error merah di console browser.
    // Config captcha ikut dikirim agar halaman login tidak perlu request tambahan
    if (!user) return NextResponse.json({ user: null, captcha: captchaConfig() })
    return NextResponse.json({ user })
  } catch (error) {
    console.error('[auth/me]', error)
    return NextResponse.json({ user: null, error: 'Tidak dapat terhubung ke database.' }, { status: 500 })
  }
}
