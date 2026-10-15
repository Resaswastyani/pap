'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileText, ImageIcon, Package, Pencil, Plus, Printer, Search, Trash2, Upload } from 'lucide-react'
import { PRODUCT_FILE_ACCEPT, PRODUCT_FILE_MAX_BYTES } from '@/lib/permissions'
import type { UserProfile } from '@/lib/users'
import { AccurateSyncBar, formatNumber, formatRupiah } from './accurate'
import { api, Field, formatDate, formatSize, Modal, Notice } from './ui'

export type Product = {
  id: number
  customer_id: number | null
  customer_name: string | null
  customer_no: string | null
  accurate_item_id: number | null
  last_order: string | null
  customer_count: number
  stock: number | null
  unit: string | null
  kode: string | null
  nama: string
  jenis: string | null
  spesifikasi: string | null
  bahan: string | null
  keterangan: string | null
  status: 'aktif' | 'nonaktif'
  created_by_name: string
  updated_by_name: string | null
  created_at: string
  updated_at: string
  file_count: number
}
type Buyer = { id: number; name: string; customer_no: string | null; order_count: number; last_order: string | null }
type OrderLine = { number: string | null; trans_date: string | null; status: string | null; customer_id: number | null; customer_name: string | null; quantity: number | null; unit: string | null; unit_price: number | null; notes: string | null }
type ProductFile = { id: number; name: string; mime: string; size: number; uploaded_by_name: string; created_at: string }
type CustomerOption = { id: number; name: string; customer_no: string | null; bill_city: string | null }

const JENIS_DEFAULT = ['HD', 'PP', 'PE', 'Mika rigid', 'Plastik laundry', 'Lainnya']
const ACCEPT = PRODUCT_FILE_ACCEPT.join(',')

function validateFile(file: File) {
  if (!(PRODUCT_FILE_ACCEPT as readonly string[]).includes(file.type)) return `${file.name}: format harus PDF atau gambar (JPG/PNG/WEBP).`
  if (file.size > PRODUCT_FILE_MAX_BYTES) return `${file.name}: ukuran maksimal 4 MB. Kompres PDF terlebih dahulu.`
  return ''
}

// Unggah satu per satu (batas ukuran request server)
async function uploadFiles(productId: number, files: File[]) {
  const failed: string[] = []
  for (const file of files) {
    const form = new FormData()
    form.append('files', file)
    try {
      await api(`/api/products/${productId}/files`, { method: 'POST', body: form })
    } catch (e) {
      failed.push(`${file.name}: ${(e as Error).message}`)
    }
  }
  return failed
}

