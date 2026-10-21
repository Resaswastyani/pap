import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import type { RowDataPacket } from 'mysql2'
import { db } from '@/lib/db'
import { loadSettings } from '@/lib/hpp'
import { LOG_SELECT } from '@/lib/maintenance'
import { CHECKUP_RESULT, isDate, todayWib, type CheckupResult } from '@/lib/teknik'
import { getCurrentUser } from '@/lib/users'
import { PrintButton } from '../quotation/[id]/print-button'

export const metadata: Metadata = { title: 'Laporan Checkup & Perawatan Mesin · PAP-MS' }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const tgl = (v: unknown) => {
  const s = typeof v === 'string' ? v.slice(0, 10) : ''
  return s ? `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}` : ''
}

// Guidance Tehnik: "Dokumen checkup & maintenance mesin". ?dari= &sampai= (default bulan berjalan) &mesin=
export default async function CetakPerawatanPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  if (!user.menus.includes('perawatan-mesin' as never)) return <main className="pap-print-error">Anda tidak punya akses ke menu Perawatan Mesin.</main>

  const q = await searchParams
  const today = todayWib()
  const dari = isDate(q.dari) ? q.dari : `${today.slice(0, 8)}01`
  const sampai = isDate(q.sampai) && q.sampai >= dari ? q.sampai : today
  const mesin = Number(q.mesin) || null
  const [rows] = await db.query<RowDataPacket[]>(
    `${LOG_SELECT} WHERE l.tanggal BETWEEN ? AND ?${mesin ? ' AND l.machine_id = ?' : ''} ORDER BY l.tanggal, m.nama, l.id LIMIT 1000`,
    mesin ? [dari, sampai, mesin] : [dari, sampai],
  )
  // Jadwal yang jatuh tempo / terlambat per akhir periode
  const [due] = await db.query<RowDataPacket[]>(
    `SELECT p.judul, p.komponen, p.berikutnya, p.terakhir, m.nama AS mesin FROM maintenance_plans p JOIN machines m ON m.id = p.machine_id
     WHERE p.aktif = 1 AND p.berikutnya <= ?${mesin ? ' AND p.machine_id = ?' : ''} ORDER BY p.berikutnya`,
    mesin ? [sampai, mesin] : [sampai],
  )
  const doc = await loadSettings('doc.')
  const count = (h: CheckupResult) => rows.filter((r) => r.hasil === h).length
  const mesinNama = mesin ? (rows[0]?.machine_nama ?? due[0]?.mesin ?? '') : ''

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
        <h2 className="pap-sheet-title">LAPORAN CHECKUP &amp; PERAWATAN MESIN</h2>
        <p className="pap-damage-period">
          Periode: {tgl(dari)} s/d {tgl(sampai)}{mesinNama ? ` · ${mesinNama}` : ''} · {rows.length} checkup (baik {count('baik')}, perlu tindakan {count('perlu_tindakan')}, rusak {count('rusak')})
        </p>
        <table className="pap-sheet-items pap-damage-items">
          <thead><tr><th className="c" style={{ width: 34 }}>NO</th><th style={{ width: 86 }}>TANGGAL</th><th style={{ width: 130 }}>MESIN / PEKERJAAN</th><th style={{ width: 80 }}>HASIL</th><th>TEMUAN</th><th>TINDAKAN</th><th style={{ width: 100 }}>TEKNISI</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td className="c">{i + 1}</td>
                <td>{tgl(r.tanggal)}</td>
                <td>{r.machine_nama}<div className="spec">{r.plan_judul ?? 'Checkup di luar jadwal'}</div></td>
                <td>{CHECKUP_RESULT[r.hasil as CheckupResult]}{r.repair_nomor ? <div className="spec">{r.repair_nomor}</div> : null}</td>
                <td className="pre">{r.temuan}</td>
                <td className="pre">{r.tindakan}{r.durasi_menit ? `\n(${r.durasi_menit} menit)` : ''}</td>
                <td>{r.dikerjakan_name}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="c">Belum ada checkup pada periode ini.</td></tr>}
          </tbody>
        </table>
        {due.length > 0 && (
          <>
            <h3>Jadwal perawatan jatuh tempo / terlambat (per {tgl(sampai)})</h3>
            <table className="pap-sheet-items">
              <thead><tr><th className="c">No</th><th>Mesin</th><th>Pekerjaan</th><th>Jatuh tempo</th><th>Checkup terakhir</th></tr></thead>
              <tbody>
                {due.map((p, i) => (
                  <tr key={i}><td className="c">{i + 1}</td><td>{p.mesin}</td><td>{p.judul}{p.komponen ? <div className="spec">{p.komponen}</div> : null}</td><td>{tgl(p.berikutnya)}</td><td>{tgl(p.terakhir) || '–'}</td></tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <table className="pap-sheet-sign">
          <tbody>
            <tr>
              <td><p>Dibuat oleh Teknik,</p><div className="space" /><p>(.........................)</p></td>
              <td><p>Mengetahui Kepala Produksi,</p><div className="space" /><p>(.........................)</p></td>
            </tr>
          </tbody>
        </table>
      </article>
    </main>
  )
}
