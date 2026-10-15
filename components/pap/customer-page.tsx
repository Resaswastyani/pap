'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, FileText, Mail, MapPin, Pencil, Phone, Plus, Repeat, Search, UserMinus, UserPlus, Users } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { AccurateSyncBar, formatRupiah } from './accurate'
import { ProductDetail, ProductForm, type Product } from './product-page'
import { api, Field, formatDate, Modal, Notice } from './ui'

type CrmStatus = 'pelanggan' | 'pembeli' | 'prospek' | 'pelanggan_nonaktif' | 'pembeli_nonaktif'
type Customer = {
  id: number
  accurate_id: number | null
  customer_no: string | null
  name: string
  category: string | null
  email: string | null
  mobile_phone: string | null
  work_phone: string | null
  bill_street: string | null
  bill_city: string | null
  bill_province: string | null
  bill_zip: string | null
  npwp_no: string | null
  notes: string | null
  suspended: number
  synced_at: string | null
  order_count: number
  first_order: string | null
  last_order: string | null
  total_amount: number
  product_count: number
  crm_status: CrmStatus
}
type Invoice = { accurate_id: number; number: string | null; trans_date: string | null; total_amount: number | null; status: string | null }
type CustomerProduct = { id: number; kode: string | null; nama: string; jenis: string | null; status: string; file_count: number; last_order: string | null }

const CRM_LABEL: Record<CrmStatus, string> = {
  pelanggan: 'Pelanggan',
  pembeli: 'Pembeli',
  prospek: 'Prospek',
  pelanggan_nonaktif: 'Pelanggan nonaktif',
  pembeli_nonaktif: 'Pembeli nonaktif',
}
const CRM_TONE: Record<CrmStatus, string> = { pelanggan: 'success', pembeli: 'info', prospek: 'neutral', pelanggan_nonaktif: 'warning', pembeli_nonaktif: 'danger' }
const CrmBadge = ({ value }: { value: CrmStatus }) => <span className={`pap-status ${CRM_TONE[value]}`}>{CRM_LABEL[value]}</span>

