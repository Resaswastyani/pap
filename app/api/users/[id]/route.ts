import bcrypt from 'bcryptjs'
import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { assertCanTouchSuperAdmin, loadRole, validEmail, validPassword } from '@/lib/admin'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { PERMISSIONS } from '@/lib/permissions'
import { assertDivision } from '@/lib/planning'

type Ctx = { params: Promise<{ id: string }> }

async function loadTarget(ctx: Ctx) {
  const id = int((await ctx.params).id) ?? fail(404, 'User tidak ditemukan.')
  const [rows] = await db.query<RowDataPacket[]>('SELECT u.id, u.role_id, r.is_super_admin FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?', [id])
  return (rows[0] as { id: number; role_id: number; is_super_admin: number }) ?? fail(404, 'User tidak ditemukan.')
}

export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const actor = await requireUser(PERMISSIONS.usersManage)
  const target = await loadTarget(ctx)
  assertCanTouchSuperAdmin(actor, target)
  const body = await readJson(request)
  const sets: string[] = []
  const args: unknown[] = []

  if ('name' in body) {
    const name = str(body.name, 100)
    if (!name) fail(400, 'Nama wajib diisi.')
    sets.push('name = ?'), args.push(name)
  }
  if ('email' in body) sets.push('email = ?'), args.push(validEmail(body.email))
  if (typeof body.password === 'string' && body.password) sets.push('password_hash = ?'), args.push(await bcrypt.hash(validPassword(body.password), 10))
  if ('division_id' in body) sets.push('division_id = ?'), args.push(await assertDivision(body.division_id))
  if ('role_id' in body) {
    const role = await loadRole(body.role_id)
    assertCanTouchSuperAdmin(actor, role)
    if (target.id === actor.id && role.id !== target.role_id) fail(400, 'Anda tidak dapat mengubah role akun sendiri.')
    sets.push('role_id = ?'), args.push(role.id)
  }
  if ('is_active' in body) {
    if (target.id === actor.id && !body.is_active) fail(400, 'Anda tidak dapat menonaktifkan akun sendiri.')
    sets.push('is_active = ?'), args.push(body.is_active ? 1 : 0)
  }
  if (!sets.length) fail(400, 'Tidak ada perubahan.')
  await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...args, target.id])
  return NextResponse.json({ ok: true })
})

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const actor = await requireUser(PERMISSIONS.usersManage)
  const target = await loadTarget(ctx)
  assertCanTouchSuperAdmin(actor, target)
  if (target.id === actor.id) fail(400, 'Anda tidak dapat menghapus akun sendiri.')
  try {
    await db.query('DELETE FROM users WHERE id = ?', [target.id])
  } catch (error) {
    if ((error as { code?: string }).code === 'ER_ROW_IS_REFERENCED_2') fail(409, 'User sudah punya data planning. Nonaktifkan akun ini sebagai gantinya.')
    throw error
  }
  return NextResponse.json({ ok: true })
})
