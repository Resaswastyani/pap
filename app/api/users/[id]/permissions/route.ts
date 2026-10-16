import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { logUserActivity, type ActivityChange } from '@/lib/activity'
import { assertCanTouchSuperAdmin, loadPermissions } from '@/lib/admin'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { PERMISSIONS } from '@/lib/permissions'

type Ctx = { params: Promise<{ id: string }> }
type Override = 'inherit' | 'allow' | 'deny'

async function loadTarget(ctx: Ctx) {
  const id = int((await ctx.params).id) ?? fail(404, 'User tidak ditemukan.')
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT u.id, u.name, u.email, u.role_id, r.name AS role_name, r.is_super_admin FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?',
    [id],
  )
  return (rows[0] as { id: number; name: string; email: string; role_id: number; role_name: string; is_super_admin: number }) ?? fail(404, 'User tidak ditemukan.')
}

// Permission user: bawaan role + override per user
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  await requireUser(PERMISSIONS.usersManage)
  const target = await loadTarget(ctx)
  const [fromRole] = await db.query<RowDataPacket[]>('SELECT permission_id FROM role_permissions WHERE role_id = ?', [target.role_id])
  const [overrides] = await db.query<RowDataPacket[]>('SELECT permission_id, allowed FROM user_permissions WHERE user_id = ?', [target.id])
  const roleSet = new Set(fromRole.map((row) => row.permission_id))
  const overrideMap = new Map(overrides.map((row) => [row.permission_id, row.allowed ? 'allow' : 'deny']))
  const items = (await loadPermissions()).map((permission) => {
    const fromRoleDefault = !!target.is_super_admin || roleSet.has(permission.id)
    const override = (overrideMap.get(permission.id) ?? 'inherit') as Override
    return { ...permission, from_role: fromRoleDefault, override, effective: !!target.is_super_admin || (override === 'inherit' ? fromRoleDefault : override === 'allow') }
  })
  return NextResponse.json({ user: { id: target.id, name: target.name, role_name: target.role_name, is_super_admin: !!target.is_super_admin }, items })
})

// Simpan override: { overrides: { "planning.manage": "allow" | "deny" | "inherit", ... } }
export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const actor = await requireUser(PERMISSIONS.usersManage)
  const target = await loadTarget(ctx)
  assertCanTouchSuperAdmin(actor, target)
  if (target.is_super_admin) fail(400, 'Super Admin selalu punya semua permission.')
  const body = await readJson(request)
  const overrides = (body.overrides ?? {}) as Record<string, Override>
  const permissions = await loadPermissions()
  const [previous] = await db.query<RowDataPacket[]>('SELECT permission_id, allowed FROM user_permissions WHERE user_id = ?', [target.id])
  const beforeMap = new Map<number, Override>(previous.map((row) => [row.permission_id, row.allowed ? 'allow' : 'deny']))

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('DELETE FROM user_permissions WHERE user_id = ?', [target.id])
    for (const permission of permissions) {
      const value = overrides[permission.code]
      if (value === 'allow' || value === 'deny') {
        await conn.query('INSERT INTO user_permissions (user_id, permission_id, allowed) VALUES (?, ?, ?)', [target.id, permission.id, value === 'allow' ? 1 : 0])
      }
    }
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }

  const LABEL: Record<Override, string> = { inherit: 'Ikuti role', allow: 'Izinkan', deny: 'Cabut' }
  const changes: ActivityChange[] = permissions.flatMap((permission) => {
    const from = beforeMap.get(permission.id) ?? 'inherit'
    const value = overrides[permission.code]
    const to: Override = value === 'allow' || value === 'deny' ? value : 'inherit'
    return from === to ? [] : [{ field: permission.name, from: LABEL[from], to: LABEL[to] }]
  })
  if (changes.length) await logUserActivity(request, actor, { action: 'permission', target, description: `Mengubah ${changes.length} permission user ${target.name}`, changes })
  return NextResponse.json({ ok: true })
})
