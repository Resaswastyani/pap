import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ApiError } from '@/lib/api'
import { invoiceDetail } from '@/lib/sales-invoices'
import { getCurrentUser } from '@/lib/users'
import { PrintButton } from '../../quotation/[id]/print-button'

export const metadata: Metadata = { title: 'Invoice · PAP-MS' }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const tgl = (s: string | null) => (s ? `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}` : '')
const num = (v: number) => v.toLocaleString('id-ID', { maximumFractionDigits: 2 })

// Invoice faktur penjualan (format sama dengan cetakan Accurate PT. Pandawa Amerta Packindo)
export default async function CetakFakturPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  if (!user.menus.includes('faktur-produksi' as never)) return <main className="pap-print-error">Anda tidak punya akses ke menu Faktur Produksi.</main>
  let f: Awaited<ReturnType<typeof invoiceDetail>>
  try {
    f = await invoiceDetail(Number((await params).id))
  } catch (error) {
    return <main className="pap-print-error">{error instanceof ApiError ? error.message : 'Faktur tidak bisa dimuat dari Accurate.'}</main>
  }
  const jumlah = f.sub_total - f.discount

  return (
    <main className="pap-print">
      <PrintButton />
      <article className="pap-sheet pap-invoice">
        <header className="pap-invoice-head">
          <div>
            <img src="/logo-pap.png" alt="PT. Pandawa Amerta Packindo" width={140} />
            <table className="pap-invoice-meta">
              <tbody>
                <tr><td>Nomor Invoice</td><td>: {f.number}</td></tr>
                <tr><td>Tanggal</td><td>: {tgl(f.tanggal)}</td></tr>
                <tr><td>No. Surat Jalan</td><td>: {f.do_numbers.join(', ')}</td></tr>
                <tr><td>No. PO</td><td>: {f.po_number || f.so_numbers.join(', ')}</td></tr>
              </tbody>
            </table>
          </div>
          <h1>INVOICE</h1>
          <div className="pap-invoice-customer">
            <p>Customer</p>
            <strong>{f.customer_name}</strong>
            <p className="pap-prewrap">{f.alamat}</p>
            <p className="tempo">Tempo Pembayaran <span>: {f.tempo_hari}</span></p>
          </div>
        </header>

        <table className="pap-invoice-items">
          <thead><tr><th style={{ width: 34 }}>No.</th><th>Nama Barang</th><th style={{ width: 80 }}>Quantity</th><th style={{ width: 70 }}>Satuan</th><th style={{ width: 110 }}>Harga @</th><th style={{ width: 150 }}>Jumlah</th></tr></thead>
          <tbody>
            {f.items.map((l, i) => (
              <tr key={l.id}>
                <td>{i + 1}</td>
                <td>{l.nama}{l.disc_pct ? ` (disc ${num(l.disc_pct)}%)` : ''}</td>
                <td className="r">{num(l.quantity)}</td>
                <td className="r">{l.unit}</td>
                <td className="r">{num(l.unit_price)}</td>
                <td className="r">{num(l.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {f.expenses.length > 0 && (
          <table className="pap-invoice-items pap-invoice-expense">
            <thead><tr><th>Nama Biaya</th><th style={{ width: 150 }}>Jumlah</th></tr></thead>
            <tbody>{f.expenses.map((e) => <tr key={e.id}><td>{e.nama}</td><td className="r">{num(e.amount)}</td></tr>)}</tbody>
          </table>
        )}

        <div className="pap-invoice-foot">
          <table className="pap-invoice-sign">
            <thead><tr><th>Diterima oleh</th><th>Dibuat Oleh</th></tr></thead>
            <tbody><tr><td /><td /></tr><tr className="name"><td /><td /></tr></tbody>
          </table>
          <table className="pap-invoice-total">
            <tbody>
              <tr><td>Jumlah</td><td>Rp.</td><td className="r">{num(jumlah)}</td></tr>
              <tr><td>PPN</td><td>Rp.</td><td className="r">{num(f.tax)}</td></tr>
              <tr className="total"><td>Total</td><td>Rp.</td><td className="r">{num(f.total)}</td></tr>
            </tbody>
          </table>
        </div>
        <p className="pap-invoice-page">Halaman 1 dari 1</p>
      </article>
    </main>
  )
}
