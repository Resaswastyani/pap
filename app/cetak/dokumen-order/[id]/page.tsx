import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ApiError } from '@/lib/api'
import { orderDocCustomAppendix } from '@/lib/order-custom-document'
import { loadOrderDocument, orderDocumentView } from '@/lib/order-documents'
import { orderDocumentHtml, requireDokumenOrder } from '@/lib/so-document'
import { getCurrentUser } from '@/lib/users'
import { PrintButton } from '../../quotation/[id]/print-button'

export const metadata: Metadata = { title: 'Dokumen Order · SIMPAP' }

// Cetak dokumen order tersimpan (Surat Order / Proforma Invoice yang sudah diedit di SIMPAP).
// Order polos: SO saja. Order custom: SO + Form Order Custom per produk + Gambar Desain (satu lembar per bagian).
export default async function CetakDokumenOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  const { id } = await params
  let sheets: string[]
  let hint = 'untuk mengirim ke customer'
  try {
    requireDokumenOrder(user)
    const doc = await loadOrderDocument(Number(id))
    sheets = [await orderDocumentHtml(orderDocumentView(doc), '/logo-pap.png')]
    if (doc.jenis_order === 'custom') {
      const a = await orderDocCustomAppendix(doc.id, '/logo-pap.png', true)
      sheets.push(...a.forms, ...(a.gambar ? [a.gambar] : []))
      hint = `· order custom: SO + ${a.count} form order${a.designs ? ` + gambar desain (${a.designs})` : ''}`
    }
  } catch (error) {
    if (error instanceof ApiError) return <main className="pap-print-error">{error.message}</main>
    throw error
  }
  return (
    <main className="pap-print pap-ta-sheets">
      <PrintButton wordUrl={`/api/order-documents/${id}/word`} hint={hint} />
      {/* Semua isi data sudah di-escape di template */}
      {sheets.map((html, i) => <div key={i} className="pap-ta-sheet-wrap" dangerouslySetInnerHTML={{ __html: html }} />)}
    </main>
  )
}
