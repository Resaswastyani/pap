import { NextResponse } from 'next/server'
import { handle, requireUser } from '@/lib/api'
import { requirePurchasingMenu } from '@/lib/purchasing'
import { poOptions } from '@/lib/purchasing-write'

// Pilihan form PO: pemasok, syarat pembayaran, FOB, pengiriman (dari Accurate), alamat kirim terakhir
export const GET = handle(async () => {
  const user = await requireUser()
  requirePurchasingMenu(user, 'po-pembelian')
  return NextResponse.json(await poOptions())
})
