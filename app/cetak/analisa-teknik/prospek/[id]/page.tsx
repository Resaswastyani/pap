import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ApiError } from '@/lib/api'
import { prospectAnalysisSheets, requireTechAnalysis } from '@/lib/tech-analysis'
import { techAnalysisHtml, techAnalysisSettings } from '@/lib/tech-analysis-document'
import { getCurrentUser } from '@/lib/users'
import { PrintButton } from '../../../quotation/[id]/print-button'

export const metadata: Metadata = { title: 'Analisa Teknik Prospek · SIMPAP' }

// Formulir Analisa Aspek Teknik semua produk satu prospek (satu halaman per produk), siap cetak / simpan PDF
export default async function CetakAnalisaProspekPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  const { id } = await params
  const autoPrint = (await searchParams).print === '1'
  let data
  try {
    requireTechAnalysis(user)
    data = await prospectAnalysisSheets(Number(id), user)
  } catch (error) {
    if (error instanceof ApiError) return <main className="pap-print-error">{error.message}</main>
    throw error
  }
  const doc = await techAnalysisSettings()
  return (
    <main className="pap-print pap-ta-sheets">
      <PrintButton wordUrl={`/api/tech-analyses/prospek/${data.prospect.id}/word`} hint={`· ${data.sheets.length} formulir (${data.prospect.nama_usaha}), satu halaman per produk`} autoPrint={autoPrint} />
      {data.sheets.map((a, i) => (
        // Semua isi data sudah di-escape di template
        <div key={`${a.id}-${i}`} className="pap-ta-sheet-wrap" dangerouslySetInnerHTML={{ __html: techAnalysisHtml(a, doc, '/logo-pap.png') }} />
      ))}
    </main>
  )
}
