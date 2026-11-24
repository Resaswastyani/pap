import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ApiError } from '@/lib/api'
import { analysisImages, loadAnalysis, requireTechAnalysis } from '@/lib/tech-analysis'
import { techAnalysisHtml, techAnalysisSettings } from '@/lib/tech-analysis-document'
import { getCurrentUser } from '@/lib/users'
import { PrintButton } from '../../quotation/[id]/print-button'

export const metadata: Metadata = { title: 'Analisa Teknik Order · SIMPAP' }

// Formulir Analisa Aspek Teknik siap cetak / simpan PDF (Word: /api/tech-analyses/[id]/word)
export default async function CetakAnalisaTeknikPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  const { id } = await params
  const autoPrint = (await searchParams).print === '1'
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
      <PrintButton wordUrl={`/api/tech-analyses/${a.id}/word`} hint="untuk diarsipkan / diserahkan ke Dept Teknik" autoPrint={autoPrint} />
      {/* Semua isi data sudah di-escape di template */}
      <div dangerouslySetInnerHTML={{ __html: techAnalysisHtml(a, await techAnalysisSettings(), '/logo-pap.png', await analysisImages(a.id)) }} />
    </main>
  )
}
