import { NextResponse } from 'next/server'
import type { RowDataPacket } from 'mysql2'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { logActivity } from '@/lib/activity'
import { db } from '@/lib/db'
import { canSeeAllDeleted, restoreDeleted } from '@/lib/recycle-bin'

// Pulihkan banyak sekaligus: { ids: number[] } (yang dipilih) atau { all: true, modul?, q? } (semua sesuai filter).
// Dipulihkan urut waktu hapus (terlama dulu) agar data induk kembali sebelum turunannya; yang gagal dilewati & dilaporkan.
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  const body = await readJson(request)
  const where = ['r.restored_at IS NULL']
  const args: unknown[] = []
  if (!canSeeAllDeleted(user)) where.push('r.deleted_by = ?'), args.push(user.id)
  if (Array.isArray(body.ids)) {
    const ids = body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 500)
    if (!ids.length) fail(400, 'Pilih data yang akan dipulihkan.')
    where.push('r.id IN (?)'), args.push(ids)
  } else if (body.all === true) {
    if (typeof body.modul === 'string' && body.modul) where.push('r.modul = ?'), args.push(body.modul)
    const q = typeof body.q === 'string' ? body.q.trim().slice(0, 80) : ''
    if (q) where.push('(r.label LIKE ? OR r.modul LIKE ? OR ud.name LIKE ?)'), args.push(...Array(3).fill(`%${q}%`))
  } else fail(400, 'Pilih data yang akan dipulihkan.')

  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT r.id, r.modul, r.label FROM deleted_records r LEFT JOIN users ud ON ud.id = r.deleted_by WHERE ${where.join(' AND ')} ORDER BY r.deleted_at, r.id LIMIT 500`, args,
  )
  if (!rows.length) fail(404, 'Tidak ada data terhapus yang cocok.')
  const ok: string[] = []
  const failed: { label: string; error: string }[] = []
  for (const r of rows) {
    try {
      await restoreDeleted(Number(r.id), user)
      ok.push(`${r.modul}: ${r.label}`)
    } catch (e) {
      failed.push({ label: `${r.modul}: ${r.label}`, error: (e as Error).message })
    }
  }
  if (ok.length) {
    await logActivity(request, user, { module: 'Data Terhapus', action: 'restore', entity: null, description: `Memulihkan ${ok.length} data sekaligus: ${ok.slice(0, 10).join('; ')}${ok.length > 10 ? '; …' : ''}` })
  }
  return NextResponse.json({ restored: ok.length, failed })
})
