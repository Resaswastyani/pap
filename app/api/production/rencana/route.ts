import type { ResultSetHeader } from 'mysql2'
import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { requireMenu } from '@/lib/customers'
import { db } from '@/lib/db'
import { canViewProduction } from '@/lib/production'
import { canPlanProduction, entryColumns, entryLabel, loadForwardPlan, readEntry, refreshJobStatus, refreshSampleSchedule, todayWib } from '@/lib/production-forward-plan'

// Rencana Produksi ke depan: rencana mulai hari ini + pesanan yang perlu diproduksi
export const GET = handle(async () => {
  const user = await requireUser()
  requireMenu(user, canViewProduction(user))
  return NextResponse.json({ ...(await loadForwardPlan()), can: { plan: canPlanProduction(user) } })
})

// Tambah rencana (bisa beberapa shift sekaligus lewat rows)
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireMenu(user, canViewProduction(user))
  if (!canPlanProduction(user)) fail(403, 'Rencana produksi diatur PPIC / Kepala Produksi.')
  const entries = await readEntry(await readJson(request))
  if (entries[0].tanggal < todayWib()) fail(400, 'Tanggal rencana tidak boleh sebelum hari ini.')
  const ids: number[] = []
  for (const e of entries) {
    const [res] = await db.query<ResultSetHeader>('INSERT INTO production_plan_entries SET ?', [{ ...entryColumns(e), created_by: user.id, updated_by: user.id }])
    ids.push(res.insertId)
  }
  await refreshJobStatus([entries[0].job_id], user.id)
  await refreshSampleSchedule([entries[0].sample_id])
  await logActivity(request, user, {
    module: 'Rencana Produksi', action: 'create', entity: { type: 'production_plan_entry', id: ids[0], label: entries[0].item_name },
    description: `Rencana produksi baru: ${entries.map(entryLabel).join('; ')}`,
  })
  return NextResponse.json({ ok: true, ids })
})