const esc = (value: string | null | undefined) => (value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

// Lembar spesifikasi siap cetak untuk arsip produksi
function printSpecSheet(item: Product, files: ProductFile[]) {
  const win = window.open('', '_blank')
  if (!win) return
  const section = (title: string, value: string | null) => `<h3>${title}</h3><div class="box">${value ? esc(value).replace(/\n/g, '<br>') : '<i>—</i>'}</div>`
  win.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Spesifikasi ${esc(item.nama)}</title>
<style>body{font:13px/1.5 system-ui,sans-serif;color:#111;margin:32px}h1{margin:0;font-size:20px}h3{margin:18px 0 6px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#555}
.meta{display:grid;grid-template-columns:repeat(2,1fr);gap:6px 24px;margin-top:14px}.meta div span{display:block;color:#666;font-size:11px}.box{padding:10px 12px;border:1px solid #ccc;border-radius:6px;min-height:28px}
.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:12px}.head img{height:44px}ul{margin:0;padding-left:18px}
@media print{body{margin:12mm}}</style></head><body>
<div class="head"><div><h1>${esc(item.nama)}</h1><div>${esc(item.customer_name)}${item.kode ? ` · ${esc(item.kode)}` : ''}</div></div><img src="/logo-pap.png" alt=""></div>
<div class="meta"><div><span>Customer utama</span>${esc(item.customer_name) || '—'}${item.customer_no ? ` (${esc(item.customer_no)})` : ''}</div><div><span>Jenis</span>${esc(item.jenis) || '—'}</div>
<div><span>Kode barang</span>${esc(item.kode) || '—'}</div><div><span>Diperbarui</span>${esc(formatDate(item.updated_at, true))}${item.updated_by_name ? ` oleh ${esc(item.updated_by_name)}` : ''}</div></div>
${section('Spesifikasi', item.spesifikasi)}${section('Keterangan bahan', item.bahan)}${section('Keterangan lain', item.keterangan)}
<h3>Lampiran desain</h3><div class="box">${files.length ? `<ul>${files.map((f) => `<li>${esc(f.name)}</li>`).join('')}</ul>` : '<i>Tidak ada lampiran</i>'}</div>
<p style="margin-top:24px;color:#777;font-size:11px">Dicetak dari PAP-MS · ${esc(new Date().toLocaleString('id-ID'))}</p>
<script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`)
  win.document.close()
}

export function ProductPage({ user, focusId }: { user: UserProfile; focusId?: number | null }) {
  const [items, setItems] = useState<Product[]>([])
  const [jenisList, setJenisList] = useState<string[]>(JENIS_DEFAULT)
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [q, setQ] = useState('')
  const [jenis, setJenis] = useState('')
  const [status, setStatus] = useState('aktif')
  const [incomplete, setIncomplete] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [form, setForm] = useState<Product | 'new' | null>(null)
  const [detailId, setDetailId] = useState<number | null>(focusId ?? null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page) })
      if (q.trim()) params.set('q', q.trim())
      if (jenis) params.set('jenis', jenis)
      if (status) params.set('status', status)
      if (incomplete) params.set('lengkap', '0')
      const res = await api<{ items: Product[]; jenis: string[]; canManage: boolean; total: number; pageSize: number }>(`/api/products?${params}`)
      setItems(res.items)
      setJenisList(res.jenis)
      setCanManage(res.canManage)
      setTotal(res.total)
      setPageSize(res.pageSize)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [q, jenis, status, incomplete, page])
  useEffect(() => setPage(1), [q, jenis, status, incomplete])
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  useEffect(() => {
    const timer = setTimeout(load, q ? 300 : 0)
    return () => clearTimeout(timer)
  }, [load, q])

  const flash = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 5000)
  }

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">PRODUK</p>
          <h1>Data Produk</h1>
          <span>Produk dari barang yang dipesan customer di Accurate (Sales Order). Lengkapi spesifikasi, bahan, dan desain sebagai acuan PPIC & Produksi.</span>
        </div>
        {canManage && <button className="pap-primary-button" onClick={() => setForm('new')}><Plus /> Tambah produk</button>}
      </div>
      <AccurateSyncBar entities={['sales-order', 'sales-order-items']} canSync={canManage || user.role.isAdmin} onSynced={load} />
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      <div className="pap-table-card">
        <div className="pap-card-head"><div><h2>Daftar produk ({total})</h2><p>Diurutkan dari pesanan terakhir · klik produk untuk melihat spesifikasi, desain, dan riwayat pesanan</p></div></div>
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari produk, kode, customer, bahan..." /></label>
          <select className="pap-select" value={jenis} onChange={(e) => setJenis(e.target.value)} aria-label="Filter jenis">
            <option value="">Semua jenis</option>
            {jenisList.map((j) => <option key={j} value={j}>{j}</option>)}
          </select>
          <select className="pap-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter status">
            <option value="aktif">Produk aktif</option>
            <option value="nonaktif">Produk nonaktif</option>
            <option value="">Semua status</option>
          </select>
          <label className="pap-check"><input type="checkbox" checked={incomplete} onChange={(e) => setIncomplete(e.target.checked)} /> Belum ada spesifikasi / desain</label>
        </div>
        {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Produk</th><th>Customer</th><th>Jenis</th><th className="pap-num">Stok</th><th>Pesanan terakhir</th><th>Desain</th></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="pap-row-link" onClick={() => setDetailId(item.id)}>
                  <td><div className="pap-cell-title">{item.nama}</div><div className="pap-cell-sub">{item.kode ?? 'Tanpa kode'}{item.accurate_item_id ? <span className="pap-chip">Accurate</span> : <span className="pap-chip">Manual</span>}{item.status === 'nonaktif' && <span className="pap-chip">nonaktif</span>}</div></td>
                  <td>{item.customer_name ?? <span className="pap-muted">—</span>}{item.customer_count > 1 && <div className="pap-cell-sub">+{item.customer_count - 1} customer lain</div>}</td>
                  <td>{item.jenis ?? '—'}</td>
                  <td className="pap-num pap-nowrap">{item.stock === null ? '—' : `${formatNumber(item.stock)} ${item.unit ?? ''}`}</td>
                  <td className="pap-nowrap">{item.last_order ? formatDate(item.last_order) : <span className="pap-muted">—</span>}</td>
                  <td className="pap-nowrap">{item.file_count ? <><FileText className="pap-inline-icon" /> {item.file_count}</> : <span className="pap-muted">{item.spesifikasi ? '—' : 'Belum lengkap'}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !items.length && <div className="pap-empty">{q || jenis || incomplete ? 'Tidak ada produk yang cocok dengan filter.' : 'Belum ada produk. Klik "Sinkron sekarang" untuk mengambil dari Sales Order Accurate.'}</div>}
          {loading && !items.length && <div className="pap-empty">Memuat produk...</div>}
        </div>
        {total > pageSize && (
          <div className="pap-pager">
            <span>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} dari {total}</span>
            <button className="pap-icon-button" aria-label="Sebelumnya" disabled={page <= 1} onClick={() => setPage((v) => v - 1)}><ChevronLeft /></button>
            <button className="pap-icon-button" aria-label="Berikutnya" disabled={page >= pageCount} onClick={() => setPage((v) => v + 1)}><ChevronRight /></button>
          </div>
        )}
      </div>
      {form && (
        <ProductForm
          initial={form === 'new' ? null : form}
          jenisList={jenisList}
          onClose={() => setForm(null)}
          onSaved={(text, id) => { setForm(null); flash(text); load(); if (id) setDetailId(id) }}
        />
      )}
      {detailId && (
        <ProductDetail
          id={detailId}
          onClose={() => setDetailId(null)}
          onEdit={(item) => { setDetailId(null); setForm(item) }}
          onChanged={load}
          onDeleted={() => { setDetailId(null); flash('Produk dihapus.'); load() }}
        />
      )}
    </>
  )
}

// Pilih customer dengan pencarian (data customer hasil sinkron Accurate)
function CustomerSelect({ value, onChange }: { value: CustomerOption | null; onChange: (c: CustomerOption) => void }) {
  const [term, setTerm] = useState('')
  const [options, setOptions] = useState<CustomerOption[]>([])
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      api<{ items: CustomerOption[] }>(`/api/customers?q=${encodeURIComponent(term)}`).then((res) => setOptions(res.items)).catch(() => {})
    }, 250)
    return () => clearTimeout(timer)
  }, [term, open])
  return (
    <div className="pap-combo">
      <input
        className="pap-input"
        value={open ? term : value ? `${value.name}${value.customer_no ? ` (${value.customer_no})` : ''}` : ''}
        placeholder="Ketik nama customer..."
        onFocus={() => { setOpen(true); setTerm('') }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => setTerm(e.target.value)}
        required={!value}
      />
      {open && (
        <ul className="pap-combo-list">
          {options.map((c) => (
            <li key={c.id}><button type="button" onMouseDown={() => { onChange(c); setOpen(false) }}><strong>{c.name}</strong><small>{[c.customer_no, c.bill_city].filter(Boolean).join(' · ')}</small></button></li>
          ))}
          {!options.length && <li className="pap-combo-empty">Customer tidak ditemukan. Pastikan sudah disinkron dari Accurate.</li>}
        </ul>
      )}
    </div>
  )
}

export function ProductForm({ initial, customer, jenisList = JENIS_DEFAULT, onClose, onSaved }: { initial: Product | null; customer?: CustomerOption; jenisList?: string[]; onClose: () => void; onSaved: (message: string, id?: number) => void }) {
  const [selected, setSelected] = useState<CustomerOption | null>(
    customer ?? (initial?.customer_id ? { id: initial.customer_id, name: initial.customer_name ?? '', customer_no: initial.customer_no, bill_city: null } : null),
  )
  const [values, setValues] = useState({
    nama: initial?.nama ?? '',
    kode: initial?.kode ?? '',
    jenis: initial?.jenis ?? '',
    spesifikasi: initial?.spesifikasi ?? '',
    bahan: initial?.bahan ?? '',
    keterangan: initial?.keterangan ?? '',
    status: initial?.status ?? 'aktif',
  })
  const [files, setFiles] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (key: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!initial && !selected) return setError('Pilih customer terlebih dahulu.')
    setSaving(true)
    setError('')
    try {
      if (initial) {
        await api(`/api/products/${initial.id}`, { method: 'PATCH', json: values })
        onSaved('Produk diperbarui.')
        return
      }
      const res = await api<{ item: Product }>('/api/products', { method: 'POST', json: { ...values, customer_id: selected!.id } })
      const failed = await uploadFiles(res.item.id, files)
      onSaved(failed.length ? `Produk dibuat, tetapi ${failed.length} desain gagal diunggah: ${failed.join(' ')}` : 'Produk ditambahkan.', res.item.id)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      wide
      title={initial ? 'Edit produk' : 'Tambah produk'}
      subtitle={selected ? selected.name : initial ? initial.kode ?? '' : 'Data produk untuk acuan PPIC & Produksi'}
      onClose={onClose}
      footer={<><button type="button" className="pap-btn" onClick={onClose}>Batal</button><button type="submit" form="product-form" className="pap-primary-button" disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan produk'}</button></>}
    >
      <form id="product-form" className="pap-form-grid" onSubmit={submit}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Customer" full>
          {initial || customer ? <input className="pap-input" value={selected?.name ?? 'Dari Sales Order Accurate'} disabled /> : <CustomerSelect value={selected} onChange={setSelected} />}
        </Field>
        <Field label="Nama produk"><input className="pap-input" required maxLength={255} value={values.nama} onChange={set('nama')} placeholder="Contoh: Kantong HD 30x45 cetak 2 warna" /></Field>
        <Field label="Kode barang Accurate (opsional)"><input className="pap-input" maxLength={80} value={values.kode} onChange={set('kode')} placeholder="Contoh: BRG-00123" /></Field>
        <Field label="Jenis">
          <select className="pap-select" value={values.jenis} onChange={set('jenis')}>
            <option value="">— Pilih jenis —</option>
            {jenisList.map((j) => <option key={j} value={j}>{j}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select className="pap-select" value={values.status} onChange={set('status')}>
            <option value="aktif">Aktif</option>
            <option value="nonaktif">Nonaktif</option>
          </select>
        </Field>
        <Field label="Spesifikasi" full><textarea className="pap-input" rows={5} maxLength={10000} value={values.spesifikasi} onChange={set('spesifikasi')} placeholder={'Ukuran: 30 x 45 cm\nKetebalan: 0,05 mm\nModel: gusset / cut seal / side seal\nCetak: rotogravure 2 warna (merah, biru)\nKemasan: 100 pcs/pak'} /></Field>
        <Field label="Keterangan bahan" full><textarea className="pap-input" rows={3} maxLength={10000} value={values.bahan} onChange={set('bahan')} placeholder="Biji plastik HD, campuran, masterbatch warna, tinta, dll." /></Field>
        <Field label="Keterangan lain" full><textarea className="pap-input" rows={2} maxLength={10000} value={values.keterangan} onChange={set('keterangan')} placeholder="Catatan khusus untuk PPIC / Produksi" /></Field>
        {!initial && (
          <div className="full">
            <div className="pap-attach-actions">
              <span className="pap-attach-label">Desain (PDF / gambar)</span>
              <label className="pap-btn">
                <Upload /> Pilih file
                <input type="file" hidden multiple accept={ACCEPT} onChange={(e) => {
                  for (const file of Array.from(e.target.files ?? [])) {
                    const problem = validateFile(file)
                    if (problem) setError(problem)
                    else setFiles((list) => [...list, file])
                  }
                  e.target.value = ''
                }} />
              </label>
            </div>
            <small className="pap-hint">PDF desain atau gambar, maks. 4 MB per file.</small>
            {files.length > 0 && (
              <ul className="pap-file-list">
                {files.map((file, index) => (
                  <li key={index}>
                    <FileText />
                    <div><strong>{file.name}</strong><span>{formatSize(file.size)}</span></div>
                    <button type="button" className="pap-icon-button" aria-label="Hapus" onClick={() => setFiles((list) => list.filter((_, i) => i !== index))}><Trash2 /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </form>
    </Modal>
  )
}

export function ProductDetail({ id, onClose, onEdit, onChanged, onDeleted }: { id: number; onClose: () => void; onEdit: (item: Product) => void; onChanged: () => void; onDeleted: () => void }) {
  const [item, setItem] = useState<Product | null>(null)
  const [files, setFiles] = useState<ProductFile[]>([])
  const [orders, setOrders] = useState<OrderLine[]>([])
  const [buyers, setBuyers] = useState<Buyer[]>([])
  const [canManage, setCanManage] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await api<{ item: Product; files: ProductFile[]; orders: OrderLine[]; buyers: Buyer[]; canManage: boolean }>(`/api/products/${id}`)
      setItem(res.item)
      setFiles(res.files)
      setOrders(res.orders)
      setBuyers(res.buyers)
      setCanManage(res.canManage)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [id])
  useEffect(() => { load() }, [load])

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    try {
      await action()
      await load()
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!item) return <Modal title="Detail produk" onClose={onClose}>{error ? <Notice>{error}</Notice> : <p className="pap-muted">Memuat...</p>}</Modal>
  const block = (title: string, value: string | null) => (
    <section className="pap-detail-section">
      <h3>{title}</h3>
      <p className="pap-prewrap">{value || <span className="pap-muted">Belum diisi.</span>}</p>
    </section>
  )

  return (
    <Modal
      wide
      title={item.nama}
      subtitle={[item.kode, item.customer_name].filter(Boolean).join(' · ')}
      onClose={onClose}
      footer={
        <>
          {canManage && !item.accurate_item_id && <button className="pap-btn danger" disabled={busy} onClick={() => window.confirm(`Hapus produk "${item.nama}" beserta desainnya?`) && run(async () => { await api(`/api/products/${item.id}`, { method: 'DELETE' }); onDeleted() })}><Trash2 /> Hapus</button>}
          <span className="pap-spacer" />
          <button className="pap-btn" onClick={() => printSpecSheet(item, files)}><Printer /> Cetak spesifikasi</button>
          {canManage && <button className="pap-btn" onClick={() => onEdit(item)}><Pencil /> Edit</button>}
        </>
      }
    >
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-detail-badges">
        <span className={`pap-status ${item.status === 'aktif' ? 'success' : 'neutral'}`}>{item.status === 'aktif' ? 'Aktif' : 'Nonaktif'}</span>
        {item.jenis && <span className="pap-status info">{item.jenis}</span>}
        <span className="pap-status neutral">{item.accurate_item_id ? 'Barang Accurate' : 'Produk manual'}</span>
      </div>
      <dl className="pap-detail-grid">
        <div><dt>Customer utama</dt><dd>{item.customer_name ?? '—'}{item.customer_no ? ` (${item.customer_no})` : ''}</dd></div>
        <div><dt>Kode barang</dt><dd>{item.kode ?? '—'}</dd></div>
        <div><dt>Stok (fisik)</dt><dd>{item.stock === null ? '—' : `${formatNumber(item.stock)} ${item.unit ?? ''}`}</dd></div>
        <div><dt>Pesanan terakhir</dt><dd>{item.last_order ? formatDate(item.last_order) : '—'}</dd></div>
        <div><dt>Dibuat</dt><dd>{item.created_by_name} · {formatDate(item.created_at, true)}</dd></div>
        <div><dt>Diperbarui</dt><dd>{item.updated_by_name ?? item.created_by_name} · {formatDate(item.updated_at, true)}</dd></div>
      </dl>
      {block('Spesifikasi', item.spesifikasi)}
      {block('Keterangan bahan', item.bahan)}
      {block('Keterangan lain', item.keterangan)}
      <section className="pap-detail-section">
        <h3>Desain ({files.length})</h3>
        {files.length > 0 ? (
          <ul className="pap-file-list">
            {files.map((file) => (
              <li key={file.id}>
                {file.mime === 'application/pdf' ? <FileText /> : <ImageIcon />}
                <div>
                  <a href={`/api/products/files/${file.id}`} target="_blank" rel="noopener noreferrer">{file.name} <ExternalLink className="pap-inline-icon" /></a>
                  <span>{formatSize(file.size)} · {file.uploaded_by_name} · {formatDate(file.created_at, true)}</span>
                </div>
                <a className="pap-icon-button" href={`/api/products/files/${file.id}`} target="_blank" rel="noopener noreferrer" aria-label={`Lihat & cetak ${file.name}`} title="Lihat & cetak"><Printer /></a>
                <a className="pap-icon-button" href={`/api/products/files/${file.id}?download=1`} aria-label={`Unduh ${file.name}`} title="Unduh"><Download /></a>
                {canManage && <button className="pap-icon-button" aria-label={`Hapus ${file.name}`} disabled={busy} onClick={() => window.confirm(`Hapus desain "${file.name}"?`) && run(() => api(`/api/products/files/${file.id}`, { method: 'DELETE' }))}><Trash2 /></button>}
              </li>
            ))}
          </ul>
        ) : <p className="pap-muted">Belum ada desain.</p>}
        {canManage && (
          <div className="pap-attach-actions">
            <label className={`pap-btn ${busy ? 'disabled' : ''}`}>
              <Upload /> {busy ? 'Mengunggah...' : 'Unggah desain'}
              <input type="file" hidden multiple accept={ACCEPT} disabled={busy} onChange={(e) => {
                const picked = Array.from(e.target.files ?? [])
                e.target.value = ''
                const problems = picked.map(validateFile).filter(Boolean)
                if (problems.length) return setError(problems.join(' '))
                run(async () => {
                  const failed = await uploadFiles(item.id, picked)
                  if (failed.length) throw new Error(failed.join(' '))
                })
              }} />
            </label>
            <small className="pap-hint">PDF / JPG / PNG, maks. 4 MB per file.</small>
          </div>
        )}
      </section>
      {buyers.length > 0 && (
        <section className="pap-detail-section">
          <h3>Customer pemesan ({buyers.length})</h3>
          <div className="pap-participants">
            {buyers.map((b) => <span key={b.id} className="pap-participant"><strong>{b.name}</strong><small>{b.order_count}× pesan · terakhir {formatDate(b.last_order)}</small></span>)}
          </div>
        </section>
      )}
      {orders.length > 0 && (
        <section className="pap-detail-section">
          <h3>Riwayat pesanan (Sales Order)</h3>
          <div className="pap-table-wrap pap-compact-table">
            <table>
              <thead><tr><th>No. SO</th><th>Tanggal</th><th>Customer</th><th className="pap-num">Jumlah</th><th className="pap-num">Harga</th><th>Status</th></tr></thead>
              <tbody>
                {orders.map((o, i) => (
                  <tr key={i}><td className="pap-nowrap">{o.number ?? '—'}</td><td className="pap-nowrap">{formatDate(o.trans_date)}</td><td>{o.customer_name ?? '—'}</td><td className="pap-num pap-nowrap">{formatNumber(o.quantity)} {o.unit ?? ''}</td><td className="pap-num pap-nowrap">{formatRupiah(o.unit_price)}</td><td>{o.status ?? '—'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <p className="pap-hint"><Package className="pap-inline-icon" /> Klik ikon printer pada desain untuk membuka file dan mencetaknya sebagai acuan produksi.</p>
    </Modal>
  )
}
