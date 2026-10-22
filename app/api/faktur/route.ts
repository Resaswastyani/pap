import { NextResponse } from 'next/server'
import { handle, readJson, requireUser, str } from '@/lib/api'
import { todayWib } from '@/lib/purchasing'
import { createInvoice, fakturCan, listInvoices, readInvoiceInput, readyOrders, requireFaktur, requireFakturCan } from '@/lib/sales-invoices'

// ?tab=siap (&semua=1: termasuk yang produksinya belum selesai) | tab=faktur (&periode=YYYY-MM &status=belum_lunas) &q=
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireFaktur(user)
  const p = new URL(request.url).searchParams
  const can = fakturCan(user)
  if (p.get('tab') === 'faktur') {
    const periode = /^\d{4}-\d{2}$/.test(p.get('periode') ?? '') ? p.get('periode')! : todayWib().slice(0, 7)
    return NextResponse.json({ periode, items: await listInvoices(periode, str(p.get('q'), 100), p.get('status') ?? ''), can })
  }
  const ready = await readyOrders(120, p.get('semua') !== '1')
  const q = str(p.get('q'), 100).toLowerCase()
  const items = q ? ready.items.filter((o) => `${o.so_number} ${o.customer_name ?? ''} ${o.lines.map((l) => l.item_name).join(' ')}`.toLowerCase().includes(q)) : ready.items
  return NextResponse.json({ items, total: ready.total, can })
})

// Buat faktur penjualan di Accurate
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireFaktur(user)
  requireFakturCan(user, 'create', 'membuat faktur')
  return NextResponse.json(await createInvoice(readInvoiceInput(await readJson(request)), user.id))
})
