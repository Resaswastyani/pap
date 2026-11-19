import { NextResponse } from 'next/server'
import { handle, requireUser, str } from '@/lib/api'
import { requireMenu } from '@/lib/customers'
import { canViewProduction } from '@/lib/production'
import { searchPlanProducts } from '@/lib/production-forward-plan'

// Cari produk Accurate (barang "Diproduksi") untuk form rencana produksi: ?q=
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireMenu(user, canViewProduction(user))
  const q = str(new URL(request.url).searchParams.get('q'), 100)
  return NextResponse.json({ items: await searchPlanProducts(q) })
})
