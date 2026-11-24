import { NextResponse } from 'next/server'
import { handle, int, requireUser } from '@/lib/api'
import { draftFromQuotation, draftOrderDocument, quotationDocumentId, requireOrderDocAccess } from '@/lib/order-documents'
import { readSoJenis } from '@/lib/so-document'

// Isian awal form dokumen: dari SO Accurate (?so=ID), dari Quotation (?quotation=ID) atau kosong, ?jenis=order|proforma.
// ?quotation=ID&cek=1: hanya id dokumen yang sudah tersimpan untuk quotation itu ({ id: null } bila belum ada)
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  const p = new URL(request.url).searchParams
  const jenis = readSoJenis(p.get('jenis'))
  const quotationId = int(p.get('quotation'))
  await requireOrderDocAccess(user, quotationId)
  if (quotationId) {
    const item = await draftFromQuotation(jenis, quotationId, user)
    if (p.get('cek') === '1') return NextResponse.json({ id: await quotationDocumentId(quotationId, jenis, item.nomor) })
    return NextResponse.json({ item })
  }
  return NextResponse.json({ item: await draftOrderDocument(jenis, int(p.get('so'))) })
})
