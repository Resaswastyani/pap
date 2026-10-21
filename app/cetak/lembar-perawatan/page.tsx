import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import type { RowDataPacket } from 'mysql2'
import { ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { loadSettings } from '@/lib/hpp'
import { requireMaintenanceSheet } from '@/lib/maintenance-sheet'
import { getCurrentUser } from '@/lib/users'
import { PrintButton } from '../quotation/[id]/print-button'

export const metadata: Metadata = { title: 'Lembar Perawatan Mesin · PAP-MS' }

// Lembar "MAINTENANCE MESIN ..." seperti di spreadsheet: NO | NAMA PART | KELOMPOK | MAINTENANCE | CHECK LIST | KETERANGAN,
// untuk diisi teknisi saat perawatan (?tab=<nama tab mesin>)
export default async function CetakLembarPerawatanPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  try {
    requireMaintenanceSheet(user)
  } catch (error) {
    if (error instanceof ApiError) return <main className="pap-print-error">{error.message}</main>
    throw error
  }
  const { tab } = await searchParams
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT mesin, part_no, part, kelompok, langkah_urut, langkah, keterangan FROM maintenance_sheet_items WHERE sheet_tab = ? ORDER BY sheet_row, id',
    [tab ?? ''],
  )
  if (!rows.length) return <main className="pap-print-error">Lembar perawatan tidak ditemukan. Sinkron dulu dari Google Drive di menu Perawatan Mesin.</main>
  const doc = await loadSettings('doc.')
  // Kelompokkan langkah per part (baris pertama part membawa NO, nama part, kelompok)
  const parts: { no: number | null; part: string; kelompok: string | null; steps: RowDataPacket[] }[] = []
  for (const r of rows) {
    const last = parts.at(-1)
    if (last && last.part === r.part && last.no === r.part_no) last.steps.push(r)
    else parts.push({ no: r.part_no, part: r.part, kelompok: r.kelompok, steps: [r] })
  }

  return (
    <main className="pap-print">
      <PrintButton />
      <article className="pap-sheet pap-damage-sheet">
        <table className="pap-sheet-head">
          <tbody>
            <tr>
              <td className="logo"><img src="/logo-pap.png" alt="" width={120} /></td>
              <td>
                <h1>{doc.nama || 'PT. Pandawa Amerta Packindo'}</h1>
                <p>Flexible Plastic Packaging Manufacture</p>
                {doc.alamat && <p>{doc.alamat}</p>}
              </td>
            </tr>
          </tbody>
        </table>
        <h2 className="pap-sheet-title">MAINTENANCE {String(rows[0].mesin).toUpperCase()}</h2>
        <p className="pap-damage-period">Tanggal: ............................ &nbsp;&nbsp; Teknisi: ....................................</p>
        <table className="pap-sheet-items pap-damage-items">
          <thead>
            <tr><th className="c" style={{ width: 30 }}>NO</th><th style={{ width: 120 }}>NAMA PART</th><th style={{ width: 96 }}>KELOMPOK</th><th>MAINTENANCE</th><th className="c" style={{ width: 54 }}>CHECK LIST</th><th style={{ width: 110 }}>KETERANGAN</th></tr>
          </thead>
          <tbody>
            {parts.flatMap((p, i) => p.steps.map((s, j) => (
              <tr key={`${i}-${j}`}>
                {j === 0 && <td className="c" rowSpan={p.steps.length}>{p.no ?? i + 1}</td>}
                {j === 0 && <td rowSpan={p.steps.length}><b>{p.part}</b></td>}
                {j === 0 && <td rowSpan={p.steps.length}>{p.kelompok}</td>}
                <td>{s.langkah_urut}. {s.langkah}</td>
                <td className="c">☐</td>
                <td>{s.keterangan}</td>
              </tr>
            )))}
          </tbody>
        </table>
        <table className="pap-sheet-sign">
          <tbody>
            <tr>
              <td><p>Dikerjakan oleh,</p><div className="space" /><p>(.........................)</p></td>
              <td><p>Diperiksa Kepala Teknik,</p><div className="space" /><p>(.........................)</p></td>
            </tr>
          </tbody>
        </table>
      </article>
    </main>
  )
}
