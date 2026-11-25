import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { ACTION_KEYS, MENU_ACTIONS, WRITABLE_MENUS, type MenuAction } from '@/lib/menu-actions'
import { MENU_DISPLAY, MENU_GROUPS, MENU_KEYS } from '@/lib/menus'
import { PERMISSIONS } from '@/lib/permissions'
import { can, type UserProfile } from '@/lib/users'

// Matriks akses Menu x Aksi per role (Manajemen Role > Akses menu & aksi)
const canManage = (u: UserProfile) => u.role.isSuperAdmin || u.role.isAdmin || can(u, PERMISSIONS.rolesManage)

// Katalog menu seperti di sidebar (satu kunci bisa dipakai beberapa label; ditampilkan sekali)
function catalog() {
  const seen = new Set<string>()
  return MENU_GROUPS.map((g) => ({
    label: g.label,
    items: g.items.flatMap((label) => {
      const key = MENU_KEYS[label]
      if (seen.has(key)) return []
      seen.add(key)
      return [{ key, label: MENU_DISPLAY[label] ?? label, actions: WRITABLE_MENUS.has(key) ? ACTION_KEYS : (['view'] as MenuAction[]) }]
    }),
  })).filter((g) => g.items.length)
}

export const GET = handle(async () => {
  const user = await requireUser()
  if (!canManage(user)) fail(403, 'Pengaturan akses menu hanya untuk Super Admin, Admin, atau pemegang permission kelola role.')
  const [roles] = await db.query<RowDataPacket[]>(
    `SELECT r.id, r.code, r.name, r.description, r.is_admin, r.is_super_admin, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id AND u.is_active = 1) AS users
     FROM roles r ORDER BY r.is_super_admin DESC, r.is_admin DESC, r.id`,
  )
  const [rows] = await db.query<RowDataPacket[]>('SELECT role_id, menu_key, action FROM role_menu_denials')
  // Divisi yang membuka tiap menu (info: menu tetap harus dibuka per divisi di tab Menu per divisi)
  const [divs] = await db.query<RowDataPacket[]>('SELECT dm.menu_key, d.name FROM division_menus dm JOIN divisions d ON d.id = dm.division_id ORDER BY d.sort_order, d.name')
  const divisions: Record<string, string[]> = {}
  for (const d of divs) (divisions[String(d.menu_key)] ??= []).push(String(d.name))
  return NextResponse.json({
    actions: MENU_ACTIONS,
    groups: catalog(),
    divisions,
    roles: roles.map((r) => ({
      id: Number(r.id), code: String(r.code), name: String(r.name), description: (r.description as string) ?? null,
      is_admin: !!r.is_admin, is_super_admin: !!r.is_super_admin, users: Number(r.users),
      denied: rows.filter((d) => Number(d.role_id) === Number(r.id)).map((d) => `${d.menu_key}:${d.action}`),
    })),
  })
})

// Simpan matriks satu role: { role_id, denied: ["prospek:delete", ...] } (daftar aksi yang DICABUT)
export const PUT = handle(async (request: Request) => {
  const user = await requireUser()
  if (!canManage(user)) fail(403, 'Pengaturan akses menu hanya untuk Super Admin, Admin, atau pemegang permission kelola role.')
  const body = await readJson(request)
  const roleId = int(body.role_id) ?? fail(400, 'Role tidak valid.')
  const [[role]] = await db.query<RowDataPacket[]>('SELECT id, name, is_super_admin FROM roles WHERE id = ?', [roleId])
  if (!role) fail(404, 'Role tidak ditemukan.')
  if (role.is_super_admin) fail(400, 'Super Admin selalu memiliki semua akses.')
  // Admin tidak boleh mencabut akses Manajemen Role dari role-nya sendiri (agar tidak terkunci)
  const valid = new Set(catalog().flatMap((g) => g.items.flatMap((i) => i.actions.map((a) => `${i.key}:${a}`))))
  const wanted = [...new Set((Array.isArray(body.denied) ? body.denied : []).filter((x: unknown): x is string => typeof x === 'string' && valid.has(x)))]
  if (Number(role.id) === user.role.id && wanted.some((x) => x.startsWith('roles:'))) fail(400, 'Akses Manajemen Role tidak bisa dicabut dari role Anda sendiri.')

  const [beforeRows] = await db.query<RowDataPacket[]>('SELECT menu_key, action FROM role_menu_denials WHERE role_id = ?', [role.id])
  const before = new Set(beforeRows.map((d) => `${d.menu_key}:${d.action}`))
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('DELETE FROM role_menu_denials WHERE role_id = ?', [role.id])
    if (wanted.length) await conn.query('INSERT INTO role_menu_denials (role_id, menu_key, action, created_by) VALUES ?', [wanted.map((x) => { const [k, a] = x.split(':'); return [role.id, k, a, user.id] })])
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
  const dicabut = wanted.filter((x) => !before.has(x))
  const dibuka = [...before].filter((x) => !wanted.includes(x))
  await logActivity(request, user, {
    module: 'Manajemen Role', action: 'update', entity: { type: 'role', id: Number(role.id), label: String(role.name) },
    description: `Akses menu role ${role.name}: ${dicabut.length} dicabut, ${dibuka.length} dibuka${dicabut.length ? ` (cabut: ${dicabut.slice(0, 8).join(', ')}${dicabut.length > 8 ? ', …' : ''})` : ''}`,
  })
  return NextResponse.json({ ok: true, toast: `Akses menu role ${role.name} disimpan (${dicabut.length} dicabut, ${dibuka.length} dibuka)` })
})
