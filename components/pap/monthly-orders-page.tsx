'use client'

import { useEffect, useState } from 'react'
import { CircleDollarSign, Download, PhoneCall, Repeat, Search, ShoppingBag, UserPlus, Users } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { formatNumber, formatRupiah } from './accurate'
import { MonthNav, monthLabel } from './accurate-production'
import { api, formatDate, Modal, Notice, Pager, RowActions, usePaged } from './ui'

// Order Bulanan: customer yang order (Sales Order Accurate) dalam satu bulan
type OrderLine = { nama: string; qty: number; unit: string | null; harga: number }
type Order = { id: number; number: string; tanggal: string; total: number; status: string | null; items: OrderLine[] }
type CustomerOrders = {
  customer_id: number | null; accurate_id: number; name: string; customer_no: string | null; category: string | null; phone: string | null; crm_status: string | null
  baru: boolean; so_count: number; nilai: number; terakhir: string; pertama: string; orders: Order[]
}
type Belum = { customer_id: number; name: string; customer_no: string | null; phone: string | null; so_count: number; nilai: number; terakhir: string }
type Data = {
  periode: string; prev: string; customers: CustomerOrders[]; belum: Belum[]; months: string[]
  stats: { customer: number; so: number; nilai: number; baru: number; repeat: number; belum: number; prev: { customer: number; so: number; nilai: number } }
}
const short = (v: number) => (v >= 1e9 ? `Rp ${formatNumber(v / 1e9, 2)} M` : v >= 1e6 ? `Rp ${formatNumber(v / 1e6, 1)} jt` : formatRupiah(v))
const thisMonth = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7)
const waLink = (phone: string) => `https://wa.me/${phone.replace(/\D/g, '').replace(/^0/, '62')}`

