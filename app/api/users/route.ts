import bcrypt from 'bcryptjs'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { assertCanTouchSuperAdmin, loadRole, validEmail, validPassword } from '@/lib/admin'
import { fail, handle, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { PERMISSIONS } from '@/lib/permissions'
import { assertDivision } from '@/lib/planning'

const USER_LIST_SELECT = `SELECT u.id, u.name, u.email, u.is_active, u.last_login_at, u.created_at,
  u.division_id, d.name AS division_name, u.role_id, r.code AS role_code, r.name AS role_name, r.is_super_admin,
  (SELECT COUNT(*) FROM user_permissions up WHERE up.user_id = u.id) AS override_count
  FROM users u JOIN divisions d ON d.id = u.division_id JOIN roles r ON r.id = u.role_id`

export const GET = handle(async () => {
  await requireUser(PERMISSIONS.usersManage)
  const [rows] = await db.query<RowDataPacket[]>(`${USER_LIST_SELECT} ORDER BY d.sort_order, r.is_super_admin DESC, r.is_admin DESC, r.id, u.name`)
  return NextResponse.json({ items: rows.map((row) => ({ ...row, is_active: !!row.is_active, is_super_admin: !!row.is_super_admin, override_count: Number(row.override_count) })) })
})

export const POST = handle(async (request: Request) => {
  const actor = await requireUser(PERMISSIONS.usersManage)
  const body = await readJson(request)
  const name = str(body.name, 100)
  if (!name) fail(400, 'Nama wajib diisi.')
  const email = validEmail(body.email)
  const password = validPassword(body.password)
  const divisionId = await assertDivision(body.division_id)
  const role = await loadRole(body.role_id)
  assertCanTouchSuperAdmin(actor, role)

  const [result] = await db.query<ResultSetHeader>(
    'INSERT INTO users (name, email, password_hash, role_id, division_id, is_active) VALUES (?, ?, ?, ?, ?, ?)',
    [name, email, await bcrypt.hash(password, 10), role.id, divisionId, body.is_active === false ? 0 : 1],
  )
  return NextResponse.json({ id: result.insertId }, { status: 201 })
})
