import { NextResponse } from 'next/server'
import { setActivityActor, withActivity } from '@/lib/activity'
import type { PermissionCode } from '@/lib/permissions'
import { can, clearProfileCache, getCurrentUser, type UserProfile } from '@/lib/users'

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export const fail = (status: number, message: string): never => {
  throw new ApiError(status, message)
}

export async function requireUser(...permissions: PermissionCode[]) {
  const user = await getCurrentUser()
  if (!user) fail(401, 'Sesi berakhir. Silakan masuk kembali.')
  setActivityActor(user!)
  for (const permission of permissions) if (!can(user!, permission)) fail(403, 'Anda tidak punya akses untuk aksi ini.')
  return user as UserProfile
}

// Tolak aksi (tambah / ubah / hapus) yang dicabut untuk role user di matriks Menu x Aksi (Manajemen Role)
async function checkMenuAction(request: Request) {
  const { actionFor, menusForPath, MENU_ACTIONS } = await import('@/lib/menu-actions')
  const path = new URL(request.url).pathname
  const keys = menusForPath(path)
  const action = keys ? actionFor(request.method, path) : null
  if (!keys || !action) return
  const user = await getCurrentUser()
  if (!user || user.role.isSuperAdmin || !user.denied.length) return
  // Hanya menu yang dimiliki user yang dihitung; diizinkan bila salah satunya belum dicabut
  const mine = keys.filter((k) => user.menus.includes(k))
  if (!mine.length) return // akses menu diputuskan oleh route-nya sendiri
  if (mine.every((k) => user.denied.includes(`${k}:${action}`))) {
    fail(403, `Role ${user.role.name} tidak diizinkan ${MENU_ACTIONS[action].toLowerCase()} data di menu ini. Hubungi tim IT bila perlu.`)
  }
}

// Bungkus handler route: ApiError jadi respons JSON, error lain jadi 500.
// Aksi tambah/ubah/hapus yang berhasil otomatis dicatat ke log aktivitas.
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => withActivity(args[0] instanceof Request ? args[0] : null, async () => {
    const started = Date.now()
    try {
      // Matriks Menu x Aksi: tambah / ubah / hapus yang dicabut untuk role user ditolak di sini untuk semua modul
      if (args[0] instanceof Request && args[0].method !== 'GET') await checkMenuAction(args[0])
      return await fn(...args)
    } catch (error) {
      if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status })
      const code = (error as { code?: string })?.code
      if (code === 'ER_DUP_ENTRY') return NextResponse.json({ error: 'Data sudah ada (duplikat).' }, { status: 409 })
      console.error('[api]', error)
      return NextResponse.json({ error: 'Terjadi kesalahan pada server.' }, { status: 500 })
    } finally {
      const ms = Date.now() - started
      const req = args[0] instanceof Request ? args[0] : null
      // Perubahan data apa pun (termasuk akun / role / menu divisi): profil user di-cache dibaca ulang
      if (req && req.method !== 'GET') clearProfileCache()
      if (ms > 1000 && req) {
        const url = new URL(req.url)
        console.warn(`[lambat] ${req.method} ${url.pathname}${url.search ? url.search.slice(0, 120) : ''} ${ms} ms`)
      }
    }
  })
}

export async function readJson(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') fail(400, 'Body request tidak valid.')
  return body as Record<string, unknown>
}

// Alamat publik aplikasi (https://domain). Di VPS aplikasi berjalan di belakang Nginx, sehingga request.url berisi
// localhost:3000; pakai APP_URL bila diset, selain itu header dari proxy (X-Forwarded-Host / Host).
export function publicOrigin(request: Request) {
  const env = process.env.APP_URL?.trim().replace(/\/+$/, '')
  if (env) return env
  const url = new URL(request.url)
  const first = (v: string | null) => v?.split(',')[0].trim() || null
  const host = first(request.headers.get('x-forwarded-host')) ?? first(request.headers.get('host')) ?? url.host
  const proto = first(request.headers.get('x-forwarded-proto')) ?? url.protocol.replace(':', '')
  return `${/^localhost(:|$)|^127\./.test(host) ? proto : 'https'}://${host}`
}

export const str = (value: unknown, max = 255) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
export const int = (value: unknown) => {
  const n = Number(value)
  return Number.isInteger(n) ? n : null
}

// Pagination server: ?page=1&pageSize=25|50|100 (sama dengan pilihan di komponen Pager)
export function pageParams(params: URLSearchParams, defaultSize = 25) {
  const size = int(params.get('pageSize'))
  const pageSize = size && [25, 50, 100].includes(size) ? size : defaultSize
  const page = Math.max(1, int(params.get('page')) ?? 1)
  return { page, pageSize, offset: (page - 1) * pageSize }
}
