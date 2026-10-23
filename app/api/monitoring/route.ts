import { NextResponse } from 'next/server'
import { handle, requireUser } from '@/lib/api'
import { readPeriode } from '@/lib/employee-kpi'
import { companyPerformance, divisionPerformance, financeSnapshot, kpiOverview, planMonitoring, requireMonitoring, section } from '@/lib/monitoring'

export const maxDuration = 60

// Monitoring Top Management: ?periode=YYYY-MM. Tiap bagian dimuat terpisah; yang gagal membawa pesan error sendiri.
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireMonitoring(user)
  const periode = readPeriode(new URL(request.url).searchParams.get('periode'))
  const [perusahaan, keuangan, divisi, planning, kpi] = await Promise.all([
    section(() => companyPerformance(periode)),
    section(() => financeSnapshot(periode)),
    section(() => divisionPerformance(periode)),
    section(() => planMonitoring()),
    section(() => kpiOverview(periode)),
  ])
  return NextResponse.json({ periode, perusahaan, keuangan, divisi, planning, kpi })
})
