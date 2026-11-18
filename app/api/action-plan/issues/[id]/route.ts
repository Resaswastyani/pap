import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { pushIssue, readIssueInput, removeIssueFromSheet, requireActionPlan, requireManageAP } from '@/lib/action-plan'
import { db } from '@/lib/db'
import { softDelete } from '@/lib/recycle-bin'

type Ctx = { params: Promise<{ id: string }> }
type Row = RowDataPacket & Record<string, unknown>

async function load(ctx: Ctx) {
  const id = int((await ctx.params).id) ?? fail(404, 'Issue tidak ditemukan.')
  const [[row]] = await db.query<Row[]>('SELECT * FROM action_issues WHERE id = ?', [id])
  return row ?? fail(404, 'Issue tidak ditemukan.')
}

export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireActionPlan(user)
  requireManageAP(user)
  const old = await load(ctx)
  const input = await readIssueInput(await readJson(request))
  await db.query('UPDATE action_issues SET ? WHERE id = ?', [{ ...input, updated_by: user.id }, old.id])
  const warning = await pushIssue(Number(old.id), { tanggal: old.tanggal, kode: old.program_kode, issue: old.issue })
  return NextResponse.json({ ok: true, warning })
})

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireActionPlan(user)
  requireManageAP(user)
  const old = await load(ctx)
  await softDelete({ table: 'action_issues', id: Number(old.id), modul: 'Action Plan', label: `Issue ${old.program_kode ?? ''} · ${String(old.issue).slice(0, 80)}`, user })
  const warning = await removeIssueFromSheet(old)
  return NextResponse.json({ ok: true, warning })
})
