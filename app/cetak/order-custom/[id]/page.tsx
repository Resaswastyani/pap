import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ApiError } from '@/lib/api'
import { blankChecklist, loadChecklist, requireOrderCustom } from '@/lib/order-custom'
import { orderCustomHtml, orderCustomSettings } from '@/lib/order-custom-document'
import { getCurrentUser } from '@/lib/users'
import { PrintButton } from '../../quotation/[id]/print-button'

export const metadata: Metadata = { title: 'Checklist Order Custom · SIMPAP' }

// Form Checklist Order Custom siap cetak / simpan PDF (Word: /api/order-custom/[id]/word). id 'kosong' = formulir kosong.
export default async function CetakOrderCustomPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  const { id } = await params
  const autoPrint = (await searchParams).print === '1'
  let c
  try {
    requireOrderCustom(user)
    c = id === 'kosong' ? blankChecklist() : await loadChecklist(Number(id))
  } catch (error) {
    if (error instanceof ApiError) return <main className="pap-print-error">{error.message}</main>
    throw error
  }
  return (
    <main className="pap-print">
      <PrintButton wordUrl={`/api/order-custom/${id === 'kosong' ? 'kosong' : c.id}/word`} hint={c.id ? 'untuk diarsipkan / diserahkan ke PPIC & Operasional' : '· formulir kosong untuk dicentang manual dengan pena'} autoPrint={autoPrint} />
      {/* Semua isi data sudah di-escape di template */}
      <div dangerouslySetInnerHTML={{ __html: orderCustomHtml(c, await orderCustomSettings(), '/logo-pap.png') }} />
    </main>
  )
}
