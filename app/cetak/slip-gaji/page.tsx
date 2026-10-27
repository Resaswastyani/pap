import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { canViewPayroll } from '@/lib/hrd'
import { hitungPeriode } from '@/lib/payroll'
import { getCurrentUser } from '@/lib/users'
import { PrintButton } from '../quotation/[id]/print-button'

export const metadata: Metadata = { title: 'Slip Gaji · PAP-MS' }
export const maxDuration = 60

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const tgl = (s: string | null) => (s ? `${Number(s.slice(8, 10))} ${BLN[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}` : '')
const rp = (v: number) => v.toLocaleString('id-ID', { maximumFractionDigits: 0 })

// Slip gaji per karyawan (format slip Altius PT PAP): ?periode=YYYY-MM &nip= (kosong = semua karyawan, satu slip per halaman)
export default async function SlipGajiPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  if (!canViewPayroll(user)) return <main className="pap-print-error">Anda tidak punya akses ke Grade & gaji (menu Karyawan).</main>
  const q = await searchParams
  const periode = q.periode && /^\d{4}-(0[1-9]|1[0-2])$/.test(q.periode) ? q.periode : null
  if (!periode) return <main className="pap-print-error">Periode tidak valid.</main>
  const data = await hitungPeriode(periode)
  const slips = data.slips.filter((s) => !q.nip || s.nip === q.nip)
  if (!slips.length) return <main className="pap-print-error">Tidak ada slip gaji untuk periode ini.</main>
  const judul = `Periode ${BULAN[Number(periode.slice(5, 7)) - 1]} - ${periode.slice(0, 4)}`

  return (
    <main className="pap-print">
      <PrintButton hint="untuk membagikan slip ke karyawan" />
      {slips.map((s) => {
        const pokok = s.rincian.penghasilan.reduce((t, l) => t + l.nominal, 0)
        const tambahan = s.rincian.tambahan.reduce((t, l) => t + l.nominal, 0)
        const potongan = s.rincian.potongan.reduce((t, l) => t + l.nominal, 0)
        return (
          <article key={s.nip} className="pap-sheet pap-slip">
            <header className="pap-slip-head">
              <img src="/logo-pap.png" alt="PT. Pandawa Amerta Packindo" width={150} />
              <h1>PT. PANDAWA AMERTA<br />PACKINDO</h1>
            </header>
            <h2>{judul}</h2>
            <p className="pap-slip-range">{tgl(data.dari)} – {tgl(data.sampai)}</p>
            <table className="pap-slip-info">
              <tbody>
                <tr><td>ID / Nama</td><td>:</td><td>{s.nip} / {s.nama}</td></tr>
                <tr><td>Tanggal Masuk</td><td>:</td><td>{tgl(s.tgl_masuk)}</td></tr>
                <tr><td>Departemen</td><td>:</td><td>{s.divisi ?? ''}</td></tr>
                <tr><td>Posisi Pekerjaan</td><td>:</td><td>{s.jabatan ?? ''}</td></tr>
              </tbody>
            </table>
            <div className="pap-slip-cols">
              <table className="pap-slip-table">
                <thead><tr><th colSpan={3}>Penghasilan</th></tr></thead>
                <tbody>
                  {s.rincian.penghasilan.map((l) => <tr key={l.label}><td>{l.label}</td><td>Rp.</td><td>{rp(l.nominal)}</td></tr>)}
                  <tr className="total"><td>Total Penghasilan</td><td>Rp.</td><td>{rp(pokok)}</td></tr>
                  {s.rincian.tambahan.map((l, i) => <tr key={i}><td>{l.label}</td><td>Rp.</td><td>{rp(l.nominal)}</td></tr>)}
                  {s.rincian.tambahan.length > 0 && <tr className="total"><td>Total Penghasilan Tambahan</td><td>Rp.</td><td>{rp(tambahan)}</td></tr>}
                </tbody>
              </table>
              <div>
                {s.rincian.potongan.length > 0 && (
                  <table className="pap-slip-table">
                    <thead><tr><th colSpan={3}>Potongan</th></tr></thead>
                    <tbody>
                      {s.rincian.potongan.map((l) => <tr key={l.label}><td>{l.label}</td><td>Rp.</td><td>{rp(l.nominal)}</td></tr>)}
                      <tr className="total"><td>Total Potongan</td><td>Rp.</td><td>{rp(potongan)}</td></tr>
                    </tbody>
                  </table>
                )}
                <p className="pap-slip-sign">Di Terima Oleh</p>
              </div>
            </div>
            <p className="pap-slip-thp">Take Home Pay : Rp. {rp(pokok + tambahan - potongan)}</p>
            <hr />
            <p className="pap-slip-note">***PaySlip di Cetak secara digital dan berlaku tanpa tanda tangan ataupun stempel***</p>
          </article>
        )
      })}
    </main>
  )
}
