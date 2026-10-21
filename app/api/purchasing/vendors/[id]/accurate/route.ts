import { NextResponse } from 'next/server'
import { fail, handle, int, requireUser } from '@/lib/api'
import { requirePurchasingCan, vendorForEdit } from '@/lib/purchasing-write'

type Ctx = { params: Promise<{ id: string }> }

// Data pemasok terbaru dari Accurate untuk form ubah (alamat, kota, NPWP, kategori)
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requirePurchasingCan(user, 'supplier', 'mengubah data supplier')
  return NextResponse.json({ item: await vendorForEdit(int((await ctx.params).id) ?? fail(404, 'Supplier tidak ditemukan.')) })
})
