import { NextResponse } from 'next/server'
import { loadPermissions, loadRole } from '@/lib/admin'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { PERMISSIONS } from '@/lib/permissions'

type Ctx = { params: Promise<{ id: string }> }

// Ubah nama/deskripsi role dan permission bawaannya: { name?, description?, permissions?: string[] }
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  await requireUser(PERMISSIONS.rolesManage)
  const role = await loadRole(int((await ctx.params).id) ?? fail(404, 'Role tidak ditemukan.'))
  const body = await readJson(request)

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    if ('name' in body || 'description' in body) {
      const name = 'name' in body ? str(body.name, 100) : role.name
      if (!name) fail(400, 'Nama role wajib diisi.')
      await conn.query('UPDATE roles SET name = ?, description = ? WHERE id = ?', [name, 'description' in body ? str(body.description, 255) || null : role.description, role.id])
    }
    if (Array.isArray(body.permissions)) {
      if (role.is_super_admin) fail(400, 'Permission Super Admin tidak dapat diubah (selalu semua).')
      const wanted = new Set(body.permissions.filter((code): code is string => typeof code === 'string'))
      await conn.query('DELETE FROM role_permissions WHERE role_id = ?', [role.id])
      for (const permission of await loadPermissions()) {
        if (wanted.has(permission.code)) await conn.query('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [role.id, permission.id])
      }
    }
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
  return NextResponse.json({ ok: true })
})
