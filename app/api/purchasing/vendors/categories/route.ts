import { NextResponse } from 'next/server'
import { handle, requireUser } from '@/lib/api'
import { requirePurchasingCan, vendorCategories } from '@/lib/purchasing-write'

// Kategori pemasok Accurate (pilihan form tambah / ubah supplier)
export const GET = handle(async () => {
  const user = await requireUser()
  requirePurchasingCan(user, 'supplier', 'mengelola supplier')
  return NextResponse.json({ categories: await vendorCategories() })
})
