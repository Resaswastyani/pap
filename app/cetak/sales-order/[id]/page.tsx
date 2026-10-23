import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ApiError } from '@/lib/api'
import { loadSoDocument, readSoJenis, requireDokumenOrder, soDocumentHtml } from '@/lib/so-document'
import { getCurrentUser } from '@/lib/users'
import { PrintButton } from '../../quotation/[id]/print-button'

export const metadata: Metadata = { title: 'Dokumen Order · PAP-MS' }

// Surat Order / Proforma Invoice dari Sales Order Accurate (?jenis=order|proforma, ?dp=persen untuk proforma)
export default async function CetakSalesOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ jenis?: string; dp?: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  const { id } = await params
  const sp = await searchParams
  const jenis = readSoJenis(sp.jenis)
  const dp = sp.dp === undefined ? undefined : Number(sp.dp) > 0 && Number(sp.dp) <= 100 ? Number(sp.dp) : null
  let html: string
  try {
    requireDokumenOrder(user)
    html = await soDocumentHtml(await loadSoDocument(Number(id)), jenis, '/logo-pap.png', { dp })
  } catch (error) {
    if (error instanceof ApiError) return <main className="pap-print-error">{error.message}</main>
    throw error
  }
  const query = new URLSearchParams({ jenis, ...(sp.dp !== undefined ? { dp: sp.dp } : {}) })
  return (
    <main className="pap-print">
      <PrintButton wordUrl={`/api/sales-orders/${id}/word?${query}`} />
      {/* Semua isi data sudah di-escape di soDocumentHtml */}
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </main>
  )
}
