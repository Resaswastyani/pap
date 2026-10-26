import { NextResponse } from 'next/server'
import { handle, readJson, requireUser, str } from '@/lib/api'
import { createOrderDocument, listOrderDocuments, readDocInput } from '@/lib/order-documents'
import { requireDokumenOrder } from '@/lib/so-document'

// Dokumen Order tersimpan: daftar (?q=, ?jenis=order|proforma) dan buat baru
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireDokumenOrder(user)
  const p = new URL(request.url).searchParams
  return NextResponse.json({ items: await listOrderDocuments(str(p.get('q'), 100), p.get('jenis') ?? '') })
})

export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireDokumenOrder(user)
  const id = await createOrderDocument(user, readDocInput(await readJson(request)))
  return NextResponse.json({ id }, { status: 201 })
})
