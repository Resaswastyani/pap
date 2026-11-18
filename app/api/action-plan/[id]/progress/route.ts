import type { ResultSetHeader } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { adminUserIds, canManageAP, isPersonOf, loadProgram, notifyPeople, parseApDate, parseProgress, PIC_STATUS, pushProgress , requireActionPlan } from '@/lib/action-plan'
import { db } from '@/lib/db'

type Ctx = { params: Promise<{ id: string }> }
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

// Update progress oleh PIC / support (atau admin): progress %, status, catatan task, kendala, next action, evidence.
// Status Done / progress 100% wajib menyertakan evidence (link bukti), sesuai standar template.
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireActionPlan(user)
  const program = await loadProgram(int((await ctx.params).id) ?? fail(404, 'Program tidak ditemukan.'), user)
  const peran = await isPersonOf(program.id, user.id)
  if (!canManageAP(user) && !peran) fail(403, 'Hanya PIC / support program ini yang dapat meng-update progress.')
  if (program.status === 'Cancelled') fail(400, 'Program sudah dibatalkan. Minta admin mengaktifkan kembali sebelum update progress.')
  const body = await readJson(request)
  const progress = parseProgress(body.progress)
  if (progress === null) fail(400, 'Isi progress (0–100%).')
  const task = text(body.task, 500)
  if (!task) fail(400, 'Tulis update / task yang dikerjakan.')
  let status = PIC_STATUS.find((s) => s === body.status) ?? null
  if (!status) status = progress === 100 ? 'Done' : progress! > 0 ? 'On Progress' : (program.status === 'Overdue' ? 'On Progress' : String(program.status)) as typeof PIC_STATUS[number]
  const evidence = text(body.evidence, 1000)
  if ((status === 'Done' || progress === 100) && !evidence) fail(400, 'Program selesai (Done / 100%) wajib menyertakan evidence: link bukti dokumen / foto / file.')
  if (status === 'Done' && progress! < 100) fail(400, 'Status Done berarti progress 100%.')
  const nextDeadline = body.next_deadline ? parseApDate(body.next_deadline) : null
  if (body.next_deadline && !nextDeadline) fail(400, 'Deadline next action tidak valid.')
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
  const [res] = await db.query<ResultSetHeader>('INSERT INTO action_progress SET ?', [{
    program_id: program.id, program_kode: program.kode, tanggal: today, task, divisi: program.divisi ?? null, pic_text: user.name, status,
    progress_before: Number(program.progress), progress_after: progress, kendala: text(body.kendala, 5000) || null, next_action: text(body.next_action, 5000) || null,
    next_deadline: nextDeadline, evidence: evidence || null, jenis: 'update', user_id: user.id,
  }])
  await db.query('UPDATE action_programs SET progress = ?, status = ?, updated_by = ? WHERE id = ?', [progress, status, user.id, program.id])
  // Admin & rekan PIC/support mendapat kabar
  const others = program.people.map((p) => p.user_id)
  await notifyPeople([...(await adminUserIds()), ...others], user.id, { id: program.id, kode: String(program.kode), nama: String(program.nama) },
    `Update Action Plan ${program.kode}: ${progress}% · ${status}`, `${user.name}: ${task}`)
  const warning = await pushProgress(res.insertId, program.id)
  return NextResponse.json({ ok: true, warning }, { status: 201 })
})
