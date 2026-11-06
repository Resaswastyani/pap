import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser, str } from '@/lib/api'
import { canManageAccounting, closePeriod, closingsOf, isPeriode, reopenPeriod, requireAccounting, todayWib, yearRange } from '@/lib/accounting'
import { logActivity } from '@/lib/activity'
import { isManagement } from '@/lib/users'

export const maxDuration = 60

// Tutup buku per bulan (?tahun=YYYY): status 12 bulan tahun itu
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireAccounting(user, 'laporan-keuangan')
  const { tahun } = yearRange(new URL(request.url).searchParams.get('tahun'))
  const closings = await closingsOf(tahun)
  const today = todayWib()
  const bulan = Array.from({ length: 12 }, (_, i) => `${tahun}-${String(i + 1).padStart(2, '0')}`).map((periode) => {
    const c = closings.find((x) => x.periode === periode)
    return { periode, status: c ? 'ditutup' : periode >= today.slice(0, 7) ? 'berjalan' : 'terbuka', ...(c ? { ringkasan: c.ringkasan, catatan: c.catatan, closed_at: c.closed_at, closed_name: c.closed_name } : {}) }
  })
  return NextResponse.json({ tahun, bulan, can: { close: canManageAccounting(user), reopen: isManagement(user) } })
})

// Tutup buku: { periode, catatan } — angka Accurate bulan itu diambil ulang lalu dibekukan
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireAccounting(user, 'laporan-keuangan')
  if (!canManageAccounting(user)) fail(403, 'Tutup buku dilakukan oleh divisi Accounting.')
  const body = await readJson(request)
  const periode = str(body.periode, 7)
  if (!isPeriode(periode)) fail(400, 'Periode tidak valid.')
  const ringkasan = await closePeriod(periode, user.id, str(body.catatan, 500) || null)
  await logActivity(request, user, { module: 'Laporan Keuangan', action: 'update', entity: null, description: `Tutup buku periode ${periode}` })
  return NextResponse.json({ ok: true, ringkasan })
})

// Buka kembali periode (management): ?periode=YYYY-MM
export const DELETE = handle(async (request: Request) => {
  const user = await requireUser()
  requireAccounting(user, 'laporan-keuangan')
  if (!isManagement(user)) fail(403, 'Membuka kembali periode yang sudah tutup buku hanya oleh management.')
  const periode = new URL(request.url).searchParams.get('periode')
  if (!isPeriode(periode)) fail(400, 'Periode tidak valid.')
  await reopenPeriod(periode!)
  await logActivity(request, user, { module: 'Laporan Keuangan', action: 'update', entity: null, description: `Buka kembali periode ${periode} (batal tutup buku)` })
  return NextResponse.json({ ok: true })
})
