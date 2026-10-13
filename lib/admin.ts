import type { RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'
import type { UserProfile } from '@/lib/users'

export type RoleRow = RowDataPacket & { id: number; code: string; name: string; description: string | null; is_admin: number; is_super_admin: number }

export async function loadRole(id: unknown) {
  const [rows] = await db.query<RoleRow[]>('SELECT id, code, name, description, is_admin, is_super_admin FROM roles WHERE id = ?', [Number(id)])
  return rows[0] ?? fail(400, 'Role tidak valid.')
}

export async function loadPermissions() {
  const [rows] = await db.query<(RowDataPacket & { id: number; code: string; name: string; module: string })[]>(
    'SELECT id, code, name, module FROM permissions ORDER BY sort_order, id',
  )
  return rows
}

// Hanya super admin yang boleh mengelola akun/role super admin
export function assertCanTouchSuperAdmin(actor: UserProfile, role: { is_super_admin: number }) {
  if (role.is_super_admin && !actor.role.isSuperAdmin) fail(403, 'Hanya Super Admin yang dapat mengelola akun Super Admin.')
}

export function validEmail(value: unknown) {
  const email = str(value, 150).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Email tidak valid.')
  return email
}

export function validPassword(value: unknown) {
  const password = typeof value === 'string' ? value : ''
  if (password.length < 8) fail(400, 'Password minimal 8 karakter.')
  return password
}
