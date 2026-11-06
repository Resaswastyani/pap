import { fail, handle, requireUser } from '@/lib/api'
import { isShiftPeriode, requireShift, shiftExport } from '@/lib/shift-schedule'

// Unduh jadwal shift yang sudah dibuat (?periode=YYYY-MM) sebagai Excel
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireShift(user)
  const periode = new URL(request.url).searchParams.get('periode')
  if (!isShiftPeriode(periode)) fail(400, 'Bulan tidak valid.')
  const { filename, buffer } = await shiftExport(periode!)
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
})
