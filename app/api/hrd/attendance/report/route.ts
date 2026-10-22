import { fail, handle, requireUser } from '@/lib/api'
import { attendanceXlsx, isDate } from '@/lib/attendance-report'

export const maxDuration = 60

// Unduh laporan absensi Excel: ?dari=YYYY-MM-DD&sampai=YYYY-MM-DD (maks 62 hari)
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  if (!user.menus.includes('absensi' as never)) fail(403, 'Anda tidak punya akses ke menu Absensi.')
  const p = new URL(request.url).searchParams
  const dari = p.get('dari')
  const sampai = p.get('sampai')
  if (!isDate(dari) || !isDate(sampai) || sampai < dari) fail(400, 'Rentang tanggal tidak valid.')
  if ((Date.parse(sampai!) - Date.parse(dari!)) / 86400e3 > 62) fail(400, 'Rentang tanggal maksimal 2 bulan.')
  const { filename, buffer } = await attendanceXlsx(dari!, sampai!)
  return new Response(new Uint8Array(buffer), {
    headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' },
  })
})
