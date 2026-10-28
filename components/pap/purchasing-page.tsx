'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Building2, CalendarClock, CircleDollarSign, Clock3, PackageCheck, Pencil, Plus, Save, Search, ShoppingCart, Tags, Trash2, TrendingDown, TrendingUp, Truck, Boxes } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { AccurateSyncBar, formatNumber, formatRupiah, type SyncEntity } from './accurate'
import { MonthNav, monthLabel, useDebounced } from './accurate-production'
import { BarList, ColumnChart } from './charts'
import { PoFormModal, PriceEditor, VendorFormModal } from './purchasing-forms'
import { VendorPriceList } from './vendor-price-list'
import { MaterialList } from './material-list'
import { api, Field, formatDate, Modal, Notice, Pager, Progress, usePaged, RowActions, confirmDialog } from './ui'

// Purchasing: supplier, PO pembelian, harga bahan, hutang supplier. Data dari Accurate Online; supplier, PO, dan harga beli acuan
// bisa ditambah / diubah / dihapus dari PAP-MS sesuai permission modul Purchasing (lihat lib/purchasing-write.ts).

const JENIS = { bahan_baku: 'Bahan baku', bahan_pendukung: 'Bahan pendukung', teknik: 'Teknik / sparepart', atk: 'ATK', jasa: 'Jasa', lainnya: 'Lainnya' } as const
type Jenis = keyof typeof JENIS
const qty = (v: number | null | undefined, unit?: string | null) => (v === null || v === undefined ? '—' : `${formatNumber(v)}${unit ? ` ${unit}` : ''}`)
const pct = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${formatNumber(v, 1)}%`)
// Rupiah ringkas untuk kartu: Rp 1,2 M / Rp 350 jt
const rupiahShort = (v: number) => (Math.abs(v) >= 1e9 ? `Rp ${formatNumber(v / 1e9, 2)} M` : Math.abs(v) >= 1e6 ? `Rp ${formatNumber(v / 1e6, 1)} jt` : formatRupiah(v))
const dueText = (days: number | null) => (days === null ? '' : days < 0 ? `lewat ${-days} hari` : days === 0 ? 'hari ini' : `${days} hari lagi`)
// Warna dari progres penerimaan (kode status Accurate: ONPROCESS = menunggu diproses, WAITING = sebagian diproses)
const poTone = (o: { terbuka: boolean; terlambat: boolean; percent_shipped: number | null }) => (o.terlambat ? 'danger' : !o.terbuka ? 'success' : (o.percent_shipped ?? 0) > 0 ? 'info' : 'warning')

type Tile = { label: string; value: string; note: string; icon: typeof Truck; tone: string; active?: boolean; onClick?: () => void }
function Tiles({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="pap-stat-grid four">
      {tiles.map((t) => (
        <button key={t.label} className={`pap-stat-card pap-stat-button ${t.active ? 'active' : ''}`} onClick={t.onClick} disabled={!t.onClick}>
          <div><span>{t.label}</span><strong className="pap-stat-text">{t.value}</strong><small className="neutral">{t.note}</small></div>
          <div className={`pap-stat-icon ${t.tone}`}><t.icon /></div>
        </button>
      ))}
    </div>
  )
}

function Heading({ title, children }: { title: string; children: string }) {
  return (
    <div className="pap-page-heading">
      <div><p className="pap-eyebrow">PURCHASING · ACCURATE</p><h1>{title}</h1><span>{children}</span></div>
    </div>
  )
}

function useLoad<T>(url: string) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await api<T>(url))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [url])
  useEffect(() => { load() }, [load])
  return { data, loading, error, setError, load }
}

// ---------- Supplier ----------
type Vendor = {
  id: number; vendor_no: string | null; name: string; category: string | null; email: string | null; mobile_phone: string | null; work_phone: string | null; suspended: boolean
  jenis: Jenis[]; kontak: string | null; telepon: string | null; lead_time_hari: number | null; penilaian: number | null; catatan: string | null
  po_12m: number; total_12m: number; last_po: string | null; open_po: number; owing: number; overdue: number
}
type VendorDetail = {
  item: Vendor & { profile_updated_at: string | null; profile_updated_by: string | null }
  items: { item_accurate_id: number; item_no: string | null; item_name: string; unit: string | null; unit_price: number | null; trans_date: string; number: string; pembelian: number; kuantitas: number | null }[]
  orders: { id: number; number: string; trans_date: string; ship_date: string | null; total_amount: number | null; status: string | null; status_name: string | null; percent_shipped: number | null }[]
  invoices: { id: number; number: string; trans_date: string; due_date: string | null; total_amount: number | null; owing: number | null; sisa_hari: number | null }[]
  can: { edit: boolean }
}
const SUPPLIER_SYNC: SyncEntity[] = ['vendor', 'purchase-order', 'purchase-invoice-open']

export function SupplierPage(_props: { user: UserProfile }) {
  const { data, loading, error, setError, load } = useLoad<{ items: Vendor[]; can: { edit: boolean; manage: boolean } }>('/api/purchasing/vendors')
  const [vendorForm, setVendorForm] = useState<number | 'baru' | null>(null)
  const [message, setMessage] = useState('')
  const flash = (text: string) => { setMessage(text); setTimeout(() => setMessage(''), 6000); load() }
  const [q, setQ] = useState('')
  const [jenis, setJenis] = useState('')
  const [nonaktif, setNonaktif] = useState(false)
  const [filter, setFilter] = useState<'' | 'aktif12' | 'po' | 'hutang'>('')
  const [detailId, setDetailId] = useState<number | null>(null)
  const all = data?.items ?? []
  const term = q.trim().toLowerCase()
  const shown = all.filter((v) => (nonaktif || !v.suspended)
    && (!jenis || (jenis.startsWith('acc:') ? v.category === jenis.slice(4) : v.jenis.includes(jenis as Jenis)))
    && (!filter || (filter === 'aktif12' ? v.po_12m > 0 : filter === 'po' ? v.open_po > 0 : v.owing > 0))
    && (!term || [v.name, v.vendor_no, v.category, v.kontak, v.email].some((x) => x?.toLowerCase().includes(term))))
  const paged = usePaged(shown, [q, jenis, nonaktif, filter])
  async function removeVendor(v: Vendor) {
    if (!(await confirmDialog(`Hapus pemasok ${v.name} dari Accurate? Tindakan ini tidak bisa dibatalkan.`))) return
    try {
      await api(`/api/purchasing/vendors/${v.id}`, { method: 'DELETE' })
      flash(`Pemasok ${v.name} dihapus dari Accurate.`)
    } catch (err) {
      setError((err as Error).message)
    }
  }
  const categories = [...new Set(all.map((v) => v.category).filter((c): c is string => !!c))].sort()
  const active = all.filter((v) => !v.suspended)
  const sum = (k: 'total_12m' | 'owing' | 'overdue') => all.reduce((s, v) => s + v[k], 0)
  const toggle = (f: typeof filter) => setFilter(filter === f ? '' : f)

  return (
    <>
      <Heading title="Supplier">Database supplier dari Accurate (bahan baku, pendukung, teknik, ATK) beserta riwayat pembelian, harga barang yang dipasok, dan hutang. Purchasing dapat menambah catatan: jenis, kontak, lead time, penilaian.</Heading>
      <AccurateSyncBar entities={SUPPLIER_SYNC} canSync onSynced={load} />
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      <Tiles tiles={[
        { label: 'Supplier aktif', value: `${active.length}`, note: `${active.filter((v) => v.po_12m > 0).length} dengan PO 12 bulan terakhir`, icon: Building2, tone: 'stat-1', active: filter === 'aktif12', onClick: () => toggle('aktif12') },
        { label: 'Pembelian 12 bulan', value: rupiahShort(sum('total_12m')), note: `${all.reduce((s, v) => s + v.po_12m, 0)} PO`, icon: ShoppingCart, tone: 'stat-1' },
        { label: 'PO menunggu barang', value: `${all.reduce((s, v) => s + v.open_po, 0)}`, note: `${all.filter((v) => v.open_po > 0).length} supplier`, icon: Truck, tone: 'stat-2', active: filter === 'po', onClick: () => toggle('po') },
        { label: 'Hutang supplier', value: rupiahShort(sum('owing')), note: sum('overdue') ? `${rupiahShort(sum('overdue'))} lewat jatuh tempo` : 'Tidak ada yang lewat jatuh tempo', icon: CircleDollarSign, tone: sum('overdue') ? 'stat-3' : 'stat-0', active: filter === 'hutang', onClick: () => toggle('hutang') },
      ]} />
      <div className="pap-table-card">
        <div className="pap-card-head">
          <div><h2>Daftar supplier</h2><p>Urut nilai pembelian 12 bulan terakhir. Data pemasok tersimpan di Accurate; catatan Purchasing tersimpan di PAP-MS.</p></div>
          {data?.can.manage && <button className="pap-primary-button" onClick={() => setVendorForm('baru')}><Plus /> Tambah pemasok</button>}
        </div>
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama, kode, kategori, kontak..." /></label>
          <select className="pap-select" value={jenis} onChange={(e) => setJenis(e.target.value)} aria-label="Filter jenis">
            <option value="">Semua jenis</option>
            <optgroup label="Jenis (catatan Purchasing)">{Object.entries(JENIS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</optgroup>
            {!!categories.length && <optgroup label="Kategori Accurate">{categories.map((c) => <option key={c} value={`acc:${c}`}>{c}</option>)}</optgroup>}
          </select>
          <label className="pap-check"><input type="checkbox" checked={nonaktif} onChange={(e) => setNonaktif(e.target.checked)} /><span>Tampilkan nonaktif</span></label>
        </div>
        {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Supplier</th><th>Jenis</th><th>Kontak</th><th className="pap-num">Pembelian 12 bln</th><th>PO terakhir</th><th className="pap-num">Hutang</th><th className="pap-actions-col">Aksi</th></tr></thead>
            <tbody>
              {paged.items.map((v) => (
                <tr key={v.id} className="pap-row-link" onClick={() => setDetailId(v.id)}>
                  <td><div className="pap-cell-title">{v.name}{v.suspended && <span className="pap-status neutral"> Nonaktif</span>}</div><div className="pap-cell-sub">{[v.vendor_no, v.category].filter(Boolean).join(' · ')}</div></td>
                  <td>{v.jenis.length ? <div className="pap-inline-actions pap-wrap">{v.jenis.map((j) => <span key={j} className="pap-chip">{JENIS[j]}</span>)}</div> : <span className="pap-muted">—</span>}</td>
                  <td><div>{v.kontak ?? '—'}</div><div className="pap-cell-sub">{[v.telepon ?? v.mobile_phone ?? v.work_phone, v.email].filter(Boolean).join(' · ')}</div></td>
                  <td className="pap-num pap-nowrap"><strong>{v.total_12m ? formatRupiah(v.total_12m) : '—'}</strong><div className="pap-cell-sub">{v.po_12m} PO{v.open_po ? ` · ${v.open_po} berjalan` : ''}</div></td>
                  <td className="pap-nowrap">{v.last_po ? formatDate(v.last_po) : '—'}</td>
                  <td className="pap-num pap-nowrap">{v.owing ? <><strong>{formatRupiah(v.owing)}</strong>{v.overdue > 0 && <div className="pap-cell-sub pap-text-danger">{formatRupiah(v.overdue)} jatuh tempo</div>}</> : '—'}</td>
                  <td className="pap-actions-cell"><RowActions label={v.name} onView={() => setDetailId(v.id)} onEdit={data?.can.manage ? () => setVendorForm(v.id) : undefined} onDelete={data?.can.manage && !v.suspended ? () => removeVendor(v) : undefined} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !shown.length && <div className="pap-empty">{all.length ? 'Tidak ada supplier yang cocok.' : 'Belum ada data supplier. Klik "Sinkron sekarang" untuk mengambil dari Accurate.'}</div>}
          {loading && !data && <div className="pap-empty">Memuat supplier...</div>}
          <Pager {...paged.pager} noun="supplier" />
        </div>
      </div>
      {detailId && <SupplierDetail id={detailId} canManage={!!data?.can.manage} onClose={() => setDetailId(null)} onSaved={load} onEdit={() => setVendorForm(detailId)} onDeleted={(name) => { setDetailId(null); flash(`Pemasok ${name} dihapus dari Accurate.`) }} />}
      {vendorForm && <VendorFormModal id={vendorForm === 'baru' ? null : vendorForm} onClose={() => setVendorForm(null)} onSaved={(text) => { const wasEdit = vendorForm !== 'baru'; setVendorForm(null); if (wasEdit) setDetailId(null); flash(text) }} />}
    </>
  )
}

function SupplierDetail({ id, canManage, onClose, onSaved, onEdit, onDeleted }: { id: number; canManage: boolean; onClose: () => void; onSaved: () => void; onEdit: () => void; onDeleted: (name: string) => void }) {
  const { data, error, setError, load } = useLoad<VendorDetail>(`/api/purchasing/vendors/${id}`)
  const [form, setForm] = useState<{ jenis: Jenis[]; kontak: string; telepon: string; lead_time_hari: string; penilaian: string; catatan: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    if (!data) return
    const v = data.item
    setForm({ jenis: v.jenis, kontak: v.kontak ?? '', telepon: v.telepon ?? '', lead_time_hari: v.lead_time_hari?.toString() ?? '', penilaian: v.penilaian?.toString() ?? '', catatan: v.catatan ?? '' })
  }, [data])
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return
    setBusy(true)
    setError('')
    try {
      await api(`/api/purchasing/vendors/${id}`, { method: 'PUT', json: form })
      setSaved(true)
      setTimeout(() => setSaved(false), 4000)
      await load()
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    if (!data || !(await confirmDialog(`Hapus pemasok ${data.item.name} dari Accurate? Tindakan ini tidak bisa dibatalkan.`))) return
    setBusy(true)
    try {
      await api(`/api/purchasing/vendors/${id}`, { method: 'DELETE' })
      onDeleted(data.item.name)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }
  if (!data || !form) return <Modal title="Supplier" onClose={onClose}>{error ? <Notice>{error}</Notice> : <p className="pap-muted">Memuat...</p>}</Modal>
  const v = data.item
  const edit = data.can.edit
  return (
    <Modal title={v.name} subtitle={[v.vendor_no, v.category, v.suspended && 'Nonaktif di Accurate'].filter(Boolean).join(' · ')} wide onClose={onClose}
      footer={<>{canManage && <><button className="pap-btn danger" disabled={busy} onClick={remove}><Trash2 /> Hapus</button><button className="pap-btn" disabled={busy} onClick={onEdit}><Pencil /> Ubah data Accurate</button></>}<span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Tutup</button>{edit && <button className="pap-primary-button" form="vendor-form" disabled={busy}><Save /> {busy ? 'Menyimpan...' : 'Simpan catatan'}</button>}</>}>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {saved && <Notice kind="success">Catatan supplier disimpan.</Notice>}
      <dl className="pap-detail-grid">
        <div><dt>Telepon (Accurate)</dt><dd>{[v.mobile_phone, v.work_phone].filter(Boolean).join(' / ') || '—'}</dd></div>
        <div><dt>Email</dt><dd>{v.email ?? '—'}</dd></div>
        {v.profile_updated_by && <div><dt>Catatan diperbarui</dt><dd>{v.profile_updated_by} · {formatDate(v.profile_updated_at, true)}</dd></div>}
      </dl>
      <form id="vendor-form" className="pap-form-grid" onSubmit={save}>
        <div className="pap-field full">
          <span>Jenis supplier</span>
          <div className="pap-chip-tabs">
            {(Object.keys(JENIS) as Jenis[]).map((j) => (
              <button type="button" key={j} disabled={!edit} className={form.jenis.includes(j) ? 'active' : ''} onClick={() => setForm({ ...form, jenis: form.jenis.includes(j) ? form.jenis.filter((x) => x !== j) : [...form.jenis, j] })}>{JENIS[j]}</button>
            ))}
          </div>
        </div>
        <Field label="Kontak / sales supplier"><input className="pap-input" maxLength={150} readOnly={!edit} value={form.kontak} onChange={(e) => setForm({ ...form, kontak: e.target.value })} placeholder="Nama PIC" /></Field>
        <Field label="Telepon / WA kontak"><input className="pap-input" maxLength={80} readOnly={!edit} value={form.telepon} onChange={(e) => setForm({ ...form, telepon: e.target.value })} /></Field>
        <Field label="Lead time (hari)" hint="Rata-rata barang tiba setelah PO"><input className="pap-input" type="number" min={0} max={365} readOnly={!edit} value={form.lead_time_hari} onChange={(e) => setForm({ ...form, lead_time_hari: e.target.value })} /></Field>
        <Field label="Penilaian">
          <select className="pap-select" disabled={!edit} value={form.penilaian} onChange={(e) => setForm({ ...form, penilaian: e.target.value })}>
            <option value="">Belum dinilai</option>
            {[5, 4, 3, 2, 1].map((s) => <option key={s} value={s}>{'★'.repeat(s)}{'☆'.repeat(5 - s)} ({s})</option>)}
          </select>
        </Field>
        <Field label="Catatan (spesifikasi, negosiasi harga, kualitas, syarat bayar)" full><textarea className="pap-input" rows={2} maxLength={5000} readOnly={!edit} value={form.catatan} onChange={(e) => setForm({ ...form, catatan: e.target.value })} /></Field>
      </form>
      <section className="pap-detail-section">
        <h3>Barang yang dipasok ({data.items.length})</h3>
        {data.items.length ? (
          <div className="pap-table-wrap bordered">
            <table>
              <thead><tr><th>Barang</th><th className="pap-num">Harga terakhir</th><th>PO terakhir</th><th className="pap-num">Pembelian</th></tr></thead>
              <tbody>
                {data.items.map((it) => (
                  <tr key={it.item_accurate_id}>
                    <td><div className="pap-cell-title">{it.item_name}</div><div className="pap-cell-sub">{it.item_no}</div></td>
                    <td className="pap-num pap-nowrap"><strong>{formatRupiah(it.unit_price)}</strong>{it.unit && <span className="pap-cell-sub"> /{it.unit}</span>}</td>
                    <td className="pap-nowrap">{it.number}<div className="pap-cell-sub">{formatDate(it.trans_date)}</div></td>
                    <td className="pap-num pap-nowrap">{it.pembelian}×<div className="pap-cell-sub">{qty(it.kuantitas, it.unit)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="pap-muted">Belum ada baris PO dari supplier ini.</p>}
      </section>
      {!!data.invoices.length && (
        <section className="pap-detail-section">
          <h3>Faktur belum lunas ({data.invoices.length})</h3>
          <div className="pap-table-wrap bordered">
            <table>
              <thead><tr><th>Faktur</th><th>Jatuh tempo</th><th className="pap-num">Sisa hutang</th></tr></thead>
              <tbody>
                {data.invoices.map((f) => (
                  <tr key={f.id}>
                    <td className="pap-nowrap">{f.number}<div className="pap-cell-sub">{formatDate(f.trans_date)}</div></td>
                    <td className="pap-nowrap">{formatDate(f.due_date)}<div className={`pap-cell-sub ${(f.sisa_hari ?? 0) < 0 ? 'pap-text-danger' : ''}`}>{dueText(f.sisa_hari)}</div></td>
                    <td className="pap-num pap-nowrap"><strong>{formatRupiah(f.owing)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <section className="pap-detail-section">
        <h3>PO terbaru</h3>
        {data.orders.length ? (
          <div className="pap-table-wrap bordered">
            <table>
              <thead><tr><th>PO</th><th>Status</th><th className="pap-num">Nilai</th></tr></thead>
              <tbody>
                {data.orders.map((o) => (
                  <tr key={o.id}>
                    <td className="pap-nowrap">{o.number}<div className="pap-cell-sub">{formatDate(o.trans_date)}{o.ship_date ? ` · kirim ${formatDate(o.ship_date)}` : ''}</div></td>
                    <td><span className={`pap-status ${(o.percent_shipped ?? 0) >= 100 || o.status === 'CLOSED' ? 'success' : 'warning'}`}>{o.status_name ?? o.status ?? '—'}</span><div className="pap-cell-sub">{formatNumber(o.percent_shipped ?? 0, 0)}% diterima</div></td>
                    <td className="pap-num pap-nowrap">{formatRupiah(o.total_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="pap-muted">Belum ada PO.</p>}
      </section>
    </Modal>
  )
}

// ---------- PO Pembelian ----------
type PoLine = { line_id: number; item_no: string | null; item_name: string | null; quantity: number | null; unit: string | null; unit_price: number | null; total_price: number | null; quantity_shipped: number | null }
type Po = {
  id: number; number: string; trans_date: string; ship_date: string | null; vendor_id: number | null; vendor_name: string | null; total_amount: number | null
  status: string | null; status_name: string | null; percent_shipped: number | null; detail_synced: boolean; terbuka: boolean; terlambat: boolean; lines: PoLine[]
}
type PoRes = {
  periode: string; today: string; items: Po[]; stats: { po: number; nilai: number; supplier: number; terbuka: number; terlambat: number; nilai_terbuka: number; tertua: string | null }
  vendors: { id: number; name: string }[]; can: { create: boolean; update: boolean; delete: boolean }
}

export function PurchaseOrderPage(_props: { user: UserProfile }) {
  const [periode, setPeriode] = useState('')
  const [status, setStatus] = useState('')
  const [vendor, setVendor] = useState('')
  const [q, setQ] = useState('')
  const query = useDebounced(q)
  const params = new URLSearchParams()
  if (periode) params.set('periode', periode)
  if (status) params.set('status', status)
  if (vendor) params.set('vendor', vendor)
  if (query) params.set('q', query)
  const { data, loading, error, setError, load } = useLoad<PoRes>(`/api/purchasing/orders?${params}`)
  useEffect(() => { if (data && !periode) setPeriode(data.periode) }, [data, periode])
  const paged = usePaged(data?.items ?? [], [periode, status, vendor, query])
  const s = data?.stats
  const perMonth = status === '' || status === 'diterima'
  const toggle = (k: string) => setStatus(status === k ? '' : k)
  const [poForm, setPoForm] = useState<number | 'baru' | null>(null)
  const [message, setMessage] = useState('')
  const flash = (text: string) => { setMessage(text); setTimeout(() => setMessage(''), 6000); load() }
  async function removePo(o: Po) {
    if (!(await confirmDialog(`Hapus PO ${o.number} (${o.vendor_name ?? '-'}) dari Accurate? Tindakan ini tidak bisa dibatalkan.`))) return
    try {
      await api(`/api/purchasing/orders/${o.id}`, { method: 'DELETE' })
      flash(`PO ${o.number} dihapus dari Accurate.`)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <>
      <Heading title="PO Pembelian">Monitoring PO pembelian dari Accurate: barang, harga, supplier, dan progres penerimaan barang. PO yang melewati tanggal kirim tetapi belum diterima penuh ditandai terlambat.</Heading>
      <AccurateSyncBar entities={['purchase-order', 'purchase-order-detail']} canSync onSynced={load} />
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      <Tiles tiles={[
        { label: `PO ${monthLabel(data?.periode ?? '')}`, value: `${s?.po ?? 0}`, note: `${s?.supplier ?? 0} supplier`, icon: ShoppingCart, tone: 'stat-1' },
        { label: 'Nilai PO bulan ini', value: rupiahShort(s?.nilai ?? 0), note: 'Termasuk pajak', icon: CircleDollarSign, tone: 'stat-1' },
        { label: 'Menunggu barang', value: `${s?.terbuka ?? 0}`, note: `${rupiahShort(s?.nilai_terbuka ?? 0)} belum diterima${s?.tertua ? ` · sejak ${formatDate(s.tertua)}` : ''}`, icon: Truck, tone: 'stat-2', active: status === 'terbuka', onClick: () => toggle('terbuka') },
        { label: 'Terlambat', value: `${s?.terlambat ?? 0}`, note: s?.terlambat ? 'Lewat tanggal kirim; tutup di Accurate bila sudah tidak berlaku' : 'Lewat tanggal kirim, belum diterima penuh', icon: AlertTriangle, tone: s?.terlambat ? 'stat-3' : 'stat-0', active: status === 'terlambat', onClick: () => toggle('terlambat') },
      ]} />
      <div className="pap-table-card">
        <div className="pap-card-head">
          <div><h2>{status === 'terbuka' ? 'PO menunggu barang' : status === 'terlambat' ? 'PO terlambat' : 'Daftar PO'}</h2><p>{perMonth ? monthLabel(periode) : 'Semua tanggal, urut tanggal kirim'} · harga satuan sebelum pajak · data dari Accurate</p></div>
          <div className="pap-inline-actions pap-wrap">
            {perMonth && periode && <MonthNav periode={periode} onChange={setPeriode} />}
            {data?.can.create && <button className="pap-primary-button" onClick={() => setPoForm('baru')}><Plus /> Buat PO</button>}
          </div>
        </div>
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nomor PO, supplier, barang..." /></label>
          <select className="pap-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter status">
            <option value="">Semua PO bulan ini</option>
            <option value="diterima">Sudah diterima / ditutup (bulan ini)</option>
            <option value="terbuka">Menunggu barang (semua tanggal)</option>
            <option value="terlambat">Terlambat (semua tanggal)</option>
          </select>
          <select className="pap-select" value={vendor} onChange={(e) => setVendor(e.target.value)} aria-label="Filter supplier">
            <option value="">Semua supplier</option>
            {data?.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
        {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <div className="pap-table-wrap">
          <table className="pap-plan-table">
            <thead><tr><th>Barang</th><th className="pap-num">Dipesan</th><th className="pap-num">Diterima</th><th className="pap-num">Harga satuan</th><th className="pap-num">Jumlah</th></tr></thead>
            <tbody>
              {paged.items.flatMap((o) => [
                <tr key={`po${o.id}`} className="pap-group-row pap-plan-head">
                  <td colSpan={5}>
                    <div className="pap-plan-title">
                      <span><b>{o.number}</b> · {o.vendor_name ?? '—'} <span className={`pap-status ${poTone(o)}`}>{o.terlambat ? 'Terlambat' : o.status_name ?? o.status ?? '—'}</span></span>
                      <span className="pap-cell-sub">{formatDate(o.trans_date)}{o.ship_date ? ` · kirim ${formatDate(o.ship_date)}` : ''} · {formatRupiah(o.total_amount)}</span>
                    </div>
                    <div className="pap-po-progress"><Progress value={Math.round(o.percent_shipped ?? 0)} /></div>
                    {(data?.can.update || data?.can.delete) && !(o.percent_shipped ?? 0) && o.terbuka && (
                      <div className="pap-po-actions">
                        {data.can.update && <button className="pap-btn" onClick={() => setPoForm(o.id)}><Pencil /> Ubah</button>}
                        {data.can.delete && <button className="pap-btn danger" onClick={() => removePo(o)}><Trash2 /> Hapus</button>}
                      </div>
                    )}
                  </td>
                </tr>,
                ...(o.lines.length ? o.lines.map((l) => (
                  <tr key={`l${o.id}-${l.line_id}`}>
                    <td><div className="pap-cell-title pap-plan-item">{l.item_name ?? '—'}</div><div className="pap-cell-sub">{l.item_no ?? ''}</div></td>
                    <td className="pap-num pap-nowrap">{qty(l.quantity, l.unit)}</td>
                    <td className={`pap-num pap-nowrap ${(l.quantity_shipped ?? 0) < (l.quantity ?? 0) ? 'pap-text-warning' : ''}`}>{qty(l.quantity_shipped ?? 0, l.unit)}</td>
                    <td className="pap-num pap-nowrap">{formatRupiah(l.unit_price)}</td>
                    <td className="pap-num pap-nowrap"><strong>{formatRupiah(l.total_price)}</strong></td>
                  </tr>
                )) : [<tr key={`e${o.id}`}><td colSpan={5} className="pap-muted">{o.detail_synced ? 'Tidak ada baris barang.' : 'Baris barang belum diambil dari Accurate.'}</td></tr>]),
              ])}
            </tbody>
          </table>
          {!loading && !data?.items.length && <div className="pap-empty">{q || status || vendor ? 'Tidak ada PO yang cocok.' : `Belum ada PO di ${monthLabel(periode)}. Klik "Sinkron sekarang" untuk mengambil dari Accurate.`}</div>}
          {loading && !data && <div className="pap-empty">Memuat PO pembelian...</div>}
          <Pager {...paged.pager} noun="PO" />
        </div>
      </div>
      {poForm && <PoFormModal id={poForm === 'baru' ? null : poForm} onClose={() => setPoForm(null)} onSaved={(text) => { setPoForm(null); flash(text) }} />}
    </>
  )
}

// ---------- Harga Bahan ----------
type Price = {
  id: number; item_no: string | null; item_name: string; unit: string | null; po_unit: string | null; category: string | null; harga: number; tanggal: string; po_number: string
  vendor_name: string | null; prev_price: number | null; prev_date: string | null; perubahan: number | null; pembelian: number; min_12m: number | null; max_12m: number | null
  avg_12m: number | null; supplier_12m: number | null; harga_acuan: number | null
}
type PriceDetail = {
  item: { id: number; item_no: string | null; name: string; category: string | null; unit: string | null; stok: number | null; harga_acuan: number | null }
  logs: { harga_lama: number | null; harga_baru: number; catatan: string | null; created_at: string; user_name: string | null }[]
  can: { price: boolean }
  history: { po_id: number; number: string; trans_date: string; vendor_name: string | null; quantity: number | null; unit: string | null; unit_price: number; total_price: number | null }[]
  vendors: { vendor_name: string; terakhir: number; tanggal: string; termurah: number; pembelian: number }[]
}

export function MaterialPricePage(_props: { user: UserProfile }) {
  const [q, setQ] = useState('')
  const query = useDebounced(q)
  const [kategori, setKategori] = useState('')
  const [berubah, setBerubah] = useState('')
  const params = new URLSearchParams()
  if (query) params.set('q', query)
  if (kategori) params.set('kategori', kategori)
  if (berubah) params.set('berubah', berubah)
  const { data, loading, error, setError, load } = useLoad<{ items: Price[]; stats: { barang: number; naik: number; turun: number; bulan_ini: number }; categories: string[]; can: { price: boolean } }>(`/api/purchasing/prices?${params}`)
  const [detailId, setDetailId] = useState<number | null>(null)
  const paged = usePaged(data?.items ?? [], [query, kategori, berubah])
  const s = data?.stats
  const toggle = (k: string) => setBerubah(berubah === k ? '' : k)
  const [tab, setTab] = useState<'po' | 'pemasok' | 'bahan'>('po')

  return (
    <>
      <Heading title="Harga Bahan">Database harga beli bahan baku, bahan pendukung, dan perlengkapan produksi (tinta, dll.) dari baris PO Accurate: harga terakhir, perubahan dari pembelian sebelumnya, rentang 12 bulan, dan perbandingan antar supplier.</Heading>
      <div className="pap-segmented pap-page-tabs" role="tablist" aria-label="Jenis harga">
        <button role="tab" aria-selected={tab === 'po'} className={tab === 'po' ? 'active' : ''} onClick={() => setTab('po')}><Tags /> Harga dari PO</button>
        <button role="tab" aria-selected={tab === 'pemasok'} className={tab === 'pemasok' ? 'active' : ''} onClick={() => setTab('pemasok')}><Building2 /> Harga Pemasok (Accurate)</button>
        <button role="tab" aria-selected={tab === 'bahan'} className={tab === 'bahan' ? 'active' : ''} onClick={() => setTab('bahan')}><Boxes /> Data Bahan</button>
      </div>
      {tab === 'pemasok' ? <VendorPriceList /> : tab === 'bahan' ? <MaterialList /> : <>
      <AccurateSyncBar entities={['purchase-order', 'purchase-order-detail']} canSync onSynced={load} />
      <Tiles tiles={[
        { label: 'Barang tercatat', value: `${s?.barang ?? 0}`, note: kategori || 'Semua kategori', icon: Tags, tone: 'stat-1' },
        { label: 'Harga naik', value: `${s?.naik ?? 0}`, note: 'Dibanding pembelian sebelumnya', icon: TrendingUp, tone: s?.naik ? 'stat-3' : 'stat-0', active: berubah === 'naik', onClick: () => toggle('naik') },
        { label: 'Harga turun', value: `${s?.turun ?? 0}`, note: 'Dibanding pembelian sebelumnya', icon: TrendingDown, tone: 'stat-0', active: berubah === 'turun', onClick: () => toggle('turun') },
        { label: 'Dibeli bulan ini', value: `${s?.bulan_ini ?? 0}`, note: 'Barang dengan harga terbaru', icon: CalendarClock, tone: 'stat-1' },
      ]} />
      <div className="pap-table-card">
        <div className="pap-card-head"><div><h2>Harga terakhir per barang</h2><p>Harga satuan di PO (sebelum pajak). Klik barang untuk riwayat harga & perbandingan supplier{data?.can.price ? ', atau untuk mengubah harga beli acuan di Accurate' : ''}.</p></div></div>
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari barang, kode, supplier..." /></label>
          <select className="pap-select" value={kategori} onChange={(e) => setKategori(e.target.value)} aria-label="Filter kategori">
            <option value="">Semua kategori</option>
            {data?.categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="pap-select" value={berubah} onChange={(e) => setBerubah(e.target.value)} aria-label="Filter perubahan harga">
            <option value="">Semua perubahan</option>
            <option value="naik">Harga naik</option>
            <option value="turun">Harga turun</option>
          </select>
        </div>
        {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Barang</th><th className="pap-num">Harga terakhir</th><th className="pap-num">Sebelumnya</th><th className="pap-num">Perubahan</th><th className="pap-num">Rentang 12 bln</th><th className="pap-num">Harga acuan</th><th>Supplier terakhir</th></tr></thead>
            <tbody>
              {paged.items.map((p) => (
                <tr key={p.id} className="pap-row-link" onClick={() => setDetailId(p.id)}>
                  <td><div className="pap-cell-title">{p.item_name}</div><div className="pap-cell-sub">{[p.item_no, p.category].filter(Boolean).join(' · ')}</div></td>
                  <td className="pap-num pap-nowrap"><strong>{formatRupiah(p.harga)}</strong>{p.po_unit && <span className="pap-cell-sub"> /{p.po_unit}</span>}<div className="pap-cell-sub">{formatDate(p.tanggal)}</div></td>
                  <td className="pap-num pap-nowrap">{p.prev_price ? <>{formatRupiah(p.prev_price)}<div className="pap-cell-sub">{formatDate(p.prev_date)}</div></> : '—'}</td>
                  <td className="pap-num pap-nowrap">{p.perubahan === null ? '—' : <span className={`pap-status ${p.perubahan > 0 ? 'danger' : p.perubahan < 0 ? 'success' : 'neutral'}`}>{pct(p.perubahan)}</span>}</td>
                  <td className="pap-num pap-nowrap">{p.min_12m === null ? '—' : p.min_12m === p.max_12m ? formatRupiah(p.min_12m) : <>{formatRupiah(p.min_12m)}<div className="pap-cell-sub">s/d {formatRupiah(p.max_12m)}</div></>}</td>
                  <td className="pap-num pap-nowrap">{p.harga_acuan ? formatRupiah(p.harga_acuan) : '—'}</td>
                  <td><div>{p.vendor_name ?? '—'}</div><div className="pap-cell-sub">{p.po_number} · {p.pembelian}× dibeli{p.supplier_12m && p.supplier_12m > 1 ? ` · ${p.supplier_12m} supplier` : ''}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !data?.items.length && <div className="pap-empty">{q || kategori || berubah ? 'Tidak ada barang yang cocok.' : 'Belum ada harga. Klik "Sinkron sekarang" untuk mengambil PO dari Accurate.'}</div>}
          {loading && !data && <div className="pap-empty">Memuat harga bahan...</div>}
          <Pager {...paged.pager} noun="barang" />
        </div>
      </div>
      </>}
      {detailId && <PriceDetailModal id={detailId} onClose={() => setDetailId(null)} onChanged={load} />}
    </>
  )
}

function PriceDetailModal({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { data, error, load } = useLoad<PriceDetail>(`/api/purchasing/prices/${id}`)
  const paged = usePaged(data?.history ?? [], id)
  if (!data) return <Modal title="Riwayat harga" onClose={onClose}>{error ? <Notice>{error}</Notice> : <p className="pap-muted">Memuat...</p>}</Modal>
  const unit = data.history[0]?.unit
  // Grafik: 24 pembelian terakhir, urut waktu
  // Label tanggal (dd/mm) hanya tiap beberapa batang agar tidak bertumpuk; tanggal lengkap di tooltip
  const last = data.history.slice(0, 24).reverse()
  const every = Math.ceil(last.length / 8)
  const chart = last.map((h, i) => ({
    key: `${h.po_id}-${i}`, label: i % every === 0 || i === last.length - 1 ? `${h.trans_date.slice(8, 10)}/${h.trans_date.slice(5, 7)}` : '', value: h.unit_price,
    detail: <span>{formatDate(h.trans_date)} · {h.number} · {h.vendor_name}</span>,
  }))
  return (
    <Modal title={data.item.name} subtitle={[data.item.item_no, data.item.category, data.item.stok !== null && `stok ${qty(data.item.stok, data.item.unit)}`].filter(Boolean).join(' · ')} wide onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Tutup</button></>}>
      {data.can.price && <PriceEditor id={id} current={data.item.harga_acuan} lastPrice={data.history[0]?.unit_price ?? null} unit={data.item.unit} logs={data.logs} onSaved={() => { load(); onChanged() }} />}
      <section className="pap-detail-section">
        <h3>Harga per pembelian{unit ? ` (per ${unit})` : ''}</h3>
        <ColumnChart ariaLabel={`Riwayat harga ${data.item.name}`} format={(v) => formatRupiah(v)} axisFormat={(v) => formatNumber(v / 1000, 1) + 'rb'} data={chart} />
      </section>
      <section className="pap-detail-section">
        <h3>Perbandingan supplier</h3>
        <div className="pap-table-wrap bordered">
          <table>
            <thead><tr><th>Supplier</th><th className="pap-num">Harga terakhir</th><th className="pap-num">Termurah</th><th className="pap-num">Pembelian</th></tr></thead>
            <tbody>
              {data.vendors.map((v, i) => (
                <tr key={v.vendor_name}>
                  <td><div className="pap-cell-title">{v.vendor_name}{i === 0 && data.vendors.length > 1 && <span className="pap-chip"> termurah</span>}</div><div className="pap-cell-sub">terakhir {formatDate(v.tanggal)}</div></td>
                  <td className="pap-num pap-nowrap"><strong>{formatRupiah(v.terakhir)}</strong></td>
                  <td className="pap-num pap-nowrap">{formatRupiah(v.termurah)}</td>
                  <td className="pap-num">{v.pembelian}×</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="pap-detail-section">
        <h3>Riwayat pembelian ({data.history.length})</h3>
        <div className="pap-table-wrap bordered">
          <table>
            <thead><tr><th>PO</th><th>Supplier</th><th className="pap-num">Kuantitas</th><th className="pap-num">Harga satuan</th></tr></thead>
            <tbody>
              {paged.items.map((h, i) => (
                <tr key={`${h.po_id}-${i}`}>
                  <td className="pap-nowrap">{h.number}<div className="pap-cell-sub">{formatDate(h.trans_date)}</div></td>
                  <td>{h.vendor_name ?? '—'}</td>
                  <td className="pap-num pap-nowrap">{qty(h.quantity, h.unit)}</td>
                  <td className="pap-num pap-nowrap"><strong>{formatRupiah(h.unit_price)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager {...paged.pager} noun="pembelian" />
        </div>
      </section>
    </Modal>
  )
}

// ---------- Hutang Supplier ----------
type Payable = { id: number; number: string; trans_date: string; due_date: string | null; sisa_hari: number | null; total_amount: number | null; owing: number; status_name: string | null; vendor_id: number | null; vendor_name: string | null; vendor_no: string | null }
type PayableRes = {
  today: string; items: Payable[]
  stats: { faktur: number; total: number; jatuh_tempo: number; faktur_jatuh_tempo: number; minggu_ini: number; faktur_minggu_ini: number; supplier: number }
  perVendor: { id: number; name: string; owing: number; overdue: number; faktur: number }[]
}

export function PayablePage(_props: { user: UserProfile }) {
  const [status, setStatus] = useState('semua')
  const [vendor, setVendor] = useState('')
  const [q, setQ] = useState('')
  const query = useDebounced(q)
  const params = new URLSearchParams({ status })
  if (vendor) params.set('vendor', vendor)
  if (query) params.set('q', query)
  const { data, loading, error, setError, load } = useLoad<PayableRes>(`/api/purchasing/payables?${params}`)
  const paged = usePaged(data?.items ?? [], [status, vendor, query])
  const s = data?.stats
  const toggle = (k: string) => setStatus(status === k ? 'semua' : k)
  const vendorName = data?.perVendor.find((v) => String(v.id) === vendor)?.name

  return (
    <>
      <Heading title="Hutang Supplier">Faktur pembelian Accurate yang belum lunas, urut jatuh tempo, sebagai dasar permintaan pembayaran ke Accounting. Pembayaran dicatat di Accurate; sisa hutang diperbarui saat sinkron.</Heading>
      <AccurateSyncBar entities={['purchase-invoice', 'purchase-invoice-open']} canSync onSynced={load} />
      <Tiles tiles={[
        { label: 'Total hutang', value: rupiahShort(s?.total ?? 0), note: `${s?.faktur ?? 0} faktur · ${s?.supplier ?? 0} supplier`, icon: CircleDollarSign, tone: 'stat-1', active: status === 'semua' && !vendor, onClick: () => { setStatus('semua'); setVendor('') } },
        { label: 'Lewat jatuh tempo', value: rupiahShort(s?.jatuh_tempo ?? 0), note: `${s?.faktur_jatuh_tempo ?? 0} faktur`, icon: AlertTriangle, tone: s?.jatuh_tempo ? 'stat-3' : 'stat-0', active: status === 'jatuh_tempo', onClick: () => toggle('jatuh_tempo') },
        { label: 'Jatuh tempo 7 hari', value: rupiahShort(s?.minggu_ini ?? 0), note: `${s?.faktur_minggu_ini ?? 0} faktur`, icon: Clock3, tone: 'stat-2', active: status === 'minggu_ini', onClick: () => toggle('minggu_ini') },
        { label: 'Supplier terbesar', value: data?.perVendor[0] ? rupiahShort(data.perVendor[0].owing) : '—', note: data?.perVendor[0]?.name ?? 'Tidak ada hutang', icon: PackageCheck, tone: 'stat-1' },
      ]} />
      <div className="pap-dash-grid pap-fgs-grid">
        <section className="pap-table-card pap-dash-card">
          <div className="pap-card-head"><div><h2>Hutang per supplier</h2><p>10 terbesar · klik untuk menyaring</p></div></div>
          <div className="pap-dash-body">
            {data?.perVendor.length ? <BarList items={data.perVendor.map((v) => ({ key: String(v.id), label: v.name, value: v.owing, display: rupiahShort(v.owing), tone: v.overdue > 0 ? 'critical' : undefined, onClick: () => setVendor(vendor === String(v.id) ? '' : String(v.id)) }))} /> : <p className="pap-muted">Tidak ada hutang supplier.</p>}
          </div>
        </section>
        <section className="pap-table-card pap-dash-card">
          <div className="pap-card-head"><div><h2>Catatan</h2><p>Cara membaca</p></div></div>
          <div className="pap-dash-body">
            <p className="pap-muted">Batang merah: supplier dengan faktur yang sudah lewat jatuh tempo. Sisa hutang = total faktur dikurangi pembayaran/retur yang sudah dicatat di Accurate (termasuk pajak).</p>
          </div>
        </section>
      </div>
      <div className="pap-table-card">
        <div className="pap-card-head"><div><h2>Faktur belum lunas{vendorName ? ` · ${vendorName}` : ''}</h2><p>Urut jatuh tempo terdekat · data hanya-baca dari Accurate</p></div></div>
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nomor faktur atau supplier..." /></label>
          <select className="pap-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter jatuh tempo">
            <option value="semua">Semua belum lunas</option>
            <option value="jatuh_tempo">Lewat jatuh tempo</option>
            <option value="minggu_ini">Jatuh tempo 7 hari</option>
          </select>
          {vendor && <button className="pap-btn" onClick={() => setVendor('')}>Semua supplier</button>}
        </div>
        {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Faktur</th><th>Supplier</th><th>Jatuh tempo</th><th className="pap-num">Total faktur</th><th className="pap-num">Sisa hutang</th></tr></thead>
            <tbody>
              {paged.items.map((f) => (
                <tr key={f.id}>
                  <td className="pap-nowrap"><div className="pap-cell-title">{f.number}</div><div className="pap-cell-sub">{formatDate(f.trans_date)}</div></td>
                  <td><div>{f.vendor_name ?? '—'}</div><div className="pap-cell-sub">{f.vendor_no ?? ''}</div></td>
                  <td className="pap-nowrap">{formatDate(f.due_date)}<div><span className={`pap-status ${(f.sisa_hari ?? 0) < 0 ? 'danger' : (f.sisa_hari ?? 99) < 7 ? 'warning' : 'neutral'}`}>{dueText(f.sisa_hari)}</span></div></td>
                  <td className="pap-num pap-nowrap">{formatRupiah(f.total_amount)}</td>
                  <td className="pap-num pap-nowrap"><strong>{formatRupiah(f.owing)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !data?.items.length && <div className="pap-empty">{status !== 'semua' || q || vendor ? 'Tidak ada faktur yang cocok.' : 'Tidak ada faktur pembelian yang belum lunas.'}</div>}
          {loading && !data && <div className="pap-empty">Memuat hutang supplier...</div>}
          <Pager {...paged.pager} noun="faktur" />
        </div>
      </div>
    </>
  )
}
