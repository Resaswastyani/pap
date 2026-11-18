import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { pushKpis, requireActionPlan, requireManageAP } from '@/lib/action-plan'
import { db } from '@/lib/db'

type Row = RowDataPacket & Record<string, unknown>
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

// Ubah KPI (Admin): target, frekuensi, PIC, catatan; realisasi & status hanya untuk KPI yang tidak dihitung otomatis
export const PATCH = handle(async (request: Request) => {
  const user = await requireUser()
  requireActionPlan(user)
  requireManageAP(user)
  const body = await readJson(request)
  const id = int(body.id) ?? fail(400, 'KPI tidak valid.')
  const [[kpi]] = await db.query<Row[]>('SELECT id, auto_key FROM action_kpis WHERE id = ?', [id])
  if (!kpi) fail(404, 'KPI tidak ditemukan.')
  const fields: Record<string, unknown> = {
    definisi: text(body.definisi, 500) || null, target: text(body.target, 60) || null, frekuensi: text(body.frekuensi, 30) || null,
    pic_text: text(body.pic_text, 120) || null, catatan: text(body.catatan, 500) || null, updated_by: user.id,
  }
  if (!kpi.auto_key) Object.assign(fields, { realisasi: text(body.realisasi, 60) || null, status: text(body.status, 30) || null })
  await db.query('UPDATE action_kpis SET ? WHERE id = ?', [fields, id])
  return NextResponse.json({ ok: true, warning: await pushKpis() })
})
