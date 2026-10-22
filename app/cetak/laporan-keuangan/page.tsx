import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ApiError } from '@/lib/api'
import {
  BS_ASSET_TYPES, BS_LIAB_TYPES, bsAmounts, bsSummary, groupByType, isPeriode, monthEnd, PL_TYPES, plAmounts, plSummary, todayWib,
} from '@/lib/accounting'
import { loadSettings } from '@/lib/hpp'
import { getCurrentUser } from '@/lib/users'
import { PrintButton } from '../quotation/[id]/print-button'

export const metadata: Metadata = { title: 'Laporan Keuangan · PAP-MS' }
export const maxDuration = 60

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const tgl = (s: string) => `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`
const rp = (v: number) => `${v < 0 ? '(' : ''}${Math.abs(v).toLocaleString('id-ID', { maximumFractionDigits: 0 })}${v < 0 ? ')' : ''}`

// Financial statement bulanan dari Accurate: laba rugi + neraca. ?periode=YYYY-MM &jenis=bulan|ytd
export default async function CetakLaporanKeuanganPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  if (!user.menus.includes('laporan-keuangan' as never)) return <main className="pap-print-error">Anda tidak punya akses ke menu Laporan Keuangan.</main>
  const q = await searchParams
  const today = todayWib()
  const periode = isPeriode(q.periode) ? q.periode : today.slice(0, 7)
  const end = periode === today.slice(0, 7) ? today : monthEnd(periode)
  const from = q.jenis === 'ytd' ? `${periode.slice(0, 4)}-01-01` : `${periode}-01`
  let data
  try {
    const [plRows, bsRows, doc] = await Promise.all([plAmounts(from, end), bsAmounts(end), loadSettings('doc.')])
    data = { pl: plSummary(plRows), plGroups: groupByType(plRows, PL_TYPES), bs: bsSummary(bsRows), aset: groupByType(bsRows, BS_ASSET_TYPES), kewajiban: groupByType(bsRows, BS_LIAB_TYPES), doc }
  } catch (error) {
    return <main className="pap-print-error">{error instanceof ApiError ? error.message : 'Laporan tidak bisa dimuat dari Accurate.'}</main>
  }
  const { pl, plGroups, bs, aset, kewajiban, doc } = data
  const Section = ({ groups }: { groups: typeof plGroups }) => (
    <>
      {groups.map((g) => (
        <tbody key={g.type}>
          <tr className="group"><td colSpan={2}><b>{g.label}</b></td></tr>
          {g.accounts.map((a) => <tr key={a.no}><td className="indent">{a.no} · {a.name}</td><td className="r">{rp(a.amount)}</td></tr>)}
          <tr className="sub"><td>Jumlah {g.label}</td><td className="r">{rp(g.total)}</td></tr>
        </tbody>
      ))}
    </>
  )

  return (
    <main className="pap-print">
      <PrintButton />
      <article className="pap-sheet pap-fin-sheet">
        <header className="pap-fin-head">
          <h1>{doc.nama || 'PT. Pandawa Amerta Packindo'}</h1>
          <h2>LAPORAN LABA RUGI</h2>
          <p>Periode {tgl(from)} s.d. {tgl(end)}</p>
        </header>
        <table className="pap-fin-table">
          <Section groups={plGroups} />
          <tbody>
            <tr className="total"><td>LABA KOTOR</td><td className="r">{rp(pl.laba_kotor)}</td></tr>
            <tr className="total"><td>LABA USAHA</td><td className="r">{rp(pl.laba_usaha)}</td></tr>
            <tr className="total grand"><td>LABA BERSIH</td><td className="r">{rp(pl.laba_bersih)}</td></tr>
          </tbody>
        </table>

        <header className="pap-fin-head pap-fin-break">
          <h1>{doc.nama || 'PT. Pandawa Amerta Packindo'}</h1>
          <h2>NERACA</h2>
          <p>Per {tgl(end)}</p>
        </header>
        <table className="pap-fin-table">
          <Section groups={aset} />
          <tbody><tr className="total grand"><td>TOTAL ASET</td><td className="r">{rp(bs.aset)}</td></tr></tbody>
          <Section groups={kewajiban} />
          <tbody>
            <tr className="sub"><td>Laba tahun berjalan (belum tutup buku)</td><td className="r">{rp(bs.laba_berjalan)}</td></tr>
            <tr className="total grand"><td>TOTAL KEWAJIBAN & EKUITAS</td><td className="r">{rp(bs.liabilitas + bs.ekuitas + bs.laba_berjalan)}</td></tr>
          </tbody>
        </table>
        <p className="pap-fin-note">Sumber: Accurate Online, dicetak dari PAP-MS {tgl(today)}. Angka dalam Rupiah; tanda kurung = negatif.</p>
      </article>
    </main>
  )
}