export function CustomerPage({ user }: { user: UserProfile }) {
  const [items, setItems] = useState<Customer[]>([])
  const [summary, setSummary] = useState<Record<CrmStatus, number>>({ pelanggan: 0, pembeli: 0, prospek: 0, pelanggan_nonaktif: 0, pembeli_nonaktif: 0 })
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [inactiveDays, setInactiveDays] = useState(180)
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [form, setForm] = useState<Customer | 'new' | null>(null)
  const [detailId, setDetailId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page) })
      if (q.trim()) params.set('q', q.trim())
      if (status) params.set('status', status)
      const res = await api<{ items: Customer[]; summary: Record<CrmStatus, number>; total: number; pageSize: number; inactiveDays: number; canManage: boolean }>(`/api/customers?${params}`)
      setItems(res.items)
      setSummary(res.summary)
      setTotal(res.total)
      setPageSize(res.pageSize)
      setInactiveDays(res.inactiveDays)
      setCanManage(res.canManage)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [q, status, page])

  useEffect(() => {
    const timer = setTimeout(load, q ? 300 : 0)
    return () => clearTimeout(timer)
  }, [load, q])
  useEffect(() => setPage(1), [q, status])

  const flash = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 5000)
  }

  const stats: [CrmStatus | 'nonaktif', string, number, string, typeof Users, string][] = [
    ['pelanggan', 'Pelanggan', summary.pelanggan, 'Repeat order (≥ 2 faktur)', Repeat, 'stat-0'],
    ['pembeli', 'Pembeli', summary.pembeli, 'Baru 1 kali order', UserPlus, 'stat-1'],
    ['prospek', 'Prospek', summary.prospek, 'Belum ada transaksi', Users, 'stat-1'],
    ['nonaktif', 'Nonaktif', summary.pelanggan_nonaktif + summary.pembeli_nonaktif, `Tidak order > ${inactiveDays} hari`, UserMinus, 'stat-2'],
  ]
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">MARKETING</p>
          <h1>Customer</h1>
          <span>Data pelanggan dari Accurate Online beserta status CRM: repeat order, pembeli, prospek, dan nonaktif.</span>
        </div>
        {canManage && <button className="pap-primary-button" onClick={() => setForm('new')}><Plus /> Tambah customer</button>}
      </div>
      <AccurateSyncBar entities={['customer', 'sales-invoice', 'customer-detail']} canSync={canManage || user.role.isAdmin} onSynced={load} />
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      <div className="pap-stat-grid four">
        {stats.map(([key, label, value, note, Icon, tone]) => (
          <button
            key={key}
            className={`pap-stat-card pap-stat-button ${status === key || (key === 'nonaktif' && status.endsWith('nonaktif')) ? 'active' : ''}`}
            onClick={() => setStatus((current) => (key === 'nonaktif' ? (current === 'pelanggan_nonaktif' ? 'pembeli_nonaktif' : current === 'pembeli_nonaktif' ? '' : 'pelanggan_nonaktif') : current === key ? '' : key))}
          >
            <div><span>{label}</span><strong>{value}</strong><small className="neutral">{note}</small></div>
            <div className={`pap-stat-icon ${tone}`}><Icon /></div>
          </button>
        ))}
      </div>
      <div className="pap-table-card">
        <div className="pap-card-head"><div><h2>Daftar customer</h2><p>Diurutkan dari transaksi terakhir. Status nonaktif bila tidak ada faktur lebih dari {inactiveDays} hari.</p></div></div>
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama, nomor, kota, email..." /></label>
          <select className="pap-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter status CRM">
            <option value="">Semua status</option>
            {Object.entries(CRM_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>
        {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Customer</th><th>Kontak</th><th>Transaksi</th><th>Status</th><th>Produk</th></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="pap-row-link" onClick={() => setDetailId(item.id)}>
                  <td><div className="pap-cell-title">{item.name}</div><div className="pap-cell-sub">{item.customer_no ?? 'Belum ada nomor'}{item.category ? ` · ${item.category}` : ''}</div></td>
                  <td><div className="pap-cell-sub">{item.mobile_phone ?? item.work_phone ?? '—'}</div><div className="pap-cell-sub">{item.email ?? ''}</div></td>
                  <td className="pap-nowrap">{item.order_count ? <><strong>{item.order_count}×</strong> · {formatDate(item.last_order)}</> : <span className="pap-muted">Belum ada</span>}</td>
                  <td><CrmBadge value={item.crm_status} /></td>
                  <td className="pap-nowrap">{item.product_count ? `${item.product_count} produk` : <span className="pap-muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !items.length && <div className="pap-empty">{q || status ? 'Tidak ada customer yang cocok dengan filter.' : 'Belum ada data customer. Klik "Sinkron sekarang" untuk mengambil dari Accurate.'}</div>}
          {loading && !items.length && <div className="pap-empty">Memuat customer...</div>}
        </div>
        {total > pageSize && (
          <div className="pap-pager">
            <span>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} dari {total}</span>
            <button className="pap-icon-button" aria-label="Sebelumnya" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft /></button>
            <button className="pap-icon-button" aria-label="Berikutnya" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}><ChevronRight /></button>
          </div>
        )}
      </div>
      {form && (
        <CustomerForm
          initial={form === 'new' ? null : form}
          onClose={() => setForm(null)}
          onSaved={(text, id) => { setForm(null); flash(text); load(); if (id) setDetailId(id) }}
        />
      )}
      {detailId && (
        <CustomerDetail
          id={detailId}
          onClose={() => setDetailId(null)}
          onEdit={(item) => { setDetailId(null); setForm(item) }}
          onChanged={load}
        />
      )}
    </>
  )
}

