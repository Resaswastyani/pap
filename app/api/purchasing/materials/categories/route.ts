import { NextResponse } from 'next/server'
import { handle, requireUser } from '@/lib/api'
import { itemCategories } from '@/lib/materials'
import { requirePurchasingMenu } from '@/lib/purchasing'

// Kategori barang Accurate untuk form Data Bahan
export const GET = handle(async () => {
  const user = await requireUser()
  requirePurchasingMenu(user, 'harga-bahan')
  return NextResponse.json({ categories: await itemCategories() })
})
