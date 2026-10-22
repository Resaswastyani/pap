import { NextResponse } from 'next/server'
import { handle, requireUser } from '@/lib/api'
import { invoiceOptions, requireFaktur } from '@/lib/sales-invoices'

// Pilihan form faktur: pelanggan & syarat pembayaran
export const GET = handle(async () => {
  const user = await requireUser()
  requireFaktur(user)
  return NextResponse.json(await invoiceOptions())
})
