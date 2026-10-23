import { NextResponse } from 'next/server'
import { fail, handle, requireUser } from '@/lib/api'
import { isPeriode, monthlyOrders, monthlyOrdersXlsx } from '@/lib/monthly-orders'

// Order customer per bulan dari Sales Order Accurate: ?periode=YYYY-MM (&format=xlsx untuk unduh Excel)
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  if (!user.menus.includes('order-bulanan' as never)) fail(403, 'Anda tidak punya akses ke menu Order Bulanan.')
  const p = new URL(request.url).searchParams
  const periode = isPeriode(p.get('periode')) ? p.get('periode')! : new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7)
  if (p.get('format') === 'xlsx') {
    const { filename, buffer } = await monthlyOrdersXlsx(periode)
    return new Response(new Uint8Array(buffer), {
      headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' },
    })
  }
  return NextResponse.json(await monthlyOrders(periode))
})
