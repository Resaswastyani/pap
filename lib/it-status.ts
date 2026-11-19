import os from 'node:os'
import { readFile, statfs } from 'node:fs/promises'
import { accurateEnabled } from '@/lib/accurate'
import { cronStatus } from '@/lib/cron-log'
import { db } from '@/lib/db'
import { driveAccount, googleAccessToken, oauthConfigured } from '@/lib/drive'
import type { UserProfile } from '@/lib/users'

// Pengaturan › IT: hanya Super Admin / admin dan divisi Staff IT
export const canSeeIt = (user: UserProfile) => user.role.isAdmin || user.division.code === 'staff_it'

const PUBLIC_URL = process.env.APP_URL?.replace(/\/$/, '') || 'https://sistem-management-pap.pandawaamerta.co.id'

// Data transfer jaringan sejak server menyala (Linux /proc/net/dev); kuota bulanan Hostinger dilihat di hPanel
async function network() {
  try {
    const text = await readFile('/proc/net/dev', 'utf8')
    let rx = 0
    let tx = 0
    for (const line of text.split('\n').slice(2)) {
      const [name, data] = line.split(':')
      if (!data || /^(lo|docker|veth|br-)/.test(name.trim())) continue
      const f = data.trim().split(/\s+/).map(Number)
      rx += f[0] || 0
      tx += f[8] || 0
    }
    return { rx, tx }
  } catch {
    return null
  }
}

async function disk() {
  try {
    const s = await statfs('/')
    return { total: s.blocks * s.bsize, free: s.bavail * s.bsize }
  } catch {
    return null
  }
}

export async function appVersion() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)
  try {
    const head = (await readFile('.git/HEAD', 'utf8')).trim()
    const sha = head.startsWith('ref:') ? (await readFile(`.git/${head.slice(5)}`, 'utf8')).trim() : head
    return sha.slice(0, 7)
  } catch {
    return null
  }
}

function serviceAccountInfo() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()
  if (!raw) return null
  try {
    const j = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'))
    return { email: (j.client_email as string) ?? null, project: (j.project_id as string) ?? null }
  } catch {
    return null
  }
}

const recaptchaMode = () =>
  process.env.RECAPTCHA_V2_SITE_KEY && process.env.RECAPTCHA_V2_SECRET_KEY ? 'v2' : process.env.RECAPTCHA_SITE_KEY && process.env.RECAPTCHA_SECRET_KEY ? 'v3' : null

export async function itStatus() {
  const [net, dsk, ver, crons, account, [[db1]]] = await Promise.all([
    network(), disk(), appVersion(), cronStatus(), driveAccount().catch(() => null),
    db.query<import('mysql2').RowDataPacket[]>(
      `SELECT VERSION() AS versi, (SELECT ROUND(SUM(data_length + index_length)) FROM information_schema.tables WHERE table_schema = DATABASE()) AS ukuran,
         (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()) AS tabel`,
    ),
  ])
  const mem = process.memoryUsage()
  const sa = serviceAccountInfo()
  const recaptcha = recaptchaMode()
  return {
    url: PUBLIC_URL,
    server: {
      host: os.hostname(), platform: `${os.type()} ${os.release()}`, node: process.version, versi: ver, lingkungan: process.env.NODE_ENV ?? null,
      uptime: os.uptime(), app_uptime: Math.round(process.uptime()), cpus: os.cpus().length, load: os.loadavg().map((n) => Math.round(n * 100) / 100),
      mem_total: os.totalmem(), mem_free: os.freemem(), app_rss: mem.rss, app_heap: mem.heapUsed,
      disk: dsk, network: net,
    },
    database: { versi: db1.versi as string, ukuran: Number(db1.ukuran) || 0, tabel: Number(db1.tabel) || 0 },
    crons: crons.map((c) => ({ ...c, url: `${PUBLIC_URL}/api/cron/${c.name}` })),
    cron_secret: !!process.env.CRON_SECRET?.trim(),
    google: {
      oauth: oauthConfigured(), service_account: sa, drive: account ? { mode: account.mode, email: account.email } : null,
      project: sa?.project ?? null,
    },
    recaptcha: { mode: recaptcha, min_score: recaptcha === 'v3' ? Number(process.env.RECAPTCHA_MIN_SCORE || 0.5) : null },
    accurate: accurateEnabled(),
  }
}

