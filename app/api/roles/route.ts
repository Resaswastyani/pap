import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { loadPermissions } from '@/lib/admin'
import { fail, handle, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { PERMISSIONS } from '@/lib/permissions'
import { can } from '@/lib/users'

// Daftar role + permission bawaannya (untuk menu Manajemen Role & form user)
export const GET = handle(async () => {
  const user = await requireUser()
  if (!can(user, PERMISSIONS.rolesManage) && !can(user, PERMISSIONS.usersManage)) fail(403, 'Anda tidak punya akses untuk aksi ini.')
  const [roles] = await db.query<RowDataPacket[]>(
    `SELECT r.id, r.code, r.name, r.description, r.is_admin, r.is_super_admin,
       (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count
     FROM roles r ORDER BY r.is_super_admin DESC, r.is_admin DESC, r.id`,
  )
  const [links] = await db.query<RowDataPacket[]>('SELECT rp.role_id, p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id')
  const permissions = await loadPermissions()
  const items = roles.map((role) => ({
    ...role,
    is_admin: !!role.is_admin,
    is_super_admin: !!role.is_super_admin,
    user_count: Number(role.user_count),
    permissions: role.is_super_admin ? permissions.map((p) => p.code) : links.filter((link) => link.role_id === role.id).map((link) => link.code),
  }))
  return NextResponse.json({ items, permissions })
})
