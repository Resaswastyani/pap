import { NextResponse } from 'next/server'
import { captchaConfig } from '@/lib/recaptcha'

// Site key reCAPTCHA (memang publik) untuk dipakai halaman login
export function GET() {
  return NextResponse.json(captchaConfig())
}
