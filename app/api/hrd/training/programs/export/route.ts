import { handle, requireUser } from '@/lib/api'
import { requireTraining } from '@/lib/training'
import { programsXlsx } from '@/lib/training-programs'

// Unduh Excel program training tahunan: ?tahun=2026
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireTraining(user)
  const q = Number(new URL(request.url).searchParams.get('tahun'))
  const tahun = Number.isInteger(q) && q >= 2020 && q <= 2100 ? q : new Date(Date.now() + 7 * 3600e3).getUTCFullYear()
  const buffer = await programsXlsx(tahun)
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="Program Training ${tahun}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  })
})
