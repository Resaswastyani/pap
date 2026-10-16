import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ApiError } from '@/lib/api'
import { loadSettings } from '@/lib/hpp'
import { loadQuotation, loadQuotationItems, requireQuotation } from '@/lib/quotations'
import { getCurrentUser } from '@/lib/users'
import { PrintButton } from './print-button'

export const metadata: Metadata = { title: 'Surat Penawaran · PAP-MS' }

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const tanggal = (value: string) => {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}
const rp = (v: number, digits = 0) => `Rp ${v.toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`

// Surat penawaran siap cetak / simpan PDF (hanya untuk user yang boleh melihat penawaran ini)
export default async function CetakQuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  const { id } = await params
  let q
  try {
    requireQuotation(user)
    q = await loadQuotation(Number(id), user)
  } catch (error) {
    if (error instanceof ApiError) return <main className="pap-print-error">{error.message}</main>
    throw error
  }
  const [items, doc] = await Promise.all([loadQuotationItems(q.id), loadSettings('doc.')])
  const penandatangan = doc.penandatangan || q.created_name

  return (
    <main className="pap-print">
      <PrintButton />
      <article className="pap-sheet">
        <header className="pap-sheet-head">
          <img src="/logo-pap.png" alt="" />
          <div>
            <h1>{doc.nama || 'PT. Pandawa Amerta Packindo'}</h1>
            <p>Flexible Plastic Packaging Manufacture</p>
            {doc.alamat && <p>{doc.alamat}</p>}
            <p>{[doc.telepon && `Telp/WA ${doc.telepon}`, doc.email].filter(Boolean).join(' · ')}</p>
          </div>
        </header>
        <h2 className="pap-sheet-title">SURAT PENAWARAN HARGA</h2>
        <table className="pap-sheet-meta">
          <tbody>
            <tr><td>Nomor</td><td>: {q.nomor}</td><td>Tanggal</td><td>: {tanggal(q.tanggal)}</td></tr>
            <tr><td>Kepada</td><td>: <b>{q.kepada}</b></td><td>Berlaku s/d</td><td>: {tanggal(q.berlaku_sampai)}</td></tr>
            {(q.kontak || q.telepon) && <tr><td>Up.</td><td colSpan={3}>: {[q.kontak, q.telepon].filter(Boolean).join(' · ')}</td></tr>}
            {q.alamat && <tr><td>Alamat</td><td colSpan={3}>: {q.alamat}</td></tr>}
          </tbody>
        </table>
        <p>Dengan hormat,<br />Bersama ini kami sampaikan penawaran harga produk kemasan plastik sebagai berikut:</p>
        <table className="pap-sheet-items">
          <thead><tr><th>No</th><th>Produk & spesifikasi</th><th>Jumlah</th><th>Harga satuan</th><th>Jumlah harga</th></tr></thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={it.id}>
                <td className="c">{i + 1}</td>
                <td><b>{it.nama_produk}</b>{it.spesifikasi && <div className="spec">{it.spesifikasi}</div>}</td>
                <td className="r">{it.qty.toLocaleString('id-ID')} {it.satuan}</td>
                <td className="r">{rp(it.harga_satuan, it.harga_satuan % 1 ? 2 : 0)}</td>
                <td className="r">{rp(it.subtotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={4} className="r">Subtotal</td><td className="r">{rp(q.subtotal)}</td></tr>
            {q.pakai_ppn && <tr><td colSpan={4} className="r">PPN {q.ppn_persen}%</td><td className="r">{rp(q.ppn)}</td></tr>}
            <tr className="grand"><td colSpan={4} className="r">TOTAL</td><td className="r">{rp(q.total)}</td></tr>
          </tfoot>
        </table>
        {!q.pakai_ppn && <p className="pap-sheet-note">Harga belum termasuk PPN.</p>}
        {q.syarat && (
          <section>
            <h3>Syarat & ketentuan</h3>
            <ol>{q.syarat.split(/\r?\n/).filter((l: string) => l.trim()).map((l: string, i: number) => <li key={i}>{l.replace(/^\s*[-•\d.]+\s*/, '')}</li>)}</ol>
          </section>
        )}
        {doc.rekening && <section><h3>Pembayaran</h3><p className="pre">{doc.rekening}</p></section>}
        <p>Demikian penawaran ini kami sampaikan. Atas perhatian dan kerja samanya kami ucapkan terima kasih.</p>
        <div className="pap-sheet-sign">
          <p>Hormat kami,</p>
          <div className="space" />
          <p><b>{penandatangan}</b></p>
          <p>{doc.nama || 'PT. Pandawa Amerta Packindo'}</p>
        </div>
      </article>
    </main>
  )
}
