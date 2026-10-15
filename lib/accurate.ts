import { createHmac } from 'node:crypto'

// Klien Accurate Online memakai API Token (Area Developer -> Simpap -> API Token, dibuat dari Accurate Store).
// Setiap request wajib membawa:
//   Authorization: Bearer <ACCURATE_API_TOKEN>
//   X-Api-Timestamp: <waktu sekarang>
//   X-Api-Signature: HMAC-SHA256(timestamp, ACCURATE_SIGNATURE_SECRET), base64
// Host database (mis. https://zeus.accurate.id) didapat dari https://account.accurate.id/api/api-token.do

const ACCOUNT_URL = 'https://account.accurate.id'

export const accurateEnabled = () => !!(process.env.ACCURATE_API_TOKEN && process.env.ACCURATE_SIGNATURE_SECRET)

export class AccurateError extends Error {
  constructor(message: string, public status?: number) {
    super(message)
  }
}

// Format waktu Accurate: dd/MM/yyyy HH:mm:ss (WIB)
export function accurateDateTime(date = new Date()) {
  const wib = new Date(date.getTime() + 7 * 3600e3)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(wib.getUTCDate())}/${p(wib.getUTCMonth() + 1)}/${wib.getUTCFullYear()} ${p(wib.getUTCHours())}:${p(wib.getUTCMinutes())}:${p(wib.getUTCSeconds())}`
}

// "31/12/2025" atau "31/12/2025 13:45:00" -> "2025-12-31" / "2025-12-31 13:45:00"
export function fromAccurateDate(value: unknown) {
  if (typeof value !== 'string') return null
  const m = value.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}:\d{2}(?::\d{2})?))?/)
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}${m[4] ? ` ${m[4].length === 5 ? `${m[4]}:00` : m[4]}` : ''}`
}

function authHeaders(): Record<string, string> {
  const token = process.env.ACCURATE_API_TOKEN
  const secret = process.env.ACCURATE_SIGNATURE_SECRET
  if (!token || !secret) throw new AccurateError('Integrasi Accurate belum dikonfigurasi (ACCURATE_API_TOKEN / ACCURATE_SIGNATURE_SECRET).')
  const timestamp = accurateDateTime()
  const signature = createHmac('sha256', secret).update(timestamp).digest('base64')
  return { Authorization: `Bearer ${token}`, 'X-Api-Timestamp': timestamp, 'X-Api-Signature': signature, Accept: 'application/json' }
}

type AccurateResponse<T> = { s: boolean; d: T; sp?: { page: number; pageSize: number; pageCount: number; rowCount: number }; r?: unknown }

function errorText(d: unknown) {
  if (Array.isArray(d)) return d.map(String).join(' ')
  if (typeof d === 'string') return d
  return JSON.stringify(d)
}

async function parse<T>(res: Response) {
  const text = await res.text()
  let json: AccurateResponse<T> | null = null
  try {
    json = JSON.parse(text)
  } catch {}
  if (!res.ok || !json || json.s === false) {
    const message = json ? errorText(json.d ?? json) : text.slice(0, 300)
    throw new AccurateError(`Accurate (${res.status}): ${message}`, res.status)
  }
  return json
}

// Info database dari API Token (host berubah sewaktu-waktu; di-cache 1 jam)
let hostCache: { host: string; database: string; expires: number } | null = null
export async function accurateDatabase(force = false) {
  if (!force && hostCache && hostCache.expires > Date.now()) return hostCache
  const res = await fetch(`${ACCOUNT_URL}/api/api-token.do`, { method: 'POST', headers: authHeaders(), cache: 'no-store', signal: AbortSignal.timeout(15000) })
  const json = await parse<{ database?: { host?: string; alias?: string; id?: number }; data_usaha?: { host?: string } } & Record<string, unknown>>(res)
  const d = json.d as Record<string, unknown>
  const database = (d.database ?? d.data_usaha ?? {}) as { host?: string; alias?: string }
  if (!database.host) throw new AccurateError(`Host database Accurate tidak ditemukan: ${JSON.stringify(d).slice(0, 200)}`)
  hostCache = { host: database.host.replace(/\/$/, ''), database: database.alias ?? '', expires: Date.now() + 3600e3 }
  return hostCache
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Params = Record<string, string | number | boolean | undefined | null>

// Panggil API data: path seperti "/api/customer/list.do"
export async function accurate<T = unknown>(path: string, options: { method?: 'GET' | 'POST' | 'DELETE'; params?: Params; body?: unknown } = {}): Promise<AccurateResponse<T>> {
  const { host } = await accurateDatabase()
  const url = new URL(`${host}/accurate${path}`)
  for (const [key, value] of Object.entries(options.params ?? {})) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: options.method ?? 'GET',
      headers: { ...authHeaders(), ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      cache: 'no-store',
      redirect: 'follow', // Accurate membalas 308 bila host database pindah
      signal: AbortSignal.timeout(20000),
    })
    // Batas pemanggilan: tunggu lalu ulangi (maks 3x)
    if (res.status === 429 && attempt < 3) {
      await sleep(1000 * (attempt + 1))
      continue
    }
    return parse<T>(res)
  }
}

// Ambil satu halaman list.do
export function accurateList<T = Record<string, unknown>>(entity: string, params: Params = {}) {
  return accurate<T[]>(`/api/${entity}/list.do`, { params: { 'sp.pageSize': 100, ...params } })
}
