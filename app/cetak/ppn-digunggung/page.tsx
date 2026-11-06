import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { isPeriode, todayWib } from '@/lib/accounting'
import { GOOD_SERVICE, loadDigunggungMasa, loadNpwp, TRX_CODES } from '@/lib/digunggung'
import { loadSettings } from '@/lib/hpp'
import { getCurrentUser } from '@/lib/users'
import { PrintButton } from '../quotation/[id]/print-button'

export const metadata: Metadata = { title: 'Laporan PPN Digunggung · PAP-MS' }

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const tgl = (s: string) => `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`
const rp = (v: number) => Math.round(v).toLocaleString('id-ID')

// Laporan PPN digunggung satu masa (format kolom template Coretax "Retail XML"), siap cetak / simpan PDF. ?masa=YYYY-MM
export default async function CetakPpnDigunggungPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  if (!user.menus.includes('pajak' as never)) return <main className="pap-print-error">Anda tidak punya akses ke menu Pajak.</main>
  const q = await searchParams
  if (!isPeriode(q.masa)) return <main className="pap-print-error">Masa pajak tidak valid.</main>
  const masa = q.masa
  const [rows, npwp, doc] = await Promise.all([loadDigunggungMasa(masa), loadNpwp(), loadSettings('doc.')])
  const sum = (k: 'dpp' | 'dpp_nilai_lain' | 'ppn' | 'stlg') => rows.reduce((s, r) => s + r[k], 0)
  const perKode = Object.keys(TRX_CODES).map((k) => ({ k, label: TRX_CODES[k as keyof typeof TRX_CODES], list: rows.filter((r) => r.trx_code === k) })).filter((g) => g.list.length)

  return (
    <main className="pap-print">
      <style>{'@page { size: A4 landscape; margin: 10mm; }'}</style>
      <PrintButton hint="untuk arsip laporan pajak" />
      <article className="pap-sheet pap-dg-sheet">
        <header className="pap-fin-head">
          <h1>{doc.nama || 'PT. Pandawa Amerta Packindo'}</h1>
          <h2>LAPORAN PPN DIGUNGGUNG (RETAIL)</h2>
          <p>Masa Pajak {MONTHS[Number(masa.slice(5, 7)) - 1]} {masa.slice(0, 4)} · NPWP {npwp || '—'}</p>
        </header>
        {!rows.length ? <p>Belum ada PPN digunggung pada masa ini.</p> : (
          <>
            <table className="pap-dg-table">
              <thead>
                <tr><th>No</th><th>TrxCode</th><th>Nama pembeli</th><th>ID pembeli</th><th>Brg/Jasa</th><th>SerialNo</th><th>Tanggal</th><th className="r">DPP</th><th className="r">DPP nilai lain</th><th className="r">PPN</th><th className="r">PPnBM</th><th>Info</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id}>
                    <td>{i + 1}</td><td>{r.trx_code}</td><td>{r.customer}</td><td>{r.buyer_id_opt === 'TIN' ? 'NPWP' : r.buyer_id_opt} {r.buyer_id_number}</td>
                    <td>{GOOD_SERVICE[r.good_service_opt as keyof typeof GOOD_SERVICE] ?? r.good_service_opt}</td><td>{r.serial_no || r.nomor}</td><td className="nw">{tgl(String(r.tanggal))}</td>
                    <td className="r">{rp(r.dpp)}</td><td className="r">{rp(r.dpp_nilai_lain)}</td><td className="r">{rp(r.ppn)}</td><td className="r">{rp(r.stlg)}</td><td>{r.info ?? ''}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={7}><b>Total {rows.length} transaksi</b></td><td className="r"><b>{rp(sum('dpp'))}</b></td><td className="r"><b>{rp(sum('dpp_nilai_lain'))}</b></td><td className="r"><b>{rp(sum('ppn'))}</b></td><td className="r"><b>{rp(sum('stlg'))}</b></td><td /></tr>
              </tfoot>
            </table>
            {perKode.length > 1 && (
              <table className="pap-dg-table pap-dg-summary">
                <thead><tr><th>Lampiran</th><th className="r">Transaksi</th><th className="r">DPP</th><th className="r">PPN</th></tr></thead>
                <tbody>{perKode.map((g) => <tr key={g.k}><td>{g.label}</td><td className="r">{g.list.length}</td><td className="r">{rp(g.list.reduce((s, r) => s + r.dpp, 0))}</td><td className="r">{rp(g.list.reduce((s, r) => s + r.ppn, 0))}</td></tr>)}</tbody>
              </table>
            )}
          </>
        )}
        <p className="pap-fin-note">Dicetak dari PAP-MS {tgl(todayWib())}. Angka dalam Rupiah. Kolom mengikuti template Coretax Retail (RetailInvoiceBulk).</p>
      </article>
    </main>
  )
}
