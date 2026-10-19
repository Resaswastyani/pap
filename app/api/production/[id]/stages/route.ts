import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageProduction, loadJob, loadStages, parseLocalDateTime, refreshJobStatus } from '@/lib/production'

type Ctx = { params: Promise<{ id: string }> }

// Atur seluruh tahap job (PPIC): { stages: [{ id?, tahap, machine_id, plan_start, plan_end, pic_user_id, catatan }] }
// Tahap yang tidak dikirim dihapus; urutan mengikuti urutan array.
export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  if (!canManageProduction(user)) fail(403, 'Hanya Kepala PPIC atau General Manager yang dapat mengatur jadwal produksi.')
  const job = await loadJob(int((await ctx.params).id) ?? fail(404, 'Job produksi tidak ditemukan.'))
  const body = await readJson(request)
  const input = Array.isArray(body.stages) ? (body.stages as Record<string, unknown>[]) : []
  if (!input.length) fail(400, 'Minimal satu tahap produksi.')
  if (input.length > 10) fail(400, 'Maksimal 10 tahap.')

  const [machines] = await db.query<(RowDataPacket & { id: number })[]>('SELECT id FROM machines')
  const machineIds = new Set(machines.map((m) => m.id))
  const stages = input.map((s, index) => {
    const tahap = str(s.tahap, 40)
    if (!tahap) fail(400, `Nama tahap ke-${index + 1} wajib diisi.`)
    const machineId = s.machine_id ? int(s.machine_id) : null
    if (machineId && !machineIds.has(machineId)) fail(400, `Mesin tahap ${tahap} tidak valid.`)
    const start = parseLocalDateTime(s.plan_start)
    const end = parseLocalDateTime(s.plan_end)
    if (start === undefined || end === undefined) fail(400, `Format jadwal tahap ${tahap} tidak valid.`)
    if (start && end && end < start) fail(400, `Jadwal selesai tahap ${tahap} tidak boleh sebelum jadwal mulai.`)
    return { id: s.id ? int(s.id) : null, urutan: index + 1, tahap, machineId, start, end, pic: s.pic_user_id ? int(s.pic_user_id) : null, catatan: str(s.catatan, 1000) || null }
  })

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    const keep = stages.map((s) => s.id).filter(Boolean)
    await conn.query(
      `DELETE FROM note_attachments WHERE owner_type = 'stage' AND owner_id IN (SELECT id FROM production_stages WHERE job_id = ?${keep.length ? ' AND id NOT IN (?)' : ''})`,
      keep.length ? [job.id, keep] : [job.id],
    )
    await conn.query(`DELETE FROM production_stages WHERE job_id = ?${keep.length ? ' AND id NOT IN (?)' : ''}`, keep.length ? [job.id, keep] : [job.id])
    for (const s of stages) {
      if (s.id) {
        await conn.query(
          'UPDATE production_stages SET urutan = ?, tahap = ?, machine_id = ?, plan_start = ?, plan_end = ?, pic_user_id = ?, catatan = ?, updated_by = ? WHERE id = ? AND job_id = ?',
          [s.urutan, s.tahap, s.machineId, s.start, s.end, s.pic, s.catatan, user.id, s.id, job.id],
        )
      } else {
        await conn.query(
          'INSERT INTO production_stages (job_id, urutan, tahap, machine_id, plan_start, plan_end, pic_user_id, catatan, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [job.id, s.urutan, s.tahap, s.machineId, s.start, s.end, s.pic, s.catatan, user.id],
        )
      }
    }
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
  await refreshJobStatus(job.id)
  return NextResponse.json({ item: await loadJob(job.id), stages: await loadStages(job.id) })
})
