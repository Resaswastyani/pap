import { NextResponse } from 'next/server'
import { handle, readJson, requireUser, str } from '@/lib/api'
import { requirePurchasingMenu } from '@/lib/purchasing'
import { purchasingCan, requirePurchasingCan } from '@/lib/purchasing-write'
import { listVendorPrices, readVendorPriceInput, saveVendorPrice } from '@/lib/vendor-prices'

// Daftar Harga Pemasok dari Accurate: ?page=&q=
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requirePurchasingMenu(user, 'harga-bahan')
  const params = new URL(request.url).searchParams
  const list = await listVendorPrices(Math.max(1, Number(params.get('page')) || 1), str(params.get('q'), 100))
  const can = purchasingCan(user)
  return NextResponse.json({ ...list, can: { create: can.priceCreate, update: can.price, delete: can.priceDelete } })
})

// Tambah dokumen Harga Pemasok di Accurate
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requirePurchasingCan(user, 'priceCreate', 'menambah harga pemasok')
  return NextResponse.json(await saveVendorPrice(readVendorPriceInput(await readJson(request))))
})
