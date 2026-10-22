import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { attendanceReport, isDate, summaryValues, tglId } from '@/lib/attendance-report'
import { HARI_ID } from '@/lib/payroll-weekly'
import { getCurrentUser } from '@/lib/users'
import { PrintButton } from '../quotation/[id]/print-button'

export const metadata: Metadata = { title: 'Laporan Absensi · PAP-MS' }
export const maxDuration = 60

const fmt = (v: number) => v.toLocaleString('id-ID', { maximumFractionDigits: 2 })
// Rentang panjang: sel diringkas jadi kode (H hadir, T terlambat, N scan tidak lengkap) agar muat satu halaman
const compact = (c: string) => (c.includes(':') ? (c.includes('NSO') || c.startsWith('--') ? 'N' : 'H') : c)

// Laporan absensi (PDF lewat dialog cetak): ?dari=&sampai=
export default async function CetakAbsensiPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  if (!user.menus.includes('absensi' as never)) return <main className="pap-print-error">Anda tidak punya akses ke menu Absensi.</main>
  const q = await searchParams
  if (!isDate(q.dari) || !isDate(q.sampai) || q.sampai < q.dari || (Date.parse(q.sampai) - Date.parse(q.dari)) / 86400e3 > 62) return <main className="pap-print-error">Rentang tanggal tidak valid (maks 2 bulan).</main>
  const rep = await attendanceReport(q.dari, q.sampai)
  const short = rep.dates.length > 10
  const total = (i: number) => fmt(rep.rows.reduce((t, r) => t + summaryValues(r)[i], 0))

  return (
    <main className="pap-print">
      <PrintButton hint="untuk menyimpan / mengirim laporan ke Keuangan" />
      <article className="pap-sheet pap-sheet-landscape pap-att-report">
        <header className="pap-fin-head">
          <h1>PT. Pandawa Amerta Packindo</h1>
          <h2>LAPORAN ABSENSI KARYAWAN</h2>
          <p>{tglId(rep.dari)} s/d {tglId(rep.sampai)} · {rep.rows.length} karyawan</p>
        </header>
        <h3>Rekap</h3>
        <table className="pap-att-table">
          <thead>
            <tr><th>No</th><th>NIP</th><th>Nama</th><th>Jabatan</th><th>Libur</th><th>Hadir</th><th>Terlambat</th><th>TK</th><th>Izin</th><th>Sakit</th><th>Cuti</th><th>OFF</th><th>Jam kerja</th><th>Lembur rutin</th><th>Lembur variabel</th><th>Lembur libur</th></tr>
          </thead>
          <tbody>
            {rep.rows.map((r) => (
              <tr key={r.nip}>
                <td className="c">{r.no}</td><td>{r.nip}</td><td>{r.nama}</td><td>{r.jabatan ?? ''}</td><td className="c">{r.libur_rutin}</td>
                <td className="r">{r.hadir}</td><td className="r">{r.terlambat ? `${r.terlambat}× / ${r.terlambat_menit}m` : '–'}</td><td className="r">{r.tk || '–'}</td>
                <td className="r">{r.izin || '–'}</td><td className="r">{r.sakit || '–'}</td><td className="r">{r.cuti || '–'}</td><td className="r">{r.off || '–'}</td>
                <td className="r">{fmt(r.jam_kerja)}</td><td className="r">{r.lembur_rutin ? fmt(r.lembur_rutin) : '–'}</td><td className="r">{r.lembur_variabel ? fmt(r.lembur_variabel) : '–'}</td><td className="r">{r.lembur_libur ? fmt(r.lembur_libur) : '–'}</td>
              </tr>
            ))}
            <tr className="total"><td colSpan={5}>TOTAL</td><td className="r">{total(0)}</td><td className="r">{total(1)}×</td><td className="r">{total(3)}</td><td className="r">{total(4)}</td><td className="r">{total(5)}</td><td className="r">{total(6)}</td><td className="r">{total(8)}</td><td className="r">{total(10)}</td><td className="r">{total(11)}</td><td className="r">{total(12)}</td><td className="r">{total(13)}</td></tr>
          </tbody>
        </table>

        <h3 className="pap-fin-break">Kehadiran harian</h3>
        <table className={`pap-att-table pap-att-matrix ${short ? 'short' : ''}`}>
          <thead>
            <tr>
              <th>No</th><th>Nama</th>
              {rep.dates.map((d) => {
                const dow = new Date(`${d}T00:00:00Z`).getUTCDay()
                return <th key={d}>{HARI_ID[dow].slice(0, short ? 1 : 3)}<br />{Number(d.slice(8, 10))}{short ? '' : `/${Number(d.slice(5, 7))}`}</th>
              })}
            </tr>
          </thead>
          <tbody>
            {rep.rows.map((r) => (
              <tr key={r.nip}>
                <td className="c">{r.no}</td><td className="name">{r.nama}</td>
                {r.cells.map((c, i) => <td key={i} className={`c ${r.offCells[i] && !c.includes(':') ? 'off' : c === 'TK' ? 'tk' : ''}`}>{short ? compact(c) : c.replace('-', '–')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="pap-fin-note">
          {short ? 'H = hadir, N = scan tidak lengkap, ' : 'Jam masuk–pulang, NSO = tidak scan pulang, '}OFF = libur sesuai Jadwal Shift, TK = tanpa keterangan, I = izin, S = sakit, C = cuti, DL = dinas luar.
          {' '}Libur bertanda * belum ada di Jadwal Shift (dianggap Minggu). Jam kerja maks 7 jam/hari; lembur rutin = di atas 40 jam/minggu. Dicetak dari PAP-MS {tglId(rep.today)}.
        </p>
      </article>
    </main>
  )
}
