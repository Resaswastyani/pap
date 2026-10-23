import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import type { RowDataPacket } from 'mysql2'
import { db } from '@/lib/db'
import { loadSettings } from '@/lib/hpp'
import { serializeShipment, SHIPMENT_SELECT, shipmentItems } from '@/lib/logistik'
import { getCurrentUser } from '@/lib/users'
import { PrintButton } from '../../quotation/[id]/print-button'

export const metadata: Metadata = { title: 'Surat Jalan · PAP-MS' }

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const tgl = (s: string | null) => (s ? `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}` : '')
const num = (v: number) => v.toLocaleString('id-ID', { maximumFractionDigits: 2 })

// Surat Jalan pengiriman (menu Pengiriman)
export default async function SuratJalanPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  if (!user.menus.includes('pengiriman' as never)) return <main className="pap-print-error">Anda tidak punya akses ke menu Pengiriman.</main>
  const id = Number((await params).id)
  const [[row]] = await db.query<(RowDataPacket & Record<string, unknown>)[]>(`${SHIPMENT_SELECT} WHERE s.id = ?`, [id])
  if (!row) return <main className="pap-print-error">Pengiriman tidak ditemukan.</main>
  const s = serializeShipment(row)
  const items = await shipmentItems(id)
  const doc = await loadSettings('doc.')
  const totalKoli = items.reduce((t, i) => t + (i.koli ?? 0), 0)

  return (
    <main className="pap-print">
      <PrintButton hint="untuk menyimpan surat jalan" />
      <article className="pap-sheet pap-invoice pap-sj">
        <header className="pap-invoice-head">
          <div>
            <img src="/logo-pap.png" alt="PT. Pandawa Amerta Packindo" width={140} />
            <table className="pap-invoice-meta">
              <tbody>
                <tr><td>No. Surat Jalan</td><td>: {s.nomor}</td></tr>
                <tr><td>Tanggal</td><td>: {tgl(s.tanggal_kirim ?? s.rencana_kirim ?? s.created_at.slice(0, 10))}</td></tr>
                <tr><td>No. SO</td><td>: {s.so_numbers ?? ''}</td></tr>
                <tr><td>Ekspedisi</td><td>: {s.ekspedisi_nama ?? ''}{s.no_resi ? ` · Resi ${s.no_resi}` : ''}</td></tr>
              </tbody>
            </table>
          </div>
          <h1>SURAT JALAN</h1>
          <div className="pap-invoice-customer">
            <p>Kepada Yth.</p>
            <strong>{s.customer_name}</strong>
            <p className="pap-prewrap">{s.alamat ?? ''}</p>
            {s.telepon && <p>Telp: {s.telepon}</p>}
          </div>
        </header>

        <table className="pap-invoice-items">
          <thead><tr><th style={{ width: 34 }}>No.</th><th>Nama Barang</th><th style={{ width: 90 }}>Quantity</th><th style={{ width: 70 }}>Satuan</th><th style={{ width: 60 }}>Koli</th><th style={{ width: 170 }}>Keterangan</th></tr></thead>
          <tbody>
            {items.map((i, k) => (
              <tr key={i.id}>
                <td>{k + 1}</td><td>{i.item_name}</td><td className="r">{num(i.qty)}</td><td className="r">{i.unit ?? ''}</td><td className="r">{i.koli ?? ''}</td><td>{[i.so_number, i.catatan].filter(Boolean).join(' · ')}</td>
              </tr>
            ))}
            <tr><td colSpan={2}><b>Total</b></td><td className="r"><b>{s.berat_kg ? `${num(s.berat_kg)} kg` : ''}</b></td><td /><td className="r"><b>{s.koli ?? (totalKoli || '')}</b></td><td /></tr>
          </tbody>
        </table>
        {s.catatan && <p className="pap-sj-note">Catatan: {s.catatan}</p>}
        <p className="pap-sj-note">Barang telah diterima dalam keadaan baik dan jumlah sesuai. Mohon surat jalan ditandatangani dan dikembalikan.</p>

        <table className="pap-sheet-sign pap-sj-sign">
          <tbody>
            <tr>
              <td><p>Penerima,</p><div className="space" /><p>(.........................)</p></td>
              <td><p>Pengirim / Ekspedisi,</p><div className="space" /><p>({s.sopir ?? '.........................'})</p></td>
              <td><p>Hormat kami,</p><div className="space" /><p>{doc.nama || 'PT. Pandawa Amerta Packindo'}</p></td>
            </tr>
          </tbody>
        </table>
      </article>
    </main>
  )
}
