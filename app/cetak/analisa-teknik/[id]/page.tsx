import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ApiError } from '@/lib/api'
import { loadAnalysis, requireTechAnalysis } from '@/lib/tech-analysis'
import { techAnalysisHtml, techAnalysisSettings } from '@/lib/tech-analysis-document'
import { getCurrentUser } from '@/lib/users'
import { PrintButton } from '../../quotation/[id]/print-button'

export const metadata: Metadata = { title: 'Analisa Teknik Order · SIMPAP' }

// Formulir Analisa Aspek Teknik siap cetak / simpan PDF (Word: /api/tech-analyses/[id]/word)
export default async function CetakAnalisaTeknikPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  const { id } = await params
  let a
  try {
    requireTechAnalysis(user)
    a = await loadAnalysis(Number(id))
  } catch (error) {
    if (error instanceof ApiError) return <main className="pap-print-error">{error.message}</main>
    throw error
  }
  return (
    <main className="pap-print">
      <PrintButton wordUrl={`/api/tech-analyses/${a.id}/word`} hint="untuk diarsipkan / diserahkan ke Dept Teknik" />
      {/* Semua isi data sudah di-escape di template */}
      <div dangerouslySetInnerHTML={{ __html: techAnalysisHtml(a, await techAnalysisSettings(), '/logo-pap.png') }} />
    </main>
  )
}
