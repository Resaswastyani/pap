import type { RowDataPacket } from 'mysql2'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { ALL_MENU_KEYS, PERMISSION_MENUS, type MenuKey } from '@/lib/menus'
import { ALL_PERMISSIONS, type PermissionCode } from '@/lib/permissions'

export type UserProfile = {
  id: number
  name: string
  email: string
  division: { id: number; code: string; name: string }
  role: { id: number; code: string; name: string; isAdmin: boolean; isSuperAdmin: boolean }
  permissions: PermissionCode[]
  menus: MenuKey[]
}

type UserRow = RowDataPacket & {
  id: number
  name: string
  email: string
  password_hash: string
  is_active: number
  role_id: number
  role_code: string
  role_name: string
  is_admin: number
  is_super_admin: number
  division_id: number
  division_code: string
  division_name: string
}

const USER_SELECT = `SELECT u.id, u.name, u.email, u.password_hash, u.is_active, u.role_id,
  r.code AS role_code, r.name AS role_name, r.is_admin, r.is_super_admin,
  u.division_id, d.code AS division_code, d.name AS division_name
  FROM users u JOIN roles r ON r.id = u.role_id JOIN divisions d ON d.id = u.division_id`

export async function findUserByEmail(email: string) {
  const [rows] = await db.query<UserRow[]>(`${USER_SELECT} WHERE u.email = ? LIMIT 1`, [email])
  return rows[0] ?? null
}

export async function findUserById(id: number) {
  const [rows] = await db.query<UserRow[]>(`${USER_SELECT} WHERE u.id = ? LIMIT 1`, [id])
  return rows[0] ?? null
}

// Permission efektif = permission role + tambahan user (allowed=1) - pencabutan user (allowed=0)
export async function getEffectivePermissions(userId: number, roleId: number) {
  const [rows] = await db.query<(RowDataPacket & { code: PermissionCode })[]>(
    `SELECT p.code FROM permissions p
     WHERE (p.id IN (SELECT permission_id FROM role_permissions WHERE role_id = ?)
            AND p.id NOT IN (SELECT permission_id FROM user_permissions WHERE user_id = ? AND allowed = 0))
        OR p.id IN (SELECT permission_id FROM user_permissions WHERE user_id = ? AND allowed = 1)`,
    [roleId, userId, userId],
  )
  const granted = new Set(rows.map((row) => row.code))
  return ALL_PERMISSIONS.filter((code) => granted.has(code))
}

// Super admin selalu dapat semua menu & permission
export async function toProfile(user: UserRow): Promise<UserProfile> {
  const isSuperAdmin = !!user.is_super_admin
  let permissions: PermissionCode[] = ALL_PERMISSIONS
  let menus: MenuKey[] = ALL_MENU_KEYS
  if (!isSuperAdmin) {
    permissions = await getEffectivePermissions(user.id, user.role_id)
    const [rows] = await db.query<(RowDataPacket & { menu_key: MenuKey })[]>('SELECT menu_key FROM division_menus WHERE division_id = ?', [user.division_id])
    const allowed = new Set<string>(rows.map((row) => row.menu_key))
    for (const [menu, permission] of Object.entries(PERMISSION_MENUS)) if (permissions.includes(permission as PermissionCode)) allowed.add(menu)
    allowed.add('data-terhapus')
    menus = ALL_MENU_KEYS.filter((key) => allowed.has(key))
  }
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    division: { id: user.division_id, code: user.division_code, name: user.division_name },
    role: { id: user.role_id, code: user.role_code, name: user.role_name, isAdmin: !!user.is_admin, isSuperAdmin },
    permissions,
    menus,
  }
}

export function can(profile: UserProfile, permission: PermissionCode) {
  return profile.role.isSuperAdmin || profile.permissions.includes(permission)
}

// General Manager (divisi GM) atau role Admin / Super Admin
export const isManagement = (profile: UserProfile) => profile.role.isAdmin || profile.division.code === 'general_manager'

// Kepala divisi (role Lead) di salah satu divisi ini
export const isLeadOf = (profile: UserProfile, ...divisions: string[]) => profile.role.code === 'lead' && divisions.includes(profile.division.code)

// Penerima notifikasi persetujuan: Lead divisi tertentu + semua user divisi GM
export async function leadAndGmUsers(leadDivisions: string[]) {
  const [rows] = await db.query<(RowDataPacket & { id: number })[]>(
    `SELECT u.id FROM users u JOIN divisions d ON d.id = u.division_id JOIN roles r ON r.id = u.role_id
     WHERE u.is_active = 1 AND ((r.code = 'lead' AND d.code IN (?)) OR d.code = 'general_manager')`,
    [leadDivisions.length ? leadDivisions : ['']],
  )
  return rows.map((r) => r.id)
}

// User yang sedang login (null bila sesi tidak valid atau akun dinonaktifkan)
export async function getCurrentUser() {
  const session = await getSession()
  if (!session) return null
  const user = await findUserById(session.id)
  if (!user || !user.is_active) return null
  return toProfile(user)
}
