import { NextResponse } from 'next/server'
import { handle, requireUser, str } from '@/lib/api'
import { listSalesOrders, requireDokumenOrder } from '@/lib/so-document'

// Dokumen Order: daftar SO Accurate per bulan (?periode=YYYY-MM) atau pencarian (?q=), ?status=terbuka|selesai|semua
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireDokumenOrder(user)
  const p = new URL(request.url).searchParams
  const periode = /^\d{4}-\d{2}$/.test(p.get('periode') ?? '') ? String(p.get('periode')) : new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7)
  return NextResponse.json({ items: await listSalesOrders(periode, str(p.get('q'), 100), p.get('status') ?? 'semua'), periode })
})
