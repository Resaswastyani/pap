import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { handle, requireUser } from '@/lib/api'
import { db } from '@/lib/db'

// Daftar user aktif (nama & divisi) untuk memilih peserta meeting
export const GET = handle(async () => {
  await requireUser()
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT u.id, u.name, u.division_id, d.name AS division_name FROM users u
     JOIN divisions d ON d.id = u.division_id WHERE u.is_active = 1 ORDER BY d.sort_order, u.name`,
  )
  return NextResponse.json({ items: rows })
})
