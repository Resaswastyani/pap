import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageProduction, canProgressProduction, canQcProduction } from '@/lib/production'
import { QC_STATUS, readResultInput, refreshStageProgress, RESULT_SELECT, serializeResult } from '@/lib/production-results'
import type { UserProfile } from '@/lib/users'
import { softDelete } from '@/lib/recycle-bin'

type Ctx = { params: Promise<{ id: string }> }
type Row = RowDataPacket & { id: number; stage_id: number; status_qc: string; reported_by: number }

async function loadRow(ctx: Ctx) {
  const id = int((await ctx.params).id) ?? fail(404, 'Laporan tidak ditemukan.')
  const [[row]] = await db.query<Row[]>('SELECT id, stage_id, status_qc, reported_by FROM production_results WHERE id = ?', [id])
  return row ?? fail(404, 'Laporan tidak ditemukan.')
}
// Isi laporan bisa diubah pelapor selama belum diperiksa QC, atau PPIC / GM kapan saja
const canEdit = (user: UserProfile, row: Row) =>
  canManageProduction(user) || (canProgressProduction(user) && row.reported_by === user.id && row.status_qc === 'menunggu')

// { qc: { status_qc, catatan_qc } } = verifikasi QC; selain itu ubah isi laporan
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  const row = await loadRow(ctx)
  const body = await readJson(request)
  if (body.qc && typeof body.qc === 'object') {
    if (!canQcProduction(user)) fail(403, 'Verifikasi QC dilakukan Kepala Produksi / QC.')
    const qc = body.qc as Record<string, unknown>
    const status = typeof qc.status_qc === 'string' && qc.status_qc in QC_STATUS ? qc.status_qc : fail(400, 'Status QC tidak valid.')
    const catatan = str(qc.catatan_qc, 5000) || null
    if ((status === 'reject' || status === 'perbaikan') && !catatan) fail(400, 'Tuliskan catatan QC untuk hasil yang perlu perbaikan / reject.')
    await db.query(
      "UPDATE production_results SET status_qc = ?, catatan_qc = ?, qc_by = IF(? = 'menunggu', NULL, ?), qc_at = IF(? = 'menunggu', NULL, NOW()) WHERE id = ?",
      [status, catatan, status, user.id, status, row.id],
    )
  } else {
    if (!canEdit(user, row)) fail(403, 'Laporan yang sudah diperiksa QC hanya bisa diubah PPIC / GM.')
    const input = await readResultInput(body)
    await db.query(
      `UPDATE production_results SET job_id = ?, stage_id = ?, tanggal = ?, shift = ?, machine_id = ?, jumlah_hasil = ?, jumlah_reject = ?, satuan = ?,
         operator = ?, kendala = ?, catatan = ? WHERE id = ?`,
      [input.stage.job_id, input.stage.id, input.tanggal, input.shift, input.machineId, input.hasil, input.reject, input.satuan, input.operator, input.kendala, input.catatan, row.id],
    )
    // Pindah tahap: tahap lama juga dihitung ulang
    if (input.stage.id !== row.stage_id) await refreshStageProgress(row.stage_id)
  }
  const [[item]] = await db.query<RowDataPacket[]>(`${RESULT_SELECT} WHERE r.id = ?`, [row.id])
  await refreshStageProgress(item.stage_id)
  return NextResponse.json({ item: serializeResult(item) })
})

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  const row = await loadRow(ctx)
  if (!canEdit(user, row)) fail(403, 'Laporan yang sudah diperiksa QC hanya bisa dihapus PPIC / GM.')
  await softDelete({ table: 'production_results', id: row.id, modul: 'Hasil Produksi', label: `Laporan hasil produksi ${String(row.tanggal ?? '').slice(0, 10)} (${row.shift ?? '-'})`, user })
  await refreshStageProgress(row.stage_id)
  return NextResponse.json({ ok: true })
})
