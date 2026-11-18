import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { capacityTotals, loadCapacities, loadCapacityInfo, loadUsage } from '@/lib/capacity'
import { loadSettings } from '@/lib/hpp'
import { getCurrentUser } from '@/lib/users'
import { PrintButton } from '../quotation/[id]/print-button'

export const metadata: Metadata = { title: 'Kapasitas Produksi · SIMPAP' }

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const tgl = (s: string | null) => (s ? `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}` : '')
const num = (n: number | null) => (n === null ? '–' : n.toLocaleString('id-ID', { maximumFractionDigits: 2 }))

// Dokumen "KAPASITAS PRODUKSI PAP – Non Mika" dari menu Kapasitas Produksi
export default async function CetakKapasitasPage({ searchParams }: { searchParams: Promise<{ tahun?: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  if (!user.menus.includes('kapasitas-produksi' as never)) return <main className="pap-print-error">Anda tidak punya akses ke menu Kapasitas Produksi.</main>
  const [items, info, doc] = await Promise.all([loadCapacities(), loadCapacityInfo(), loadSettings('doc.')])
  const totals = capacityTotals(items)
  const qTahun = Number((await searchParams).tahun)
  const tahun = Number.isInteger(qTahun) && qTahun >= 2000 && qTahun <= 2100 ? qTahun : new Date().getFullYear()
  const usage = await loadUsage(tahun, items)
  const periods = MONTHS.map((_, i) => `${tahun}-${String(i + 1).padStart(2, '0')}`)
  const adaUsage = periods.some((p) => usage.total[p].terisi)
  const lebar = (min: number | null, maks: number | null) =>
    min !== null && maks !== null ? `${num(min)} – ${num(maks)} cm` : maks !== null ? `s/d ${num(maks)} cm` : min !== null ? `min ${num(min)} cm` : '–'

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
        <h2 className="pap-sheet-title">{info.judul}</h2>
        <table className="pap-sheet-items">
          <thead><tr><th className="c" style={{ width: 34 }}>NO</th><th>JENIS PLASTIK</th><th>LEBAR MIN – MAKS</th><th>KAPASITAS MAKS</th><th>KAPASITAS EFEKTIF</th><th>MESIN</th></tr></thead>
          <tbody>
            {items.map((c, i) => (
              <tr key={c.id}>
                <td className="c">{i + 1}</td>
                <td>{c.jenis_plastik}</td>
                <td>{lebar(c.lebar_min_cm, c.lebar_maks_cm)}</td>
                <td>{num(c.kapasitas_maks_ton)} Ton</td>
                <td>{num(c.kapasitas_eff_ton)} Ton ({num(c.efisiensi_pct)}%)</td>
                <td>{c.jumlah_mesin} {c.mesin}{c.catatan ? <div className="spec">{c.catatan}</div> : null}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={3}><b>TOTAL</b></td>
              <td><b>{num(totals.maks)} Ton</b></td>
              <td><b>{num(totals.eff)} Ton</b></td>
              <td>{totals.per_jenis.map((j) => `${j.jenis_plastik}: ${num(j.eff)} Ton`).join(' · ')}</td>
            </tr>
          </tbody>
        </table>
        {adaUsage && (
          <>
            <h3>Kapasitas Terpakai per Bulan {tahun} (Ton)</h3>
            <table className="pap-sheet-items pap-sheet-usage">
              <thead><tr><th>MESIN</th><th>EFEKTIF</th>{MONTHS.map((m) => <th key={m}>{m.slice(0, 3).toUpperCase()}</th>)}</tr></thead>
              <tbody>
                {usage.items.map((r) => (
                  <tr key={r.capacity_id}>
                    <td>{r.jumlah_mesin > 1 ? `${r.jumlah_mesin} ` : ''}{r.mesin}<div className="spec">{r.jenis_plastik}</div></td>
                    <td>{num(r.kapasitas_eff_ton)}</td>
                    {periods.map((p) => {
                      const c = r.bulan[p]
                      return <td key={p}>{c ? <>{num(c.terpakai_ton)}<div className="spec">{r.kapasitas_eff_ton ? `${num(Math.round((c.terpakai_ton / r.kapasitas_eff_ton) * 1000) / 10)}%` : ''}</div></> : '–'}</td>
                    })}
                  </tr>
                ))}
                <tr>
                  <td><b>TOTAL</b></td>
                  <td><b>{num(usage.total[periods[0]].eff)}</b></td>
                  {periods.map((p) => {
                    const t = usage.total[p]
                    return <td key={p}>{t.terisi ? <><b>{num(t.terpakai)}</b><div className="spec">{t.pct === null ? '' : `${num(t.pct)}%`}</div></> : '–'}</td>
                  })}
                </tr>
              </tbody>
            </table>
          </>
        )}
        {info.catatan && (
          <>
            <h3>Catatan</h3>
            <ul>{info.catatan.split('\n').filter((l) => l.trim()).map((l, i) => <li key={i}>{l.replace(/^[-•]\s*/, '')}</li>)}</ul>
          </>
        )}
        {info.ttd.length > 0 && (
          <table className="pap-sheet-sign">
            <tbody>
              <tr><td colSpan={info.ttd.length}><p>Ttd{info.tanggal ? `, ${tgl(info.tanggal)}` : ''}</p></td></tr>
              <tr>{info.ttd.map((n) => <td key={n}><div className="space" /><p><u>{n}</u></p></td>)}</tr>
            </tbody>
          </table>
        )}
      </article>
    </main>
  )
}
