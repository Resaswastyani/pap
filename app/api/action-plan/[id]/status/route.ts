import type { ResultSetHeader } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { loadProgram, notifyPeople, pushProgress, requireManageAP , requireActionPlan } from '@/lib/action-plan'
import { db } from '@/lib/db'

type Ctx = { params: Promise<{ id: string }> }

// Batalkan / aktifkan kembali program (Admin / Super Admin). Program batal tetap tercatat beserta alasannya,
// dan diaktifkan kembali ke status sebelum dibatalkan. Keduanya masuk riwayat Progress Report.
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireActionPlan(user)
  requireManageAP(user)
  const program = await loadProgram(int((await ctx.params).id) ?? fail(404, 'Program tidak ditemukan.'), user)
  const body = await readJson(request)
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
  let task: string
  let jenis: 'batal' | 'aktif'
  let status: string
  if (body.action === 'cancel') {
    if (program.status === 'Cancelled') fail(400, 'Program sudah dibatalkan.')
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : ''
    if (!reason) fail(400, 'Tulis alasan pembatalan.')
    status = 'Cancelled'
    await db.query('UPDATE action_programs SET prev_status = status, status = ?, cancel_reason = ?, cancelled_at = NOW(), cancelled_by = ?, updated_by = ? WHERE id = ?', [status, reason, user.id, user.id, program.id])
    task = `Program dibatalkan: ${reason}`
    jenis = 'batal'
  } else if (body.action === 'reactivate') {
    if (program.status !== 'Cancelled') fail(400, 'Program tidak sedang dibatalkan.')
    status = program.prev_status && program.prev_status !== 'Cancelled' ? String(program.prev_status) : Number(program.progress) > 0 ? 'On Progress' : 'Not Started'
    await db.query('UPDATE action_programs SET status = ?, prev_status = NULL, cancel_reason = NULL, cancelled_at = NULL, cancelled_by = NULL, updated_by = ? WHERE id = ?', [status, user.id, program.id])
    task = `Program diaktifkan kembali (status ${status})`
    jenis = 'aktif'
  } else fail(400, 'Aksi tidak dikenal.')
  const [res] = await db.query<ResultSetHeader>('INSERT INTO action_progress SET ?', [{
    program_id: program.id, program_kode: program.kode, tanggal: today, task: task!.slice(0, 500), divisi: program.divisi ?? null, pic_text: user.name, status: status!,
    progress_before: Number(program.progress), progress_after: Number(program.progress), jenis: jenis!, user_id: user.id,
  }])
  await notifyPeople(program.people.map((p) => p.user_id), user.id, { id: program.id, kode: String(program.kode), nama: String(program.nama) },
    jenis! === 'batal' ? `Action Plan ${program.kode} dibatalkan` : `Action Plan ${program.kode} diaktifkan kembali`, task!)
  const warning = await pushProgress(res.insertId, program.id)
  return NextResponse.json({ ok: true, status: status!, warning })
})