// ---- Aksi uji dari halaman IT ----

// Kunci rahasia reCAPTCHA diuji dengan token palsu: "invalid-input-response" = kunci benar, "invalid-input-secret" = kunci salah
export async function testRecaptcha() {
  const mode = recaptchaMode()
  if (!mode) return { ok: false, message: 'reCAPTCHA belum dikonfigurasi (login tanpa captcha).' }
  const secret = mode === 'v2' ? process.env.RECAPTCHA_V2_SECRET_KEY! : process.env.RECAPTCHA_SECRET_KEY!
  const res = await fetch('https://www.google.com/recaptcha/api/siteverify', { method: 'POST', body: new URLSearchParams({ secret, response: 'tes-koneksi-simpap' }), cache: 'no-store' })
  const body = (await res.json()) as { 'error-codes'?: string[] }
  const codes = body['error-codes'] ?? []
  if (codes.includes('invalid-input-secret')) return { ok: false, message: `Secret key reCAPTCHA ${mode} DITOLAK Google. Periksa kunci di server.` }
  return { ok: true, message: `Google reCAPTCHA ${mode} terhubung dan secret key valid.` }
}

// Akses Google: ambil token lalu baca info akun & kuota penyimpanan Drive
export async function testGoogle() {
  const account = await driveAccount().catch(() => null)
  if (!account) return { ok: false, message: 'Belum ada akun Google / service account yang terhubung.' }
  const token = await googleAccessToken()
  const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress),storageQuota', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
  const body = (await res.json().catch(() => ({}))) as { user?: { emailAddress?: string }; storageQuota?: { limit?: string; usage?: string }; error?: { message?: string } }
  if (!res.ok) return { ok: false, message: `Google Drive API menolak: ${body.error?.message ?? res.status}` }
  const q = body.storageQuota
  const gb = (v?: string) => (v ? `${(Number(v) / 1024 ** 3).toLocaleString('id-ID', { maximumFractionDigits: 1 })} GB` : '?')
  return {
    ok: true,
    message: `Google Drive terhubung sebagai ${body.user?.emailAddress ?? account.email}. Penyimpanan terpakai ${gb(q?.usage)}${q?.limit ? ` dari ${gb(q.limit)}` : ''}.`,
  }
}

export async function testDatabase() {
  const started = Date.now()
  await db.query('SELECT 1')
  return { ok: true, message: `Database merespons dalam ${Date.now() - started} ms.` }
}

// Jalankan cron sekarang lewat server sendiri (pakai CRON_SECRET di server, tidak pernah ke browser)
export async function runCron(name: string) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return { ok: false, message: 'CRON_SECRET belum diisi di server.' }
  const port = process.env.PORT || '3000'
  const started = Date.now()
  const res = await fetch(`http://127.0.0.1:${port}/api/cron/${name}`, { headers: { Authorization: `Bearer ${secret}`, 'x-pap-manual': '1' }, cache: 'no-store', signal: AbortSignal.timeout(90_000) })
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; reminders?: number }
  const ok = res.ok && body.ok !== false
  const detail = body.error ?? (typeof body.reminders === 'number' ? `${body.reminders} reminder dibuat` : '')
  return { ok, message: `${ok ? 'Berhasil' : 'Gagal'} (HTTP ${res.status}, ${((Date.now() - started) / 1000).toFixed(1)} detik)${detail ? `: ${detail}` : '.'}` }
}
