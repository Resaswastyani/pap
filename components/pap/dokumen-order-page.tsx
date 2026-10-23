'use client'

import { useEffect, useState } from 'react'
import { FileText, Printer, ReceiptText, Search } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { formatRupiah } from './accurate'
import { MonthNav, monthLabel, useDebounced } from './accurate-production'
import { api, Field, formatDate, Modal, Notice, Pager, usePaged } from './ui'

// Dokumen Order: Surat Order & Proforma Invoice dari Sales Order Accurate
type So = { id: number; number: string; tanggal: string; ship_date: string | null; status: string | null; total: number; customer_name: string | null; customer_no: string | null; baris: number; dp_persen: number | null; ekspedisi: string | null }
type Detail = { id: number; nomor: string; customer_name: string; total: number; terbayar: number; sisa: number; dp_persen: number | null; proforma_nomor: string; payment_term: string | null; items: unknown[] }
const STATUS_TONE: Record<string, string> = { 'Menunggu diproses': 'warning', 'Sebagian diproses': 'info', Terproses: 'success', Ditutup: 'neutral' }
const thisMonth = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7)

export function DokumenOrderPage(_props: { user: UserProfile }) {
  const [periode, setPeriode] = useState(thisMonth)
  const [status, setStatus] = useState('semua')
  const [q, setQ] = useState('')
  const query = useDebounced(q.trim())
  const [items, setItems] = useState<So[] | null>(null)
  const [error, setError] = useState('')
  const [proforma, setProforma] = useState<So | null>(null)
  useEffect(() => {
    let alive = true
    setItems(null)
    api<{ items: So[] }>(`/api/sales-orders?periode=${periode}&status=${status}${query ? `&q=${encodeURIComponent(query)}` : ''}`)
      .then((r) => alive && (setItems(r.items), setError('')))
      .catch((e) => alive && setError(e.message))
    return () => { alive = false }
  }, [periode, status, query])
  const paged = usePaged(items ?? [], `${periode}-${status}-${query}`, 50)
  const total = (items ?? []).reduce((t, s) => t + s.total, 0)

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">MARKETING · ACCURATE</p>
          <h1>Dokumen Order</h1>
          <span>Cetak Surat Order (konfirmasi pesanan) dan Proforma Invoice langsung dari Sales Order Accurate, lengkap dengan PPN, uang muka yang sudah diterima, dan rekening pembayaran. Bisa disimpan PDF atau diunduh Word.</span>
        </div>
      </div>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-table-card">
        <div className="pap-card-head">
          <div><h2>{query ? `Hasil cari "${query}"` : `Sales order ${monthLabel(periode)}`}</h2><p>{items ? `${items.length} SO · ${formatRupiah(total)}` : 'Memuat...'}</p></div>
          {!query && <MonthNav periode={periode} onChange={setPeriode} />}
        </div>
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nomor SO / customer (semua bulan)..." /></label>
          <select className="pap-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status SO">
            <option value="semua">Semua status</option><option value="terbuka">Belum selesai</option><option value="selesai">Terproses / ditutup</option>
          </select>
        </div>
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>SO</th><th>Customer</th><th>Kirim</th><th className="pap-num">Total</th><th>Status</th><th className="pap-actions-col">Dokumen</th></tr></thead>
            <tbody>
              {paged.items.map((s) => (
                <tr key={s.id}>
                  <td className="pap-nowrap"><div className="pap-cell-title">{s.number}</div><div className="pap-cell-sub">{formatDate(s.tanggal)} · {s.baris} barang</div></td>
                  <td>{s.customer_name ?? '—'}<div className="pap-cell-sub">{s.customer_no}{s.dp_persen ? ` · DP ${s.dp_persen}%` : ''}</div></td>
                  <td className="pap-nowrap">{formatDate(s.ship_date)}{s.ekspedisi && <div className="pap-cell-sub">{s.ekspedisi}</div>}</td>
                  <td className="pap-num pap-nowrap">{formatRupiah(s.total)}</td>
                  <td><span className={`pap-status ${STATUS_TONE[s.status ?? ''] ?? 'neutral'}`}>{s.status ?? '—'}</span></td>
                  <td className="pap-actions-cell">
                    <div className="pap-inline-actions">
                      <a className="pap-btn small" href={`/cetak/sales-order/${s.id}?jenis=order`} target="_blank" rel="noreferrer" title="Surat Order (konfirmasi pesanan)"><FileText /> Surat Order</a>
                      <button className="pap-btn small" onClick={() => setProforma(s)} title="Proforma Invoice"><ReceiptText /> Proforma</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {items && !items.length && <div className="pap-empty">{query ? 'Tidak ada SO yang cocok.' : `Belum ada SO di ${monthLabel(periode)}.`}</div>}
          {!items && !error && <div className="pap-empty">Memuat...</div>}
          <Pager {...paged.pager} noun="SO" />
        </div>
      </div>
      {proforma && <ProformaDialog so={proforma} onClose={() => setProforma(null)} />}
    </>
  )
}

// Pilih jumlah tagihan proforma: sisa setelah uang muka, DP x%, atau total
function ProformaDialog({ so, onClose }: { so: So; onClose: () => void }) {
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'dp' | 'total'>('dp')
  const [dp, setDp] = useState(String(so.dp_persen ?? 50))
  useEffect(() => {
    api<{ item: Detail }>(`/api/sales-orders/${so.id}`).then((r) => { setD(r.item); if (!r.item.dp_persen && !r.item.terbayar) setMode('total') }).catch((e) => setError(e.message))
  }, [so.id])
  const dpNum = Number(dp)
  const dpOk = Number.isFinite(dpNum) && dpNum > 0 && dpNum < 100
  const dpParam = d && d.terbayar > 0 ? '' : mode === 'total' ? '&dp=0' : dpOk ? `&dp=${dpNum}` : ''
  const tagihan = !d ? 0 : d.terbayar > 0 ? d.sisa : mode === 'dp' && dpOk ? Math.round((d.total * dpNum) / 100) : d.total
  return (
    <Modal title={`Proforma Invoice · ${so.number}`} subtitle={so.customer_name ?? undefined} onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Tutup</button>
        {d && <a className="pap-btn" href={`/api/sales-orders/${so.id}/word?jenis=proforma${dpParam}`}>Unduh Word</a>}
        {d && <a className="pap-primary-button" href={`/cetak/sales-order/${so.id}?jenis=proforma${dpParam}`} target="_blank" rel="noreferrer"><Printer /> Cetak / PDF</a>}</>}>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {!d && !error && <p className="pap-muted">Membaca SO dari Accurate...</p>}
      {d && (
        <div className="pap-form-grid">
          <dl className="pap-detail-grid full">
            <div><dt>Nomor proforma</dt><dd>{d.proforma_nomor}</dd></div>
            <div><dt>Total SO</dt><dd>{formatRupiah(d.total)}</dd></div>
            <div><dt>Uang muka diterima (Accurate)</dt><dd>{d.terbayar ? formatRupiah(d.terbayar) : '—'}</dd></div>
            <div><dt>Termin</dt><dd>{d.payment_term ?? '—'}</dd></div>
          </dl>
          {d.terbayar > 0 ? (
            <p className="pap-muted full">Sudah ada uang muka, proforma menagih sisa pembayaran.</p>
          ) : (
            <>
              <Field label="Yang ditagih">
                <select className="pap-select" value={mode} onChange={(e) => setMode(e.target.value as 'dp' | 'total')}>
                  <option value="dp">Uang muka (DP)</option><option value="total">Seluruh total</option>
                </select>
              </Field>
              {mode === 'dp' && <Field label="DP (%)" hint={d.dp_persen ? `Keterangan SO: DP ${d.dp_persen}%` : undefined}><input className="pap-input pap-num" type="number" min={1} max={99} value={dp} onChange={(e) => setDp(e.target.value)} /></Field>}
            </>
          )}
          <div className="pap-so-tagihan full"><span>Tagihan di proforma</span><strong>{formatRupiah(tagihan)}</strong></div>
        </div>
      )}
    </Modal>
  )
}