export function MonthlyOrdersPage(_props: { user: UserProfile }) {
  const [periode, setPeriode] = useState(thisMonth())
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'order' | 'belum'>('order')
  const [jenis, setJenis] = useState<'' | 'baru' | 'repeat'>('')
  const [q, setQ] = useState('')
  const [detail, setDetail] = useState<CustomerOrders | null>(null)
  useEffect(() => {
    setData(null)
    api<Data>(`/api/orders/monthly?periode=${periode}`).then((r) => { setData(r); setError('') }).catch((e) => setError(e.message))
  }, [periode])
  const term = q.trim().toLowerCase()
  const customers = (data?.customers ?? []).filter((c) => (!jenis || (jenis === 'baru') === c.baru) && (!term || `${c.name} ${c.customer_no ?? ''} ${c.orders.map((o) => o.number).join(' ')}`.toLowerCase().includes(term)))
  const belum = (data?.belum ?? []).filter((b) => !term || `${b.name} ${b.customer_no ?? ''}`.toLowerCase().includes(term))
  const paged = usePaged(customers, `${periode}-${jenis}-${q}`, 50)
  const pagedBelum = usePaged(belum, `${periode}-${q}`, 50)
  const s = data?.stats
  const diff = (cur: number, prev: number) => (prev ? `${cur >= prev ? '▲' : '▼'} ${formatNumber(Math.abs(((cur - prev) / prev) * 100), 0)}% dari ${monthLabel(data!.prev)}` : '')

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">MARKETING · ACCURATE</p>
          <h1>Order Bulanan</h1>
          <span>Siapa saja customer yang order di bulan ini (Sales Order Accurate): customer baru vs repeat order, nilai, dan barang yang dipesan. Customer yang bulan lalu order tapi bulan ini belum bisa langsung di-follow up.</span>
        </div>
        <div className="pap-inline-actions pap-wrap">
          <MonthNav periode={periode} onChange={setPeriode} />
          <a className="pap-btn" href={`/api/orders/monthly?periode=${periode}&format=xlsx`}><Download /> Unduh Excel</a>
        </div>
      </div>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-stat-grid four">
        <button className={`pap-stat-card pap-stat-button ${tab === 'order' && !jenis ? 'active' : ''}`} onClick={() => { setTab('order'); setJenis('') }}>
          <div><span>Customer order {monthLabel(periode)}</span><strong className="pap-stat-text">{s?.customer ?? '…'}</strong><small className="neutral">{s ? `${s.so} SO · ${diff(s.customer, s.prev.customer) || 'bulan lalu belum ada data'}` : ''}</small></div>
          <div className="pap-stat-icon stat-1"><Users /></div>
        </button>
        <div className="pap-stat-card">
          <div><span>Nilai order</span><strong className="pap-stat-text">{s ? short(s.nilai) : '…'}</strong><small>{s ? diff(s.nilai, s.prev.nilai) : ''}</small></div>
          <div className="pap-stat-icon stat-0"><CircleDollarSign /></div>
        </div>
        <button className={`pap-stat-card pap-stat-button ${tab === 'order' && jenis ? 'active' : ''}`} onClick={() => { setTab('order'); setJenis(jenis === 'baru' ? 'repeat' : jenis === 'repeat' ? '' : 'baru') }}>
          <div><span>Customer baru / repeat</span><strong className="pap-stat-text">{s ? `${s.baru} / ${s.repeat}` : '…'}</strong><small className="neutral">{jenis === 'baru' ? 'Menampilkan customer baru' : jenis === 'repeat' ? 'Menampilkan repeat order' : 'Klik untuk menyaring'}</small></div>
          <div className="pap-stat-icon stat-1"><UserPlus /></div>
        </button>
        <button className={`pap-stat-card pap-stat-button ${tab === 'belum' ? 'active' : ''}`} onClick={() => setTab(tab === 'belum' ? 'order' : 'belum')}>
          <div><span>Belum order lagi</span><strong className="pap-stat-text">{s?.belum ?? '…'}</strong><small className="neutral">Order {data ? monthLabel(data.prev) : 'bulan lalu'}, bulan ini belum</small></div>
          <div className="pap-stat-icon stat-2"><PhoneCall /></div>
        </button>
      </div>

      <div className="pap-table-card">
        <div className="pap-card-head">
          <div className="pap-segmented" role="tablist">
            <button role="tab" aria-selected={tab === 'order'} className={tab === 'order' ? 'active' : ''} onClick={() => setTab('order')}><ShoppingBag /> Sudah order ({data?.customers.length ?? 0})</button>
            <button role="tab" aria-selected={tab === 'belum'} className={tab === 'belum' ? 'active' : ''} onClick={() => setTab('belum')}><Repeat /> Belum order lagi ({data?.belum.length ?? 0})</button>
          </div>
        </div>
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari customer / nomor SO..." /></label>
          {tab === 'order' && (
            <select className="pap-select" value={jenis} onChange={(e) => setJenis(e.target.value as typeof jenis)} aria-label="Jenis customer">
              <option value="">Semua customer</option><option value="baru">Customer baru</option><option value="repeat">Repeat order</option>
            </select>
          )}
        </div>
        <div className="pap-table-wrap">
          {tab === 'order' ? (
            <table>
              <thead><tr><th>Customer</th><th>Jenis</th><th className="pap-num">SO</th><th className="pap-num">Nilai</th><th>Order terakhir</th><th>Nomor SO</th><th className="pap-actions-col">Aksi</th></tr></thead>
              <tbody>
                {paged.items.map((c) => (
                  <tr key={c.accurate_id} className="pap-row-link" onClick={() => setDetail(c)}>
                    <td><div className="pap-cell-title">{c.name}</div><div className="pap-cell-sub">{[c.customer_no, c.category].filter(Boolean).join(' · ')}</div></td>
                    <td><span className={`pap-status ${c.baru ? 'success' : 'info'}`}>{c.baru ? 'Customer baru' : 'Repeat order'}</span></td>
                    <td className="pap-num">{c.so_count}</td>
                    <td className="pap-num pap-nowrap"><strong>{formatRupiah(c.nilai)}</strong></td>
                    <td className="pap-nowrap">{formatDate(c.terakhir)}</td>
                    <td><div className="pap-cell-sub">{c.orders.slice(0, 3).map((o) => o.number).join(', ')}{c.orders.length > 3 ? ` +${c.orders.length - 3}` : ''}</div></td>
                    <td className="pap-actions-cell"><RowActions label={c.name} onView={() => setDetail(c)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table>
              <thead><tr><th>Customer</th><th>Telepon</th><th className="pap-num">SO {data ? monthLabel(data.prev) : ''}</th><th className="pap-num">Nilai</th><th>Order terakhir</th></tr></thead>
              <tbody>
                {pagedBelum.items.map((b) => (
                  <tr key={b.customer_id}>
                    <td><div className="pap-cell-title">{b.name}</div><div className="pap-cell-sub">{b.customer_no}</div></td>
                    <td className="pap-nowrap">{b.phone ? <a href={waLink(b.phone)} target="_blank" rel="noreferrer">{b.phone}</a> : '—'}</td>
                    <td className="pap-num">{b.so_count}</td>
                    <td className="pap-num pap-nowrap">{formatRupiah(b.nilai)}</td>
                    <td className="pap-nowrap">{formatDate(b.terakhir)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {data && tab === 'order' && !customers.length && <div className="pap-empty">{q || jenis ? 'Tidak ada customer yang cocok.' : `Belum ada order di ${monthLabel(periode)}.`}</div>}
          {data && tab === 'belum' && !belum.length && <div className="pap-empty">Semua customer bulan lalu sudah order lagi.</div>}
          {!data && !error && <div className="pap-empty">Memuat order...</div>}
          {tab === 'order' ? <Pager {...paged.pager} noun="customer" /> : <Pager {...pagedBelum.pager} noun="customer" />}
        </div>
      </div>

      {detail && (
        <Modal title={detail.name} subtitle={`${[detail.customer_no, detail.category].filter(Boolean).join(' · ')} · ${detail.so_count} SO di ${monthLabel(periode)} · ${formatRupiah(detail.nilai)}`} wide onClose={() => setDetail(null)}
          footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={() => setDetail(null)}>Tutup</button></>}>
          <div className="pap-detail-badges">
            <span className={`pap-status ${detail.baru ? 'success' : 'info'}`}>{detail.baru ? 'Customer baru (order pertama)' : 'Repeat order'}</span>
            {detail.phone && <a className="pap-btn" href={waLink(detail.phone)} target="_blank" rel="noreferrer"><PhoneCall /> {detail.phone}</a>}
          </div>
          {detail.orders.map((o) => (
            <section key={o.id} className="pap-detail-section">
              <h3>{o.number} · {formatDate(o.tanggal)} · {formatRupiah(o.total)} {o.status && <span className="pap-muted">({o.status})</span>}</h3>
              {o.items.length ? (
                <div className="pap-table-wrap bordered">
                  <table>
                    <thead><tr><th>Barang</th><th className="pap-num">Qty</th><th className="pap-num">Harga</th><th className="pap-num">Jumlah</th></tr></thead>
                    <tbody>
                      {o.items.map((it, i) => (
                        <tr key={i}><td>{it.nama}</td><td className="pap-num pap-nowrap">{formatNumber(it.qty)} {it.unit ?? ''}</td><td className="pap-num pap-nowrap">{formatRupiah(it.harga)}</td><td className="pap-num pap-nowrap">{formatRupiah(it.qty * it.harga)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="pap-muted">Rincian barang belum disinkron dari Accurate.</p>}
            </section>
          ))}
        </Modal>
      )}
    </>
  )
}
