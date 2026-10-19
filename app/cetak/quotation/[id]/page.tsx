import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ApiError } from '@/lib/api'
import { loadQuotationDocument, quotationDocumentHtml, readJenis } from '@/lib/quotation-document'
import { getCurrentUser } from '@/lib/users'
import { PrintButton } from './print-button'

export const metadata: Metadata = { title: 'Dokumen Order · PAP-MS' }

// Surat penawaran / surat order / proforma invoice siap cetak atau simpan PDF (Word: /api/quotations/[id]/word)
export default async function CetakQuotationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ jenis?: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  const { id } = await params
  const jenis = readJenis((await searchParams).jenis)
  let data
  try {
    data = await loadQuotationDocument(Number(id), user, jenis)
  } catch (error) {
    if (error instanceof ApiError) return <main className="pap-print-error">{error.message}</main>
    throw error
  }
  if (data.missingOrder) return <main className="pap-print-error">Surat order belum dibuat. Buka penawaran yang sudah Diterima lalu isi data order.</main>

  return (
    <main className="pap-print">
      <PrintButton wordUrl={`/api/quotations/${data.q.id}/word?jenis=${jenis}`} />
      {/* Template yang sama dengan ekspor Word; semua isi data sudah di-escape */}
      <div dangerouslySetInnerHTML={{ __html: quotationDocumentHtml(data, jenis, '/logo-pap.png') }} />
    </main>
  )
}
