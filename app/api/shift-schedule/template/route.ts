import { handle, requireUser } from '@/lib/api'
import { requireShift, shiftTemplate } from '@/lib/shift-schedule'

// Unduh template Excel jadwal shift (?periode=YYYY-MM, default bulan depan)
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireShift(user)
  const { filename, buffer } = await shiftTemplate(new URL(request.url).searchParams.get('periode'))
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
})
