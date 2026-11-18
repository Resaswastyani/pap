import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { handle, requireUser } from '@/lib/api'
import { apScope, canViewAllAP, requireActionPlan } from '@/lib/action-plan'
import { db } from '@/lib/db'

type Row = RowDataPacket & Record<string, unknown>

// Progress Report: riwayat update semua program yang boleh dilihat (terbaru dulu, maks 1000)
export const GET = handle(async () => {
  const user = await requireUser()
  requireActionPlan(user)
  const scope = apScope(user)
  const [rows] = await db.query<Row[]>(
    `SELECT g.*, p.nama AS program_nama, u.name AS user_name FROM action_progress g
     LEFT JOIN action_programs p ON p.id = g.program_id LEFT JOIN users u ON u.id = g.user_id
     WHERE ${canViewAllAP(user) ? '1 = 1' : `p.id IS NOT NULL AND ${scope.sql}`}
     ORDER BY g.tanggal DESC, g.id DESC LIMIT 1000`,
    scope.params,
  )
  return NextResponse.json({ items: rows })
})
