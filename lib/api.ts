import { NextResponse } from 'next/server'
import { setActivityActor, withActivity } from '@/lib/activity'
import type { PermissionCode } from '@/lib/permissions'
import { can, getCurrentUser, type UserProfile } from '@/lib/users'

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

// Bungkus handler route: ApiError jadi respons JSON, error lain jadi 500.
// Aksi tambah/ubah/hapus yang berhasil otomatis dicatat ke log aktivitas.
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => withActivity(args[0] instanceof Request ? args[0] : null, async () => {
    try {
      return await fn(...args)
    } catch (error) {
      if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status })
      const code = (error as { code?: string })?.code
      if (code === 'ER_DUP_ENTRY') return NextResponse.json({ error: 'Data sudah ada (duplikat).' }, { status: 409 })
      console.error('[api]', error)
      return NextResponse.json({ error: 'Terjadi kesalahan pada server.' }, { status: 500 })
    }
  })
}

export async function readJson(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') fail(400, 'Body request tidak valid.')
  return body as Record<string, unknown>
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
