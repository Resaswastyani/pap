import { fail, handle, requireUser } from '@/lib/api'
import { canManageHr, canViewPayroll } from '@/lib/hrd'
import { payrollXlsx } from '@/lib/payroll-report'

export const maxDuration = 60

// Unduh laporan gaji Excel: ?periode=YYYY-MM (periode cut off). Nomor rekening hanya untuk HRD / management.
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  if (!canViewPayroll(user)) fail(403, 'Anda tidak punya akses ke Grade & gaji (menu Karyawan).')
  const periode = new URL(request.url).searchParams.get('periode') ?? ''
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periode)) fail(400, 'Periode tidak valid.')
  const { filename, buffer } = await payrollXlsx(periode, canManageHr(user))
  return new Response(new Uint8Array(buffer), {
    headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' },
  })
})
