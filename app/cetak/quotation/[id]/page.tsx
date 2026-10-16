import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ApiError } from '@/lib/api'
import { loadSettings } from '@/lib/hpp'
import { loadQuotation, loadQuotationItems, requireQuotation } from '@/lib/quotations'
import { getCurrentUser } from '@/lib/users'
import { PrintButton } from './print-button'

export const metadata: Metadata = { title: 'Dokumen Order · PAP-MS' }

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const tanggal = (value: string) => {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}
const rp = (v: number, digits = 0) => `Rp ${v.toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`

type Jenis = 'penawaran' | 'order' | 'proforma'
const JUDUL: Record<Jenis, string> = { penawaran: 'SURAT PENAWARAN HARGA', order: 'SURAT ORDER (KONFIRMASI PESANAN)', proforma: 'PROFORMA INVOICE' }

// Surat penawaran / surat order / proforma invoice siap cetak atau simpan PDF
export default async function CetakQuotationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ jenis?: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  const { id } = await params
  const raw = (await searchParams).jenis
  const jenis: Jenis = raw === 'order' || raw === 'proforma' ? raw : 'penawaran'
  let q
  try {
    requireQuotation(user)
    q = await loadQuotation(Number(id), user)
  } catch (error) {
    if (error instanceof ApiError) return <main className="pap-print-error">{error.message}</main>
    throw error
  }
  if (jenis !== 'penawaran' && !q.order_nomor) return <main className="pap-print-error">Surat order belum dibuat. Buka penawaran yang sudah Diterima lalu isi data order.</main>
  const [items, doc] = await Promise.all([loadQuotationItems(q.id), loadSettings('doc.')])
  const penandatangan = doc.penandatangan || q.created_name
  const nomor = jenis === 'order' ? q.order_nomor : jenis === 'proforma' ? q.proforma_nomor : q.nomor
  const tanggalDok = jenis === 'penawaran' ? q.tanggal : String(q.order_at ?? q.tanggal)
  const ongkir = jenis === 'penawaran' ? 0 : Number(q.ongkir ?? 0)
  const grand = q.total + ongkir
  const dp = q.dp_persen ? Math.round((grand * q.dp_persen) / 100) : null
  const tagihan = jenis === 'proforma' ? (q.terbayar > 0 ? Math.max(0, grand - q.terbayar) : dp ?? grand) : null

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
        <h2 className="pap-sheet-title">{JUDUL[jenis]}</h2>
        <table className="pap-sheet-meta">
          <tbody>
            <tr><td>Nomor</td><td>: {nomor}</td><td>Tanggal</td><td>: {tanggal(tanggalDok)}</td></tr>
            <tr>
              <td>Kepada</td><td>: <b>{q.kepada}</b></td>
              {jenis === 'penawaran' ? <><td>Berlaku s/d</td><td>: {tanggal(q.berlaku_sampai)}</td></> : <><td>Ref. penawaran</td><td>: {q.nomor}</td></>}
            </tr>
            {(q.kontak || q.telepon) && <tr><td>Up.</td><td colSpan={3}>: {[q.kontak, q.telepon].filter(Boolean).join(' · ')}</td></tr>}
            {q.alamat && <tr><td>Alamat</td><td colSpan={3}>: {q.alamat}</td></tr>}
            {jenis !== 'penawaran' && q.tanggal_kirim && <tr><td>Rencana kirim</td><td colSpan={3}>: {tanggal(q.tanggal_kirim)}{q.expedition_name ? ` · via ${q.expedition_name}` : ''}</td></tr>}
          </tbody>
        </table>
        <p>
          {jenis === 'penawaran' && <>Dengan hormat,<br />Bersama ini kami sampaikan penawaran harga produk kemasan plastik sebagai berikut:</>}
          {jenis === 'order' && <>Dengan hormat,<br />Terima kasih atas kepercayaan Anda. Berikut konfirmasi pesanan yang akan kami produksi:</>}
          {jenis === 'proforma' && <>Dengan hormat,<br />Berikut tagihan sementara (proforma) atas pesanan Anda:</>}
        </p>
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
            {ongkir > 0 && <tr><td colSpan={4} className="r">Ongkos kirim</td><td className="r">{rp(ongkir)}</td></tr>}
            <tr className="grand"><td colSpan={4} className="r">TOTAL</td><td className="r">{rp(grand)}</td></tr>
            {jenis !== 'penawaran' && q.terbayar > 0 && <tr><td colSpan={4} className="r">Sudah dibayar</td><td className="r">- {rp(q.terbayar)}</td></tr>}
            {jenis === 'proforma' && tagihan !== null && <tr className="grand"><td colSpan={4} className="r">{q.terbayar > 0 ? 'SISA TAGIHAN' : dp ? `DP ${q.dp_persen}% YANG HARUS DIBAYAR` : 'TAGIHAN'}</td><td className="r">{rp(tagihan)}</td></tr>}
          </tfoot>
        </table>
        {!q.pakai_ppn && <p className="pap-sheet-note">Harga belum termasuk PPN.</p>}
        {jenis !== 'penawaran' && q.catatan_order && <section><h3>Catatan pesanan</h3><p className="pre">{q.catatan_order}</p></section>}
        {jenis === 'order' && dp && <p>Pembayaran: DP {q.dp_persen}% sebesar <b>{rp(dp)}</b> sebelum produksi dimulai, pelunasan sebelum barang dikirim.</p>}
        {q.syarat && jenis !== 'proforma' && (
          <section>
            <h3>Syarat & ketentuan</h3>
            <ol>{q.syarat.split(/\r?\n/).filter((l: string) => l.trim()).map((l: string, i: number) => <li key={i}>{l.replace(/^\s*[-•\d.]+\s*/, '')}</li>)}</ol>
          </section>
        )}
        {doc.rekening && <section><h3>Pembayaran ke</h3><p className="pre">{doc.rekening}</p></section>}
        {jenis === 'order' && (
          <div className="pap-sheet-sign two">
            <div><p>Disetujui pemesan,</p><div className="space" /><p><b>{q.kontak || '(.........................)'}</b></p><p>{q.kepada}</p></div>
            <div><p>Hormat kami,</p><div className="space" /><p><b>{penandatangan}</b></p><p>{doc.nama || 'PT. Pandawa Amerta Packindo'}</p></div>
          </div>
        )}
        {jenis !== 'order' && (
          <>
            <p>{jenis === 'proforma' ? 'Mohon lakukan pembayaran ke rekening di atas dan kirimkan bukti transfer kepada kami.' : 'Demikian penawaran ini kami sampaikan. Atas perhatian dan kerja samanya kami ucapkan terima kasih.'}</p>
            <div className="pap-sheet-sign">
              <p>Hormat kami,</p>
              <div className="space" />
              <p><b>{penandatangan}</b></p>
              <p>{doc.nama || 'PT. Pandawa Amerta Packindo'}</p>
            </div>
          </>
        )}
      </article>
    </main>
  )
}
