import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { handle, requireUser } from '@/lib/api'
import { db } from '@/lib/db'

// Daftar divisi untuk dropdown (semua user yang login)
export const GET = handle(async () => {
  await requireUser()
  const [rows] = await db.query<RowDataPacket[]>('SELECT id, code, name, has_levels FROM divisions ORDER BY sort_order, name')
  return NextResponse.json({ items: rows.map((row) => ({ ...row, has_levels: !!row.has_levels })) })
})
