import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageMaster } from '@/lib/master'

type Ctx = { params: Promise<{ fileId: string }> }

// Admin menghubungkan desain ke customer secara manual (null = kembalikan ke pencocokan otomatis)
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  if (!canManageMaster(user)) fail(403, 'Hanya Admin / Super Admin yang dapat mengubah master data.')
  const fileId = str((await ctx.params).fileId, 100)
  const body = await readJson(request)
  const customerId = int(body.customer_id)
  if (customerId) {
    const [[c]] = await db.query<(RowDataPacket & { id: number })[]>('SELECT id FROM customers WHERE id = ?', [customerId])
    if (!c) fail(400, 'Customer tidak ditemukan.')
  }
  // Satu folder brand = satu customer: semua file di folder yang sama ikut dihubungkan
  const [[file]] = await db.query<(RowDataPacket & { folder_id: string })[]>('SELECT folder_id FROM drive_files WHERE id = ?', [fileId])
  if (!file) fail(404, 'File desain tidak ditemukan.')
  await db.query('UPDATE drive_files SET customer_id = ?, customer_manual = ? WHERE folder_id = ?', [customerId, customerId ? 1 : 0, file.folder_id])
  return NextResponse.json({ ok: true })
})
