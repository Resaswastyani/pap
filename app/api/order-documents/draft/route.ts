import { NextResponse } from 'next/server'
import { handle, int, requireUser } from '@/lib/api'
import { draftOrderDocument } from '@/lib/order-documents'
import { readSoJenis, requireDokumenOrder } from '@/lib/so-document'

// Isian awal form dokumen: dari SO Accurate (?so=ID) atau kosong, ?jenis=order|proforma
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireDokumenOrder(user)
  const p = new URL(request.url).searchParams
  return NextResponse.json({ item: await draftOrderDocument(readSoJenis(p.get('jenis')), int(p.get('so'))) })
})
