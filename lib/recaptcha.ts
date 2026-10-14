// Verifikasi reCAPTCHA di server.
// - Key v2 diisi: kotak "I'm not a robot" (bisa berisi puzzle) wajib dicentang di setiap login.
// - Hanya key v3 diisi: verifikasi tak terlihat berbasis skor.
// - Keduanya kosong (mis. di lokal): pengecekan dilewati.

const VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify'
const MIN_SCORE = Number(process.env.RECAPTCHA_MIN_SCORE || 0.5)

export type CaptchaResult = { ok: true } | { ok: false; error: string }

type VerifyResponse = { success: boolean; score?: number; action?: string; 'error-codes'?: string[] }

async function verify(secret: string, token: string, ip: string | null) {
  const body = new URLSearchParams({ secret, response: token })
  if (ip) body.set('remoteip', ip)
  const res = await fetch(VERIFY_URL, { method: 'POST', body, cache: 'no-store' })
  return (await res.json()) as VerifyResponse
}

const v2Enabled = () => !!(process.env.RECAPTCHA_V2_SITE_KEY && process.env.RECAPTCHA_V2_SECRET_KEY)
const v3Enabled = () => !v2Enabled() && !!(process.env.RECAPTCHA_SITE_KEY && process.env.RECAPTCHA_SECRET_KEY)

// Site key aman dikirim ke browser; secret key tetap hanya di server
export function captchaConfig() {
  return {
    siteKey: v3Enabled() ? process.env.RECAPTCHA_SITE_KEY! : '',
    v2SiteKey: v2Enabled() ? process.env.RECAPTCHA_V2_SITE_KEY! : '',
  }
}

export async function checkCaptcha(input: { token?: unknown; v2Token?: unknown }, ip: string | null): Promise<CaptchaResult> {
  if (v2Enabled()) {
    if (typeof input.v2Token !== 'string' || !input.v2Token) return { ok: false, error: 'Centang "I\'m not a robot" terlebih dahulu.' }
    const result = await verify(process.env.RECAPTCHA_V2_SECRET_KEY!, input.v2Token, ip)
    if (result.success) return { ok: true }
    console.warn('[recaptcha v2] gagal', result['error-codes'])
    return { ok: false, error: 'Verifikasi captcha gagal atau kedaluwarsa. Centang ulang lalu coba lagi.' }
  }

  if (!v3Enabled()) return { ok: true }
  if (typeof input.token !== 'string' || !input.token) return { ok: false, error: 'Verifikasi captcha belum dimuat. Muat ulang halaman.' }
  const result = await verify(process.env.RECAPTCHA_SECRET_KEY!, input.token, ip)
  if (!result.success) {
    console.warn('[recaptcha v3] gagal', result['error-codes'])
    return { ok: false, error: 'Verifikasi captcha gagal. Muat ulang halaman lalu coba lagi.' }
  }
  if (result.action === 'login' && (result.score ?? 0) >= MIN_SCORE) return { ok: true }
  return { ok: false, error: 'Aktivitas login terdeteksi mencurigakan. Coba lagi beberapa saat lagi.' }
}
