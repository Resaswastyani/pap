import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import {
  AP_DIVISI, AP_JENIS, AP_PRIORITY, AP_SEVERITY, AP_STATUS, ISSUE_STATUS, PIC_STATUS, apScope, apSummary, attachPeople, canManageAP, canViewAllAP, computeKpis, nextKode,
  notifyPeople, PROGRAM_SELECT, requireActionPlan, pushPrograms, readProgramInput, requireManageAP, savePeople, serializeProgram, sheetUrl, syncedAt,
} from '@/lib/action-plan'
import { db } from '@/lib/db'

type Row = RowDataPacket & Record<string, unknown>

// Daftar program yang boleh dilihat + ringkasan, KPI, dan data pendukung form
export const GET = handle(async () => {
  const user = await requireUser()
  requireActionPlan(user)
  const scope = apScope(user)
  const [rows] = await db.query<Row[]>(`${PROGRAM_SELECT} WHERE ${scope.sql} ORDER BY (p.status = 'Cancelled'), p.kode`, scope.params)
  const programs = await attachPeople(rows.map((r) => serializeProgram(r) as unknown as Row & { id: number }))
  const manage = canManageAP(user)
  const [users] = manage
    ? await db.query<Row[]>("SELECT u.id, u.name, u.division_id, COALESCE(d.name, '-') AS division_name FROM users u LEFT JOIN divisions d ON d.id = u.division_id WHERE u.is_active = 1 ORDER BY d.name, u.name")
    : [[] as Row[]]
  return NextResponse.json({
    programs,
    summary: await apSummary(user),
    kpis: await computeKpis(),
    users,
    sheet: manage ? { url: await sheetUrl(), syncedAt: await syncedAt() } : null,
    options: { status: AP_STATUS, picStatus: PIC_STATUS, priority: AP_PRIORITY, jenis: AP_JENIS, divisi: AP_DIVISI, severity: AP_SEVERITY, issueStatus: ISSUE_STATUS },
    can: { manage, viewAll: canViewAllAP(user) },
  })
})

// Tambah program (Admin / Super Admin)
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireActionPlan(user)
  requireManageAP(user)
  const body = await readJson(request)
  const input = readProgramInput(body)
  if (input.status === 'Cancelled') fail(400, 'Program baru tidak bisa langsung berstatus Cancelled.')
  const kode = await nextKode()
  const progress = input.progress ?? (input.status === 'Done' ? 100 : 0)
  const [res] = await db.query<ResultSetHeader>('INSERT INTO action_programs SET ?', [{ ...input, progress, kode, created_by: user.id, updated_by: user.id }])
  const added = await savePeople(res.insertId, body.pic, body.support)
  await notifyPeople(added, user.id, { id: res.insertId, kode, nama: input.nama }, `Anda menjadi PIC / support Action Plan ${kode}`)
  const warning = await pushPrograms([res.insertId])
  return NextResponse.json({ id: res.insertId, kode, warning }, { status: 201 })
})
