import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { canScoreKpi, computeEmployeeKpi, KPI_INDIKATOR, readPeriode, requireEmployeeKpi, saveEmployeeKpi } from '@/lib/employee-kpi'

// KPI & performa karyawan: ?periode=YYYY-MM
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireEmployeeKpi(user)
  const data = await computeEmployeeKpi(readPeriode(new URL(request.url).searchParams.get('periode')))
  return NextResponse.json({ ...data, indikator: KPI_INDIKATOR, can: { score: canScoreKpi(user) } })
})

// Penilaian atasan: { periode, nip, nilai: { produktivitas, kualitas, sikap }, catatan, tindak_lanjut }
export const PUT = handle(async (request: Request) => {
  const user = await requireUser()
  requireEmployeeKpi(user)
  if (!canScoreKpi(user)) fail(403, 'Penilaian KPI oleh HRD, GM, atau kepala Produksi / PPIC.')
  const body = await readJson(request)
  await saveEmployeeKpi(readPeriode(body.periode), body, user.id)
  return NextResponse.json({ ok: true })
})
