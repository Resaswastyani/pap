import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { requireMenu } from '@/lib/customers'
import { canViewProduction } from '@/lib/production'
import { canPlanProduction, loadOpenJob, readPlanRows, saveJobPlan } from '@/lib/production-forward-plan'

type Ctx = { params: Promise<{ id: string }> }

// Simpan jadwal produksi satu pesanan: [{ tanggal, shift, quantity, catatan }] (kosong = hapus jadwal)
export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireMenu(user, canViewProduction(user))
  if (!canPlanProduction(user)) fail(403, 'Rencana produksi diatur PPIC / Kepala Produksi.')
  const id = int((await ctx.params).id) ?? fail(404, 'Pesanan produksi tidak ditemukan.')
  const job = await loadOpenJob(id)
  const rows = readPlanRows(await readJson(request))
  await saveJobPlan(id, rows, user.id)
  const unit = job.unit ? ` ${job.unit}` : ''
  const ringkas = rows.map((r) => `${r.tanggal} Shift ${r.shift} ${r.quantity.toLocaleString('id-ID')}${unit}`).join(', ')
  await logActivity(request, user, {
    module: 'Rencana Produksi', action: 'update', entity: null,
    description: `Jadwal produksi ${job.so_number ?? ''} · ${job.item_name}: ${ringkas || 'dikosongkan'}`,
  })
  return NextResponse.json({ ok: true })
})
