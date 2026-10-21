import { NextResponse } from 'next/server'
import { handle, requireUser, str } from '@/lib/api'
import { requirePurchasingMenu } from '@/lib/purchasing'
import { searchItems } from '@/lib/purchasing-write'

// Cari barang Accurate untuk baris PO: ?q= (nama, kode, kategori) + harga beli terakhir & harga acuan
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requirePurchasingMenu(user, 'po-pembelian', 'harga-bahan')
  return NextResponse.json({ items: await searchItems(str(new URL(request.url).searchParams.get('q'), 100)) })
})
