import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { requireMenu } from '@/lib/customers'
import { db } from '@/lib/db'
import { canViewProduction } from '@/lib/production'
import { canPlanProduction, entryColumns, entryLabel, loadEntry, readEntry, refreshJobStatus, refreshSampleSchedule, todayWib } from '@/lib/production-forward-plan'
import { softDelete } from '@/lib/recycle-bin'
import type { UserProfile } from '@/lib/users'

type Ctx = { params: Promise<{ id: string }> }

async function guard(ctx: Ctx) {
  const user = await requireUser()
  requireMenu(user, canViewProduction(user))
  if (!canPlanProduction(user)) fail(403, 'Rencana produksi diatur PPIC / Kepala Produksi.')
  const id = int((await ctx.params).id) ?? fail(404, 'Rencana produksi tidak ditemukan.')
  return { user: user as UserProfile, old: await loadEntry(id) }
}

// Ubah satu rencana (tanggal, shift, produk/pesanan, jumlah, harga, catatan)
export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const { user, old } = await guard(ctx)
  const body = await readJson(request)
  const [e] = await readEntry({ ...body, rows: undefined })
  // Tanggal lama yang sudah lewat boleh tetap; tanggal baru tidak boleh sebelum hari ini
  if (e.tanggal < todayWib() && e.tanggal !== old.tanggal) fail(400, 'Tanggal rencana tidak boleh sebelum hari ini.')
  await db.query('UPDATE production_plan_entries SET ? WHERE id = ?', [{ ...entryColumns(e), updated_by: user.id }, old.id])
  await refreshJobStatus([old.job_id, e.job_id], user.id)
  await refreshSampleSchedule([old.sample_id, e.sample_id])
  await logActivity(request, user, {
    module: 'Rencana Produksi', action: 'update', entity: { type: 'production_plan_entry', id: old.id, label: e.item_name },
    description: `Mengubah rencana produksi: ${entryLabel(old)} → ${entryLabel(e)}`,
  })
  return NextResponse.json({ ok: true })
})

// Hapus (masuk Data Terhapus, bisa dipulihkan)
export const DELETE = handle(async (request: Request, ctx: Ctx) => {
  const { user, old } = await guard(ctx)
  await softDelete({ table: 'production_plan_entries', id: old.id, modul: 'Rencana Produksi', label: entryLabel(old), user })
  await refreshJobStatus([old.job_id], user.id)
  await refreshSampleSchedule([old.sample_id])
  await logActivity(request, user, {
    module: 'Rencana Produksi', action: 'delete', entity: { type: 'production_plan_entry', id: old.id, label: old.item_name },
    description: `Menghapus rencana produksi ${entryLabel(old)}`,
  })
  return NextResponse.json({ ok: true })
})
