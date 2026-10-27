import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ApiError } from '@/lib/api'
import { gaRequestView, purchaseDocHtml } from '@/lib/purchase-doc'
import { getCurrentUser } from '@/lib/users'
import { PrintButton } from '../../quotation/[id]/print-button'

export const metadata: Metadata = { title: 'Pengajuan GA · PAP-MS' }

// Cetak formulir Pengajuan Pembelian GA; simpan PDF lewat dialog cetak
export default async function CetakPengajuanGaPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  const { id } = await params
  let html: string
  try {
    html = await purchaseDocHtml(await gaRequestView(Number(id), user), '/logo-pap.png')
  } catch (error) {
    if (error instanceof ApiError) return <main className="pap-print-error">{error.message}</main>
    throw error
  }
  return (
    <main className="pap-print">
      <PrintButton wordUrl={`/api/ga/requests/${id}/word`} hint="untuk arsip / tanda tangan" />
      {/* Semua isi data sudah di-escape di purchaseDocHtml */}
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </main>
  )
}
