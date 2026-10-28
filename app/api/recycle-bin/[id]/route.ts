import { NextResponse } from 'next/server'
import type { ResultSetHeader } from 'mysql2'
import { fail, handle, int, requireUser } from '@/lib/api'
import { logActivity } from '@/lib/activity'
import { db } from '@/lib/db'
import { restoreDeleted } from '@/lib/recycle-bin'

type Ctx = { params: Promise<{ id: string }> }

// Pulihkan data terhapus ke modul asalnya
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  const id = int((await ctx.params).id) ?? fail(404, 'Data terhapus tidak ditemukan.')
  const rec = await restoreDeleted(id, user)
  await logActivity(request, user, { module: 'Data Terhapus', action: 'restore', entity: { type: 'deleted_record', id, label: rec.label }, description: `Memulihkan ${rec.modul}: ${rec.label}` })
  return NextResponse.json({ ok: true, ...rec })
})

// Hapus permanen dari Data Terhapus (Super Admin saja)
export const DELETE = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  if (!user.role.isSuperAdmin) fail(403, 'Hapus permanen hanya untuk Super Admin.')
  const id = int((await ctx.params).id) ?? fail(404, 'Data terhapus tidak ditemukan.')
  const [res] = await db.query<ResultSetHeader>('DELETE FROM deleted_records WHERE id = ? AND restored_at IS NULL', [id])
  if (!res.affectedRows) fail(404, 'Data terhapus tidak ditemukan atau sudah dipulihkan.')
  await logActivity(request, user, { module: 'Data Terhapus', action: 'delete', entity: { type: 'deleted_record', id }, description: `Menghapus permanen data terhapus #${id}` })
  return NextResponse.json({ ok: true })
})
