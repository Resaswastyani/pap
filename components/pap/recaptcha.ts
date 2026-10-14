// reCAPTCHA di browser: v3 untuk skor (tak terlihat), v2 checkbox/puzzle bila skor rendah
export const RECAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ?? ''
export const RECAPTCHA_V2_SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_V2_SITE_KEY ?? ''

type Grecaptcha = {
  ready: (callback: () => void) => void
  execute: (siteKey: string, options: { action: string }) => Promise<string>
  render: (container: HTMLElement, options: { sitekey: string; callback: (token: string) => void; 'expired-callback': () => void; theme?: 'light' | 'dark' }) => number
  reset: (widgetId?: number) => void
}

declare global {
  interface Window { grecaptcha?: Grecaptcha }
}

let loading: Promise<Grecaptcha> | null = null

// Satu script untuk keduanya: ?render=<key v3> sekaligus menyediakan grecaptcha.render untuk v2
export function loadRecaptcha() {
  if (!RECAPTCHA_SITE_KEY) return Promise.reject(new Error('reCAPTCHA belum dikonfigurasi'))
  loading ??= new Promise<Grecaptcha>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://www.google.com/recaptcha/api.js?render=${RECAPTCHA_SITE_KEY}`
    script.async = true
    script.onload = () => window.grecaptcha!.ready(() => resolve(window.grecaptcha!))
    script.onerror = () => {
      loading = null
      reject(new Error('Gagal memuat reCAPTCHA. Periksa koneksi internet.'))
    }
    document.head.appendChild(script)
  })
  return loading
}

// Domain yang tidak terdaftar di reCAPTCHA membuat execute tidak pernah selesai, jadi diberi batas waktu
export async function getRecaptchaToken(action: string) {
  if (!RECAPTCHA_SITE_KEY) return undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Verifikasi reCAPTCHA tidak merespons. Muat ulang halaman lalu coba lagi.')), 15000)
  })
  try {
    return await Promise.race([loadRecaptcha().then((grecaptcha) => grecaptcha.execute(RECAPTCHA_SITE_KEY, { action })), timeout])
  } finally {
    clearTimeout(timer)
  }
}
