import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageProduction, loadJob, loadStages, parseLocalDateTime, refreshJobStatus } from '@/lib/production'
import { refreshStageProgress } from '@/lib/production-results'

type Ctx = { params: Promise<{ id: string }> }

// Atur seluruh tahap job (PPIC): { stages: [{ id?, tahap, machine_id, plan_start, plan_end, pic_user_id, catatan, target_qty, target_unit }] }
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
    // Target tahap (mis. Blow dalam kg); kosong = target SPK
    const target = s.target_qty === null || s.target_qty === undefined || s.target_qty === '' ? null : Number(String(s.target_qty).replace(',', '.'))
    if (target !== null && (!Number.isFinite(target) || target <= 0)) fail(400, `Target tahap ${tahap} tidak valid.`)
    return { id: s.id ? int(s.id) : null, urutan: index + 1, tahap, machineId, start, end, pic: s.pic_user_id ? int(s.pic_user_id) : null, catatan: str(s.catatan, 1000) || null, target, unit: target === null ? null : str(s.target_unit, 40) || null }
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
          'UPDATE production_stages SET urutan = ?, tahap = ?, machine_id = ?, plan_start = ?, plan_end = ?, pic_user_id = ?, catatan = ?, target_qty = ?, target_unit = ?, updated_by = ? WHERE id = ? AND job_id = ?',
          [s.urutan, s.tahap, s.machineId, s.start, s.end, s.pic, s.catatan, s.target, s.unit, user.id, s.id, job.id],
        )
      } else {
        await conn.query(
          'INSERT INTO production_stages (job_id, urutan, tahap, machine_id, plan_start, plan_end, pic_user_id, catatan, target_qty, target_unit, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [job.id, s.urutan, s.tahap, s.machineId, s.start, s.end, s.pic, s.catatan, s.target, s.unit, user.id],
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
  // Target tahap bisa berubah: progress tahap yang sudah punya laporan hasil dihitung ulang
  const [withResults] = await db.query<(RowDataPacket & { id: number })[]>('SELECT DISTINCT stage_id AS id FROM production_results WHERE job_id = ?', [job.id])
  for (const stage of withResults) await refreshStageProgress(stage.id)
  await refreshJobStatus(job.id)
  return NextResponse.json({ item: await loadJob(job.id), stages: await loadStages(job.id) })
})
