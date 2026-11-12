import { NextResponse } from 'next/server'
import type { ResultSetHeader } from 'mysql2'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { logActivity } from '@/lib/activity'
import { db } from '@/lib/db'

// Hapus permanen banyak sekaligus (Super Admin saja): { ids: number[] } (yang dipilih) atau { all: true, modul?, q? } (semua sesuai filter)
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  if (!user.role.isSuperAdmin) fail(403, 'Hapus permanen hanya untuk Super Admin.')
  const body = await readJson(request)
  const where = ['r.restored_at IS NULL']
  const args: unknown[] = []
  if (Array.isArray(body.ids)) {
    const ids = body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 1000)
    if (!ids.length) fail(400, 'Pilih data yang akan dihapus permanen.')
    where.push('r.id IN (?)'), args.push(ids)
  } else if (body.all === true) {
    if (typeof body.modul === 'string' && body.modul) where.push('r.modul = ?'), args.push(body.modul)
    const q = typeof body.q === 'string' ? body.q.trim().slice(0, 80) : ''
    if (q) where.push('(r.label LIKE ? OR r.modul LIKE ? OR ud.name LIKE ?)'), args.push(...Array(3).fill(`%${q}%`))
  } else fail(400, 'Pilih data yang akan dihapus permanen.')

  const [res] = await db.query<ResultSetHeader>(
    `DELETE r FROM deleted_records r LEFT JOIN users ud ON ud.id = r.deleted_by WHERE ${where.join(' AND ')}`, args,
  )
  if (!res.affectedRows) fail(404, 'Tidak ada data terhapus yang cocok.')
  await logActivity(request, user, { module: 'Data Terhapus', action: 'delete', entity: null, description: `Menghapus permanen ${res.affectedRows} data terhapus sekaligus` })
  return NextResponse.json({ deleted: res.affectedRows })
})
