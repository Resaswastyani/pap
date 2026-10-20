import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import type { RowDataPacket } from 'mysql2'
import { ApiError } from '@/lib/api'
import { DAMAGE_SELECT, damageFilter, requireDamageLog } from '@/lib/damage-log'
import { db } from '@/lib/db'
import { loadSettings } from '@/lib/hpp'
import { getCurrentUser } from '@/lib/users'
import { PrintButton } from '../quotation/[id]/print-button'

export const metadata: Metadata = { title: 'Laporan Kerusakan Mesin · PAP-MS' }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const tgl = (v: unknown) => {
  const s = typeof v === 'string' ? v.slice(0, 10) : ''
  return s ? `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}` : ''
}

// Form "LAPORAN KERUSAKAN MESIN" seperti tab FORM KERUSAKAN di spreadsheet: NO | TANGGAL | NAMA MESIN | KERUSAKAN | TINDAKAN | KETERANGAN.
// ?kosong=1 mencetak form kosong untuk diisi tangan; selain itu berisi data sesuai filter (?dari= &sampai= &mesin= &q=).
export default async function CetakKerusakanPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  try {
    requireDamageLog(user)
  } catch (error) {
    if (error instanceof ApiError) return <main className="pap-print-error">{error.message}</main>
    throw error
  }
  const query = await searchParams
  const params = new URLSearchParams(Object.entries(query).filter((e): e is [string, string] => typeof e[1] === 'string'))
  const blank = params.get('kosong') === '1'
  const filter = damageFilter(params)
  const [rows] = blank ? [[] as RowDataPacket[]] : await db.query<RowDataPacket[]>(`${DAMAGE_SELECT} ${filter.sql} ORDER BY d.tanggal, d.no_laporan, d.sheet_row, d.id LIMIT 500`, filter.args)
  const doc = await loadSettings('doc.')
  // Baris kosong tambahan agar form tetap bisa ditulis tangan (minimal 20 baris)
  const empty = Math.max(0, 20 - rows.length)
  const periode = params.get('dari') || params.get('sampai') ? `${tgl(params.get('dari')) || '…'} s/d ${tgl(params.get('sampai')) || '…'}` : params.get('tahun') ? `Tahun ${params.get('tahun')}` : ''

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
        <h2 className="pap-sheet-title">LAPORAN KERUSAKAN MESIN</h2>
        {periode && <p className="pap-damage-period">Periode: {periode}</p>}
        <table className="pap-sheet-items pap-damage-items">
          <thead>
            <tr><th className="c" style={{ width: 34 }}>NO</th><th style={{ width: 86 }}>TANGGAL</th><th style={{ width: 120 }}>NAMA MESIN</th><th>KERUSAKAN</th><th>TINDAKAN</th><th style={{ width: 120 }}>KETERANGAN</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td className="c">{i + 1}</td>
                <td>{tgl(r.tanggal)}</td>
                <td>{r.mesin}{r.komponen ? <div className="spec">{r.komponen}</div> : null}</td>
                <td className="pre">{r.kerusakan}</td>
                <td className="pre">{r.tindakan}</td>
                <td className="pre">{r.keterangan}</td>
              </tr>
            ))}
            {Array.from({ length: empty }, (_, i) => (
              <tr key={`k${i}`} className="blank"><td className="c">{rows.length + i + 1}</td><td /><td /><td /><td /><td /></tr>
            ))}
          </tbody>
        </table>
        <table className="pap-sheet-sign">
          <tbody>
            <tr>
              <td><p>Dilaporkan oleh,</p><div className="space" /><p>(.........................)</p></td>
              <td><p>Diperiksa Teknik,</p><div className="space" /><p>(.........................)</p></td>
            </tr>
          </tbody>
        </table>
      </article>
    </main>
  )
}
