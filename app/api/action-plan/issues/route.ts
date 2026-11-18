import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { handle, readJson, requireUser } from '@/lib/api'
import { apScope, canViewAllAP, pushIssue, readIssueInput, requireActionPlan, requireManageAP } from '@/lib/action-plan'
import { db } from '@/lib/db'

type Row = RowDataPacket & Record<string, unknown>

// Issue Log: issue dari program yang boleh dilihat (issue tanpa program hanya untuk Admin / GM)
export const GET = handle(async () => {
  const user = await requireUser()
  requireActionPlan(user)
  const scope = apScope(user)
  const [rows] = await db.query<Row[]>(
    `SELECT i.*, p.nama AS program_nama, uc.name AS created_name FROM action_issues i
     LEFT JOIN action_programs p ON p.id = i.program_id LEFT JOIN users uc ON uc.id = i.created_by
     WHERE ${canViewAllAP(user) ? '1 = 1' : `p.id IS NOT NULL AND ${scope.sql}`}
     ORDER BY FIELD(i.status, 'Done', 'Cancelled'), FIELD(i.severity, 'High', 'Medium', 'Low'), i.tanggal DESC, i.id DESC`,
    scope.params,
  )
  return NextResponse.json({ items: rows })
})

export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireActionPlan(user)
  requireManageAP(user)
  const input = await readIssueInput(await readJson(request))
  const [res] = await db.query<ResultSetHeader>('INSERT INTO action_issues SET ?', [{ ...input, created_by: user.id, updated_by: user.id }])
  const warning = await pushIssue(res.insertId, null)
  return NextResponse.json({ id: res.insertId, warning }, { status: 201 })
})
