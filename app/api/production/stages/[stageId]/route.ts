import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canProgressProduction, refreshJobStatus, STAGE_STATUS } from '@/lib/production'

type Ctx = { params: Promise<{ stageId: string }> }

// Update progress tahap (Produksi & PPIC): { status?, progress?, catatan? }
// Waktu mulai/selesai aktual dicatat otomatis saat status berubah.
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  if (!canProgressProduction(user)) fail(403, 'Anda tidak punya akses untuk update progress produksi.')
  const id = int((await ctx.params).stageId) ?? fail(404, 'Tahap tidak ditemukan.')
  const [[stage]] = await db.query<(RowDataPacket & { id: number; job_id: number; status: string; progress: number })[]>(
    'SELECT id, job_id, status, progress FROM production_stages WHERE id = ?',
    [id],
  )
  if (!stage) fail(404, 'Tahap tidak ditemukan.')
  const body = await readJson(request)
  let status = typeof body.status === 'string' && body.status in STAGE_STATUS ? body.status : stage.status
  let progress = 'progress' in body ? Number(body.progress) : stage.progress
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) fail(400, 'Progress harus 0–100.')
  // Status & progress saling menyesuaikan
  if (status === 'selesai') progress = 100
  else if ('progress' in body && progress >= 100) status = 'selesai'
  else if ('progress' in body && progress > 0 && status === 'belum') status = 'berjalan'

  await db.query(
    `UPDATE production_stages SET status = ?, progress = ?, catatan = COALESCE(?, catatan), updated_by = ?,
       actual_start = IF(? IN ('berjalan', 'selesai') AND actual_start IS NULL, NOW(), actual_start),
       actual_end = IF(? = 'selesai', COALESCE(actual_end, NOW()), NULL)
     WHERE id = ?`,
    [status, progress, 'catatan' in body ? str(body.catatan, 1000) : null, user.id, status, status, id],
  )
  const jobStatus = await refreshJobStatus(stage.job_id)
  return NextResponse.json({ ok: true, jobStatus })
})
