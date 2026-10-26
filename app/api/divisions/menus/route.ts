import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { CONFIGURABLE_MENU_KEYS, MENU_GROUPS, MENU_KEYS, PERMISSION_MENUS } from '@/lib/menus'
import { PERMISSIONS } from '@/lib/permissions'
import { can, type UserProfile } from '@/lib/users'

// Pengaturan menu per divisi (Manajemen Role): manajemen (Admin / GM) atau pemegang permission kelola role
const canManageMenus = (user: UserProfile) => user.role.isAdmin || user.division.code === 'general_manager' || can(user, PERMISSIONS.rolesManage)

export const GET = handle(async () => {
  const user = await requireUser()
  if (!canManageMenus(user)) fail(403, 'Pengaturan menu divisi hanya untuk manajemen.')
  const [divisions] = await db.query<RowDataPacket[]>(
    `SELECT d.id, d.code, d.name, (SELECT COUNT(*) FROM users u WHERE u.division_id = d.id AND u.is_active = 1) AS users
     FROM divisions d ORDER BY d.sort_order, d.name`,
  )
  const [rows] = await db.query<(RowDataPacket & { division_id: number; menu_key: string })[]>('SELECT division_id, menu_key FROM division_menus')
  return NextResponse.json({
    groups: MENU_GROUPS.map((g) => ({ label: g.label, items: g.items.map((label) => ({ label, key: MENU_KEYS[label], permission: PERMISSION_MENUS[MENU_KEYS[label]] ?? null })) })),
    divisions: divisions.map((d) => ({
      id: d.id, code: d.code, name: d.name, users: Number(d.users),
      menus: rows.filter((r) => r.division_id === d.id && (CONFIGURABLE_MENU_KEYS as string[]).includes(r.menu_key)).map((r) => r.menu_key),
    })),
  })
})

// Simpan menu satu divisi: { division_id, menus: [...] }. Hanya menu di katalog yang diganti.
export const PUT = handle(async (request: Request) => {
  const user = await requireUser()
  if (!canManageMenus(user)) fail(403, 'Pengaturan menu divisi hanya untuk manajemen.')
  const body = await readJson(request)
  const divisionId = int(body.division_id) ?? fail(400, 'Divisi tidak valid.')
  const [[division]] = await db.query<(RowDataPacket & { id: number; name: string })[]>('SELECT id, name FROM divisions WHERE id = ?', [divisionId])
  if (!division) fail(404, 'Divisi tidak ditemukan.')
  const menus = Array.isArray(body.menus) ? [...new Set(body.menus.filter((m): m is string => typeof m === 'string' && (CONFIGURABLE_MENU_KEYS as string[]).includes(m)))] : fail(400, 'Daftar menu tidak valid.')

  const [beforeRows] = await db.query<(RowDataPacket & { menu_key: string })[]>('SELECT menu_key FROM division_menus WHERE division_id = ? AND menu_key IN (?)', [divisionId, CONFIGURABLE_MENU_KEYS])
  const before = beforeRows.map((r) => r.menu_key)
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('DELETE FROM division_menus WHERE division_id = ? AND menu_key IN (?)', [divisionId, CONFIGURABLE_MENU_KEYS])
    if (menus.length) await conn.query('INSERT INTO division_menus (division_id, menu_key) VALUES ?', [menus.map((m) => [divisionId, m])])
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }

  const label = (key: string) => Object.entries(MENU_KEYS).find(([, k]) => k === key)?.[0] ?? key
  const added = menus.filter((m) => !before.includes(m)).map(label)
  const removed = before.filter((m) => !menus.includes(m)).map(label)
  if (added.length || removed.length) {
    await logActivity(request, user, {
      module: 'Manajemen Role', action: 'update', entity: { type: 'division', id: divisionId, label: division.name },
      description: `Mengubah menu divisi ${division.name}${added.length ? ` · tambah: ${added.join(', ')}` : ''}${removed.length ? ` · hapus: ${removed.join(', ')}` : ''}`,
    })
  }
  return NextResponse.json({ ok: true, menus })
})
