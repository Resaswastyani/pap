import { NextResponse } from 'next/server'
import type { RowDataPacket } from 'mysql2'
import { handle, pageParams, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canSeeAllDeleted } from '@/lib/recycle-bin'

// Data Terhapus: ?status=terhapus|dipulihkan &modul= &q= &page= &pageSize=
// Admin melihat semua; user lain hanya data yang ia hapus sendiri.
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  const params = new URL(request.url).searchParams
  const all = canSeeAllDeleted(user)
  const where: string[] = [params.get('status') === 'dipulihkan' ? 'r.restored_at IS NOT NULL' : 'r.restored_at IS NULL']
  const args: unknown[] = []
  if (!all) where.push('r.deleted_by = ?'), args.push(user.id)
  const scopeSql = all ? '1 = 1' : 'r.deleted_by = ?'
  const scopeArgs = all ? [] : [user.id]
  const modul = params.get('modul')
  if (modul) where.push('r.modul = ?'), args.push(modul)
  const q = params.get('q')?.trim()
  if (q) where.push('(r.label LIKE ? OR r.modul LIKE ? OR ud.name LIKE ?)'), args.push(...Array(3).fill(`%${q.slice(0, 80)}%`))
  const { page, pageSize, offset } = pageParams(params, 25)
  const from = `FROM deleted_records r LEFT JOIN users ud ON ud.id = r.deleted_by LEFT JOIN users ur ON ur.id = r.restored_by WHERE ${where.join(' AND ')}`
  const [[count]] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) AS n ${from}`, args)
  const [items] = await db.query<RowDataPacket[]>(
    `SELECT r.id, r.modul, r.label, r.row_count, r.size_bytes, r.deleted_at, r.restored_at, r.deleted_by, ud.name AS deleted_name, ur.name AS restored_name
     ${from} ORDER BY COALESCE(r.restored_at, r.deleted_at) DESC, r.id DESC LIMIT ? OFFSET ?`,
    [...args, pageSize, offset],
  )
  const [moduls] = await db.query<RowDataPacket[]>(`SELECT r.modul, COUNT(*) AS n FROM deleted_records r WHERE r.restored_at IS NULL AND ${scopeSql} GROUP BY r.modul ORDER BY r.modul`, scopeArgs)
  return NextResponse.json({
    items: items.map((r) => ({ ...r, row_count: Number(r.row_count), size_bytes: Number(r.size_bytes) })),
    total: Number(count.n), page, pageSize,
    moduls: moduls.map((m) => ({ modul: m.modul, n: Number(m.n) })),
    can: { all, purge: user.role.isSuperAdmin },
  })
})
