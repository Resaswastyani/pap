// Verifikasi reCAPTCHA di server.
// v3 (tak terlihat) memberi skor; bila skor rendah, user diminta menyelesaikan puzzle v2.
// Bila RECAPTCHA_SECRET_KEY kosong (mis. di lokal), pengecekan dilewati.

const VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify'
const MIN_SCORE = Number(process.env.RECAPTCHA_MIN_SCORE || 0.5)

export type CaptchaResult = { ok: true } | { ok: false; challenge: boolean; error: string }

type VerifyResponse = { success: boolean; score?: number; action?: string; 'error-codes'?: string[] }

async function verify(secret: string, token: string, ip: string | null) {
  const body = new URLSearchParams({ secret, response: token })
  if (ip) body.set('remoteip', ip)
  const res = await fetch(VERIFY_URL, { method: 'POST', body, cache: 'no-store' })
  return (await res.json()) as VerifyResponse
}

export const captchaEnabled = () => !!process.env.RECAPTCHA_SECRET_KEY
const challengeEnabled = () => !!process.env.RECAPTCHA_V2_SECRET_KEY

export async function checkCaptcha(input: { token?: unknown; v2Token?: unknown }, ip: string | null): Promise<CaptchaResult> {
  const secret = process.env.RECAPTCHA_SECRET_KEY
  if (!secret) return { ok: true }

  // Puzzle v2 yang sudah diselesaikan cukup dicek success-nya
  const v2Secret = process.env.RECAPTCHA_V2_SECRET_KEY
  if (v2Secret && typeof input.v2Token === 'string' && input.v2Token) {
    const result = await verify(v2Secret, input.v2Token, ip)
    return result.success ? { ok: true } : { ok: false, challenge: true, error: 'Verifikasi captcha gagal. Coba lagi.' }
  }

  if (typeof input.token !== 'string' || !input.token) return { ok: false, challenge: false, error: 'Verifikasi captcha belum dimuat. Muat ulang halaman.' }
  const result = await verify(secret, input.token, ip)
  if (!result.success) {
    console.warn('[recaptcha] gagal', result['error-codes'])
    return { ok: false, challenge: challengeEnabled(), error: 'Verifikasi captcha gagal. Muat ulang halaman lalu coba lagi.' }
  }
  // Key v2 tidak mengembalikan skor; key v3 harus lolos skor & action
  if (result.score === undefined) return { ok: true }
  if (result.action === 'login' && result.score >= MIN_SCORE) return { ok: true }
  return challengeEnabled()
    ? { ok: false, challenge: true, error: 'Selesaikan verifikasi di bawah untuk melanjutkan.' }
    : { ok: false, challenge: false, error: 'Aktivitas login terdeteksi mencurigakan. Coba lagi beberapa saat lagi.' }
}
