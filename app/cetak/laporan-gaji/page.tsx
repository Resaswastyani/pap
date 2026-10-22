import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { tglId } from '@/lib/attendance-report'
import { canManageHr, canViewPayroll } from '@/lib/hrd'
import { payrollReport, periodeLabel } from '@/lib/payroll-report'
import { getCurrentUser } from '@/lib/users'
import { PrintButton } from '../quotation/[id]/print-button'

export const metadata: Metadata = { title: 'Laporan Gaji · PAP-MS' }
export const maxDuration = 60

const rp = (v: number) => Math.round(v).toLocaleString('id-ID')
const jam = (v: number) => (v ? v.toLocaleString('id-ID', { maximumFractionDigits: 2 }) : '–')

// Laporan gaji per periode cut off (PDF lewat dialog cetak): ?periode=YYYY-MM
export default async function CetakLaporanGajiPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  if (!canViewPayroll(user)) return <main className="pap-print-error">Anda tidak punya akses ke menu Grade & Gaji.</main>
  const q = await searchParams
  if (!q.periode || !/^\d{4}-(0[1-9]|1[0-2])$/.test(q.periode)) return <main className="pap-print-error">Periode tidak valid.</main>
  const withBank = canManageHr(user)
  const rep = await payrollReport(q.periode, withBank)

  return (
    <main className="pap-print">
      <PrintButton hint="untuk menyimpan / mengirim laporan ke Keuangan" />
      <article className="pap-sheet pap-sheet-landscape pap-att-report">
        <header className="pap-fin-head">
          <h1>PT. Pandawa Amerta Packindo</h1>
          <h2>LAPORAN GAJI KARYAWAN · {periodeLabel(rep.periode).toUpperCase()}</h2>
          <p>Periode {tglId(rep.dari)} s/d {tglId(rep.sampai)} · absensi sampai {tglId(rep.sampai_data)} · {rep.slips.length} karyawan</p>
        </header>
        <table className="pap-att-table">
          <thead>
            <tr>
              <th>No</th><th>NIP</th><th>Nama</th><th>Jabatan</th><th>Hadir</th><th>Jam dibayar</th><th>Lembur rutin</th><th>Lembur var.</th><th>Lembur libur</th>
              <th>Upah</th><th>Lembur (Rp)</th><th>Tunj. & lain</th><th>Bruto</th><th>Potongan</th><th>Take Home Pay</th>{withBank && <th>Rekening</th>}
            </tr>
          </thead>
          <tbody>
            {rep.slips.map((s) => (
              <tr key={s.nip}>
                <td className="c">{s.no}</td><td>{s.nip}</td><td>{s.nama}</td><td>{s.jabatan ?? ''}</td><td className="r">{s.hadir}</td>
                <td className="r">{jam(s.mingguan?.jam_dibayar ?? 0)}</td><td className="r">{jam(s.lembur_rutin_jam)}</td><td className="r">{jam(s.mingguan?.lembur_variabel ?? 0)}</td><td className="r">{jam(s.lembur_libur_jam)}</td>
                <td className="r">{rp(s.upah)}</td><td className="r">{rp(s.lembur)}</td><td className="r">{rp(s.tunjangan + s.pendapatan_lain + s.pendapatan_harian + s.cuti_dibayar)}</td>
                <td className="r">{rp(s.bruto)}</td><td className="r">{rp(s.potongan_bpjs + s.potongan_lain)}</td><td className="r"><b>{rp(s.diterima)}</b></td>
                {withBank && <td>{[s.rekening?.bank, s.rekening?.no_rekening].filter(Boolean).join(' ')}</td>}
              </tr>
            ))}
            <tr className="total">
              <td colSpan={9}>TOTAL</td><td className="r">{rp(rep.total.upah)}</td><td className="r">{rp(rep.total.lembur)}</td><td className="r">{rp(rep.total.lain)}</td>
              <td className="r">{rp(rep.total.bruto)}</td><td className="r">{rp(rep.total.potongan)}</td><td className="r">{rp(rep.total.diterima)}</td>{withBank && <td />}
            </tr>
          </tbody>
        </table>
        <p className="pap-fin-note">
          Iuran BPJS bagian perusahaan (di luar gaji): Rp {rp(rep.total.bpjs_perusahaan)}. Jam dibayar maks 40 jam/minggu, lembur rutin = di atas 40 jam/minggu, lembur variabel = di luar shift / input manual,
          lembur libur = bekerja di hari libur Jadwal Shift. PPh 21 belum dihitung. Dicetak dari PAP-MS {tglId(new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10))}.
        </p>
        <table className="pap-sheet-sign">
          <tbody>
            <tr>
              <td><p>Dibuat oleh HRD,</p><div className="space" /><p>(.........................)</p></td>
              <td><p>Diperiksa Keuangan,</p><div className="space" /><p>(.........................)</p></td>
              <td><p>Disetujui,</p><div className="space" /><p>(.........................)</p></td>
            </tr>
          </tbody>
        </table>
      </article>
    </main>
  )
}
