import { fail, handle, requireUser } from '@/lib/api'
import { bpjsXlsx, requireBpjs } from '@/lib/bpjs-report'
import { canManageHr } from '@/lib/hrd'

export const maxDuration = 60

// Unduh Laporan BPJS Excel: ?periode=YYYY-MM. Nomor kepesertaan hanya untuk HRD / management.
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireBpjs(user)
  const periode = new URL(request.url).searchParams.get('periode') ?? ''
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periode)) fail(400, 'Periode tidak valid.')
  const { filename, buffer } = await bpjsXlsx(periode, canManageHr(user))
  return new Response(new Uint8Array(buffer), {
    headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' },
  })
})
