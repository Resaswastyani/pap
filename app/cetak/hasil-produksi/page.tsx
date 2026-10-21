import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import type { RowDataPacket } from 'mysql2'
import { db } from '@/lib/db'
import { loadSettings } from '@/lib/hpp'
import { canViewProduction, GOOD_QTY_SQL } from '@/lib/production'
import { currentShift, QC_STATUS, RESULT_SELECT, type QcStatus } from '@/lib/production-results'
import { getCurrentUser } from '@/lib/users'
import { PrintButton } from '../quotation/[id]/print-button'

export const metadata: Metadata = { title: 'Rangkuman Hasil Produksi & QC · PAP-MS' }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const tgl = (v: unknown) => {
  const s = typeof v === 'string' ? v.slice(0, 10) : ''
  return s ? `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}` : ''
}
const num = (v: unknown) => Number(v ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 2 })
const pct = (part: number, total: number) => (total > 0 ? `${((part / total) * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%` : '–')
const isDate = (v: string | null | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)

// Guidance Produksi: "Dokumen rangkuman hasil QC monitoring dan hasil produksi".
// ?dari=YYYY-MM-DD &sampai=YYYY-MM-DD (default tanggal shift berjalan) &shift=1|2|3
export default async function CetakHasilProduksiPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  if (!canViewProduction(user)) return <main className="pap-print-error">Anda tidak punya akses ke data produksi.</main>

  const query = await searchParams
  const today = currentShift().tanggal
  const dari = isDate(query.dari) ? query.dari : today
  const sampai = isDate(query.sampai) && query.sampai >= dari ? query.sampai : dari
  const shift = ['1', '2', '3'].includes(query.shift ?? '') ? Number(query.shift) : null
  const where = ['r.tanggal BETWEEN ? AND ?', ...(shift ? ['r.shift = ?'] : [])]
  const args: unknown[] = [dari, sampai, ...(shift ? [shift] : [])]

  const [rows] = await db.query<RowDataPacket[]>(`${RESULT_SELECT} WHERE ${where.join(' AND ')} ORDER BY r.tanggal, r.shift, j.nomor, s.urutan, r.id LIMIT 1000`, args)
  // Ringkasan per shift & satuan (satuan berbeda tidak dijumlahkan bersama)
  const [rekap] = await db.query<RowDataPacket[]>(
    `SELECT r.shift, COALESCE(r.satuan, '-') AS satuan, COUNT(*) AS laporan, SUM(r.jumlah_hasil) AS hasil, SUM(r.jumlah_reject) AS reject,
       SUM(${GOOD_QTY_SQL}) AS baik, SUM(r.status_qc = 'lolos') AS lolos, SUM(r.status_qc = 'perbaikan') AS perbaikan,
       SUM(r.status_qc = 'reject') AS qc_reject, SUM(r.status_qc = 'menunggu') AS menunggu
     FROM production_results r WHERE ${where.join(' AND ')} GROUP BY r.shift, COALESCE(r.satuan, '-') ORDER BY r.shift, satuan`,
    args,
  )
  const doc = await loadSettings('doc.')
  const kendala = rows.filter((r) => r.kendala)
  const periode = dari === sampai ? tgl(dari) : `${tgl(dari)} s/d ${tgl(sampai)}`

  return (
    <main className="pap-print">
      <PrintButton />
      <article className="pap-sheet pap-damage-sheet pap-results-sheet">
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
        <h2 className="pap-sheet-title">RANGKUMAN HASIL PRODUKSI &amp; MONITORING QC</h2>
        <p className="pap-damage-period">Periode: {periode}{shift ? ` · Shift ${shift}` : ' · Semua shift'} · {rows.length} laporan</p>

        <h3>Ringkasan per shift</h3>
        <table className="pap-sheet-items">
          <thead>
            <tr><th className="c">Shift</th><th>Satuan</th><th className="r">Laporan</th><th className="r">Hasil</th><th className="r">Reject</th><th className="r">% Reject</th><th className="r">Hasil baik</th><th className="r">Lolos QC</th><th className="r">Perbaikan</th><th className="r">Reject QC</th><th className="r">Menunggu QC</th></tr>
          </thead>
          <tbody>
            {rekap.map((r) => (
              <tr key={`${r.shift}-${r.satuan}`}>
                <td className="c">{r.shift}</td><td>{r.satuan}</td><td className="r">{num(r.laporan)}</td><td className="r">{num(r.hasil)}</td>
                <td className="r">{num(r.reject)}</td><td className="r">{pct(Number(r.reject), Number(r.hasil))}</td><td className="r"><b>{num(r.baik)}</b></td>
                <td className="r">{num(r.lolos)}</td><td className="r">{num(r.perbaikan)}</td><td className="r">{num(r.qc_reject)}</td><td className="r">{num(r.menunggu)}</td>
              </tr>
            ))}
            {!rekap.length && <tr><td colSpan={11} className="c">Belum ada laporan hasil produksi pada periode ini.</td></tr>}
          </tbody>
        </table>

        {rows.length > 0 && (
          <>
            <h3>Rincian laporan</h3>
            <table className="pap-sheet-items">
              <thead>
                <tr><th className="c">No</th><th>Tanggal / shift</th><th>SPK / produk</th><th>Tahap / mesin</th><th>Operator</th><th className="r">Hasil</th><th className="r">Reject</th><th>QC</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id}>
                    <td className="c">{i + 1}</td>
                    <td>{tgl(r.tanggal)}<div className="spec">Shift {r.shift}</div></td>
                    <td>{r.spk_nomor || r.nomor}<div className="spec">{r.item_name}{r.customer_name ? ` · ${r.customer_name}` : ''}</div></td>
                    <td>{r.tahap}{r.machine_name ? <div className="spec">{r.machine_name}</div> : null}</td>
                    <td>{r.operator || '–'}</td>
                    <td className="r">{num(r.jumlah_hasil)} {r.satuan ?? ''}</td>
                    <td className="r">{num(r.jumlah_reject)}</td>
                    <td>{QC_STATUS[r.status_qc as QcStatus]}{r.catatan_qc ? <div className="spec">{r.catatan_qc}</div> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {kendala.length > 0 && (
          <>
            <h3>Kendala bahan baku &amp; mesin</h3>
            <table className="pap-sheet-items">
              <thead><tr><th className="c">No</th><th>Tanggal / shift</th><th>SPK / tahap</th><th>Kendala</th></tr></thead>
              <tbody>
                {kendala.map((r, i) => (
                  <tr key={r.id}>
                    <td className="c">{i + 1}</td>
                    <td>{tgl(r.tanggal)}<div className="spec">Shift {r.shift}</div></td>
                    <td>{r.spk_nomor || r.nomor}<div className="spec">{r.tahap}{r.machine_name ? ` · ${r.machine_name}` : ''}</div></td>
                    <td className="pre">{r.kendala}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <table className="pap-sheet-sign">
          <tbody>
            <tr>
              <td><p>Dibuat oleh (KA Shift),</p><div className="space" /><p>(.........................)</p></td>
              <td><p>Diperiksa QC,</p><div className="space" /><p>(.........................)</p></td>
              <td><p>Mengetahui Kepala Produksi,</p><div className="space" /><p>(.........................)</p></td>
            </tr>
          </tbody>
        </table>
      </article>
    </main>
  )
}