function CustomerForm({ initial, onClose, onSaved }: { initial: Customer | null; onClose: () => void; onSaved: (message: string, id?: number) => void }) {
  const [values, setValues] = useState({
    name: initial?.name ?? '',
    email: initial?.email ?? '',
    mobile_phone: initial?.mobile_phone ?? '',
    work_phone: initial?.work_phone ?? '',
    bill_street: initial?.bill_street ?? '',
    bill_city: initial?.bill_city ?? '',
    bill_province: initial?.bill_province ?? '',
    bill_zip: initial?.bill_zip ?? '',
    npwp_no: initial?.npwp_no ?? '',
    notes: initial?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (key: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (initial) {
        await api(`/api/customers/${initial.id}`, { method: 'PATCH', json: values })
        onSaved('Customer diperbarui di Accurate dan PAP-MS.')
      } else {
        const res = await api<{ id: number }>('/api/customers', { method: 'POST', json: values })
        onSaved('Customer ditambahkan ke Accurate dan PAP-MS.', res.id)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      wide
      title={initial ? 'Edit customer' : 'Tambah customer'}
      subtitle={initial ? `${initial.customer_no ?? ''} · perubahan langsung disimpan ke Accurate Online` : 'Customer baru akan dibuat di Accurate Online'}
      onClose={onClose}
      footer={<><button type="button" className="pap-btn" onClick={onClose}>Batal</button><button type="submit" form="customer-form" className="pap-primary-button" disabled={saving}>{saving ? 'Menyimpan ke Accurate...' : 'Simpan'}</button></>}
    >
      <form id="customer-form" className="pap-form-grid" onSubmit={submit}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Nama customer" full><input className="pap-input" required maxLength={255} value={values.name} onChange={set('name')} /></Field>
        <Field label="Email"><input className="pap-input" type="email" maxLength={255} value={values.email} onChange={set('email')} /></Field>
        <Field label="No. HP"><input className="pap-input" maxLength={80} value={values.mobile_phone} onChange={set('mobile_phone')} /></Field>
        <Field label="No. telepon kantor"><input className="pap-input" maxLength={80} value={values.work_phone} onChange={set('work_phone')} /></Field>
        <Field label="NPWP"><input className="pap-input" maxLength={50} value={values.npwp_no} onChange={set('npwp_no')} /></Field>
        <Field label="Alamat" full><textarea className="pap-input" rows={2} maxLength={500} value={values.bill_street} onChange={set('bill_street')} /></Field>
        <Field label="Kota"><input className="pap-input" maxLength={150} value={values.bill_city} onChange={set('bill_city')} /></Field>
        <Field label="Provinsi"><input className="pap-input" maxLength={150} value={values.bill_province} onChange={set('bill_province')} /></Field>
        <Field label="Kode pos"><input className="pap-input" maxLength={20} value={values.bill_zip} onChange={set('bill_zip')} /></Field>
        <Field label="Catatan" full><textarea className="pap-input" rows={3} maxLength={5000} value={values.notes} onChange={set('notes')} /></Field>
      </form>
    </Modal>
  )
}

function CustomerDetail({ id, onClose, onEdit, onChanged }: { id: number; onClose: () => void; onEdit: (item: Customer) => void; onChanged: () => void }) {
  const [item, setItem] = useState<Customer | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [products, setProducts] = useState<CustomerProduct[]>([])
  const [can, setCan] = useState({ edit: false, product: false })
  const [error, setError] = useState('')
  const [productForm, setProductForm] = useState<Product | 'new' | null>(null)
  const [productId, setProductId] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await api<{ item: Customer; invoices: Invoice[]; products: CustomerProduct[]; can: { edit: boolean; product: boolean } }>(`/api/customers/${id}`)
      setItem(res.item)
      setInvoices(res.invoices)
      setProducts(res.products)
      setCan(res.can)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [id])
  useEffect(() => { load() }, [load])

  if (!item) return <Modal title="Detail customer" onClose={onClose}>{error ? <Notice>{error}</Notice> : <p className="pap-muted">Memuat...</p>}</Modal>
  const address = [item.bill_street, item.bill_city, item.bill_province, item.bill_zip].filter(Boolean).join(', ')
  const reload = () => { load(); onChanged() }

  return (
    <Modal
      wide
      title={item.name}
      subtitle={`${item.customer_no ?? 'Tanpa nomor'}${item.category ? ` · ${item.category}` : ''}`}
      onClose={onClose}
      footer={can.edit ? <><span className="pap-spacer" /><button className="pap-btn" onClick={() => onEdit(item)}><Pencil /> Edit customer</button></> : undefined}
    >
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-detail-badges"><CrmBadge value={item.crm_status} />{item.suspended ? <span className="pap-status danger">Nonaktif di Accurate</span> : null}</div>
      <dl className="pap-detail-grid">
        <div><dt>Kontak</dt><dd>{item.mobile_phone || item.work_phone ? <><Phone className="pap-inline-icon" /> {[item.mobile_phone, item.work_phone].filter(Boolean).join(' / ')}</> : '—'}</dd></div>
        <div><dt>Email</dt><dd>{item.email ? <a href={`mailto:${item.email}`}><Mail className="pap-inline-icon" /> {item.email}</a> : '—'}</dd></div>
        <div><dt>Alamat</dt><dd>{address ? <><MapPin className="pap-inline-icon" /> {address}</> : '—'}</dd></div>
        <div><dt>NPWP</dt><dd>{item.npwp_no ?? '—'}</dd></div>
        <div><dt>Jumlah transaksi</dt><dd>{item.order_count} faktur · {formatRupiah(item.total_amount)}</dd></div>
        <div><dt>Order pertama / terakhir</dt><dd>{item.first_order ? `${formatDate(item.first_order)} – ${formatDate(item.last_order)}` : 'Belum ada transaksi'}</dd></div>
      </dl>
      {item.notes && <section className="pap-detail-section"><h3>Catatan</h3><p className="pap-prewrap">{item.notes}</p></section>}
      <section className="pap-detail-section">
        <div className="pap-section-head">
          <h3>Produk ({products.length})</h3>
          {can.product && <button className="pap-btn" onClick={() => setProductForm('new')}><Plus /> Tambah produk</button>}
        </div>
        {products.length > 0 ? (
          <ul className="pap-linked-list">
            {products.map((p) => (
              <li key={p.id}>
                <button onClick={() => setProductId(p.id)}>
                  <FileText />
                  <span className="pap-linked-main"><strong>{p.nama}</strong><small>{[p.kode, p.jenis, p.last_order ? `dipesan ${formatDate(p.last_order)}` : null, `${p.file_count} desain`].filter(Boolean).join(' · ')}</small></span>
                  {p.status === 'nonaktif' && <span className="pap-status neutral">Nonaktif</span>}
                  <ChevronRight />
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="pap-muted">Belum ada data produk untuk customer ini.</p>}
      </section>
      <section className="pap-detail-section">
        <h3>Faktur terakhir ({invoices.length})</h3>
        {invoices.length > 0 ? (
          <div className="pap-table-wrap pap-compact-table">
            <table>
              <thead><tr><th>No. faktur</th><th>Tanggal</th><th>Nilai</th><th>Status</th></tr></thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.accurate_id}><td>{inv.number ?? '—'}</td><td className="pap-nowrap">{formatDate(inv.trans_date)}</td><td className="pap-nowrap">{formatRupiah(inv.total_amount)}</td><td>{inv.status ?? '—'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="pap-muted">Belum ada faktur penjualan di Accurate.</p>}
      </section>
      {productForm && (
        <ProductForm
          initial={productForm === 'new' ? null : productForm}
          customer={{ id: item.id, name: item.name, customer_no: item.customer_no, bill_city: item.bill_city }}
          onClose={() => setProductForm(null)}
          onSaved={(_text, newId) => { setProductForm(null); reload(); if (newId) setProductId(newId) }}
        />
      )}
      {productId && (
        <ProductDetail
          id={productId}
          onClose={() => setProductId(null)}
          onEdit={(p) => { setProductId(null); setProductForm(p) }}
          onChanged={reload}
          onDeleted={() => { setProductId(null); reload() }}
        />
      )}
    </Modal>
  )
}
