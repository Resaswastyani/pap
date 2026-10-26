import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ApiError } from '@/lib/api'
import { loadOrderDocument, orderDocumentView } from '@/lib/order-documents'
import { orderDocumentHtml, requireDokumenOrder } from '@/lib/so-document'
import { getCurrentUser } from '@/lib/users'
import { PrintButton } from '../../quotation/[id]/print-button'

export const metadata: Metadata = { title: 'Dokumen Order · PAP-MS' }

// Cetak dokumen order tersimpan (Surat Order / Proforma Invoice yang sudah diedit di PAP-MS)
export default async function CetakDokumenOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  const { id } = await params
  let html: string
  try {
    requireDokumenOrder(user)
    html = await orderDocumentHtml(orderDocumentView(await loadOrderDocument(Number(id))), '/logo-pap.png')
  } catch (error) {
    if (error instanceof ApiError) return <main className="pap-print-error">{error.message}</main>
    throw error
  }
  return (
    <main className="pap-print">
      <PrintButton wordUrl={`/api/order-documents/${id}/word`} />
      {/* Semua isi data sudah di-escape di orderDocumentHtml */}
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </main>
  )
}
