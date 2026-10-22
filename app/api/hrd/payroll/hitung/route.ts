import { NextResponse } from 'next/server'
import { fail, handle, requireUser } from '@/lib/api'
import { canManageHr, canViewPayroll } from '@/lib/hrd'
import { hitungPeriode, loadSettings } from '@/lib/payroll'

// Hitung gaji per periode cut off: ?periode=YYYY-MM (periode yang berakhir di tanggal cut off bulan itu)
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  if (!canViewPayroll(user)) fail(403, 'Anda tidak punya akses ke menu Grade & Gaji.')
  let periode = new URL(request.url).searchParams.get('periode') ?? ''
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periode)) {
    // Bawaan: periode yang sedang berjalan (lewat tanggal cut off = periode bulan berikutnya)
    const { cutoff_tanggal } = await loadSettings()
    const now = new Date(Date.now() + 7 * 3600e3)
    const next = now.getUTCDate() > cutoff_tanggal ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) : now
    periode = next.toISOString().slice(0, 7)
  }
  const res = await hitungPeriode(periode)
  return NextResponse.json({ ...res, can: { manage: canManageHr(user) } })
})
