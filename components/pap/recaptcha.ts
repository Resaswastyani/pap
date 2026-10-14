// reCAPTCHA di browser: v3 untuk skor (tak terlihat), v2 checkbox/puzzle bila skor rendah.
// Site key diambil dari server (/api/auth/captcha) agar tidak perlu env NEXT_PUBLIC_.
type CaptchaConfig = { siteKey: string; v2SiteKey: string }

type Grecaptcha = {
  ready: (callback: () => void) => void
  execute: (siteKey: string, options: { action: string }) => Promise<string>
  render: (container: HTMLElement, options: { sitekey: string; callback: (token: string) => void; 'expired-callback': () => void; theme?: 'light' | 'dark' }) => number
  reset: (widgetId?: number) => void
}

declare global {
  interface Window { grecaptcha?: Grecaptcha }
}

let config: Promise<CaptchaConfig> | null = null
let loading: Promise<Grecaptcha> | null = null

export function getCaptchaConfig() {
  config ??= fetch('/api/auth/captcha', { cache: 'no-store' })
    .then((res) => (res.ok ? res.json() : { siteKey: '', v2SiteKey: '' }))
    .catch(() => {
      config = null
      return { siteKey: '', v2SiteKey: '' }
    })
  return config
}

// Satu script untuk keduanya: ?render=<key v3> sekaligus menyediakan grecaptcha.render untuk v2
export function loadRecaptcha() {
  loading ??= getCaptchaConfig().then(({ siteKey }) => new Promise<Grecaptcha>((resolve, reject) => {
    if (!siteKey) return reject(new Error('reCAPTCHA belum dikonfigurasi'))
    const script = document.createElement('script')
    script.src = `https://www.google.com/recaptcha/api.js?render=${siteKey}`
    script.async = true
    script.onload = () => window.grecaptcha!.ready(() => resolve(window.grecaptcha!))
    script.onerror = () => {
      loading = null
      reject(new Error('Gagal memuat reCAPTCHA. Periksa koneksi internet.'))
    }
    document.head.appendChild(script)
  }))
  return loading
}

// Domain yang tidak terdaftar di reCAPTCHA membuat execute tidak pernah selesai, jadi diberi batas waktu
export async function getRecaptchaToken(action: string) {
  const { siteKey } = await getCaptchaConfig()
  if (!siteKey) return undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Verifikasi reCAPTCHA tidak merespons. Muat ulang halaman lalu coba lagi.')), 15000)
  })
  try {
    return await Promise.race([loadRecaptcha().then((grecaptcha) => grecaptcha.execute(siteKey, { action })), timeout])
  } finally {
    clearTimeout(timer)
  }
}
