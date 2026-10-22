import { NextResponse } from 'next/server'
import { fail, handle, int, requireUser } from '@/lib/api'
import { invoiceDraftFromSo, requireFaktur } from '@/lib/sales-invoices'

// Isi awal faktur dari pesanan (SO) Accurate: ?so=<id>
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireFaktur(user)
  const so = int(new URL(request.url).searchParams.get('so')) ?? fail(400, 'Pilih pesanan (SO).')
  return NextResponse.json({ draft: await invoiceDraftFromSo(so) })
})
