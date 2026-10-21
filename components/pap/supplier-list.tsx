'use client'

import { useCallback, useEffect, useState } from 'react'
import { Mail, Phone, RefreshCw, Search, Wrench } from 'lucide-react'
import { api, formatDate, Modal, Notice } from './ui'

export type Vendor = {
  accurate_id: number; vendor_no: string | null; name: string; category: string | null; mobile_phone: string | null; work_phone: string | null
  email: string | null; city: string | null; address: string | null; suspended: boolean; teknik: boolean | null; teknik_efektif: boolean; pengajuan: number
}
type Purchase = { number: string; tanggal: string | null; total: number; items: { nama: string; jumlah: number; satuan: string | null; harga: number }[] }
const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`
const num = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 2 })
const waLink = (phone: string) => `https://wa.me/${phone.replace(/\D/g, '').replace(/^0/, '62')}`

// Daftar supplier dari Accurate di menu Pengajuan Pembelian: default supplier teknik (mesin, sparepart, bengkel)
export function SupplierList() {
  const [items, setItems] = useState<Vendor[]>([])
  const [counts, setCounts] = useState({ teknik: 0, semua: 0 })
  const [sync, setSync] = useState<{ at: string | null; count: number } | null>(null)
  const [can, setCan] = useState({ manage: false })
  const [filter, setFilter] = useState<'teknik' | 'semua'>('teknik')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState<Vendor | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ filter })
      if (q.trim()) params.set('q', q.trim())
      const res = await api<{ items: Vendor[]; counts: typeof counts; sync: typeof sync; warning: string | null; can: typeof can }>(`/api/vendors?${params}`)
      setItems(res.items)
      setCounts(res.counts)
      setSync(res.sync)
      setCan(res.can)
      if (res.warning) setError(res.warning)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [filter, q])
  useEffect(() => {
    const timer = setTimeout(load, q ? 300 : 0)
    return () => clearTimeout(timer)
  }, [load, q])

  async function syncNow() {
    setBusy(true)
    setError('')
    try {
      await api('/api/vendors', { method: 'POST' })
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pap-table-card">
      <div className="pap-filters pap-filters-top">
        <div className="pap-segmented" role="tablist" aria-label="Jenis supplier">
          <button role="tab" aria-selected={filter === 'teknik'} className={filter === 'teknik' ? 'active' : ''} onClick={() => setFilter('teknik')}><Wrench /> Supplier teknik ({counts.teknik})</button>
          <button role="tab" aria-selected={filter === 'semua'} className={filter === 'semua' ? 'active' : ''} onClick={() => setFilter('semua')}>Semua vendor ({counts.semua})</button>
        </div>
        <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama, kategori, kota..." /></label>
        {can.manage && <button className="pap-btn" disabled={busy} onClick={syncNow}><RefreshCw /> {busy ? 'Menyinkron...' : 'Sinkron dari Accurate'}</button>}
        {sync?.at && <small className="pap-muted">Accurate · {formatDate(sync.at, true)}</small>}
      </div>
      {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
      <div className="pap-table-wrap">
        <table>
          <thead><tr><th>Supplier</th><th>Kategori Accurate</th><th>Kontak</th><th>Kota</th><th>Pengajuan</th></tr></thead>
          <tbody>
            {items.map((v) => (
              <tr key={v.accurate_id} className="pap-row-link" onClick={() => setDetail(v)}>
                <td>
                  <div className="pap-cell-title">{v.name}{v.suspended && <span className="pap-chip">Nonaktif</span>}</div>
                  <div className="pap-cell-sub">{v.vendor_no}{filter === 'semua' && v.teknik_efektif ? ' · supplier teknik' : ''}</div>
                </td>
                <td>{v.category ?? '—'}</td>
                <td className="pap-nowrap">{v.mobile_phone || v.work_phone || <span className="pap-muted">—</span>}{v.email && <div className="pap-cell-sub">{v.email}</div>}</td>
                <td>{v.city ?? '—'}</td>
                <td>{v.pengajuan || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !items.length && <div className="pap-empty">{filter === 'teknik' ? 'Belum ada supplier teknik. Tandai vendor sebagai supplier teknik dari daftar "Semua vendor".' : 'Belum ada data vendor dari Accurate.'}</div>}
        {loading && !items.length && <div className="pap-empty">Memuat supplier dari Accurate...</div>}
      </div>
      {detail && <SupplierDetail vendor={detail} canManage={can.manage} onClose={() => setDetail(null)} onChanged={load} />}
    </div>
  )
}

function SupplierDetail({ vendor, canManage, onClose, onChanged }: { vendor: Vendor; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const [item, setItem] = useState(vendor)
  const [purchases, setPurchases] = useState<Purchase[] | null>(null)
  const [purchasesError, setPurchasesError] = useState('')
  const [requests, setRequests] = useState<{ id: number; nomor: string; status: string; created_at: string }[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    api<{ item: Vendor; purchases: Purchase[]; purchasesError: string | null; requests: typeof requests }>(`/api/vendors/${vendor.accurate_id}`)
      .then((res) => { setItem(res.item); setPurchases(res.purchases); setPurchasesError(res.purchasesError ?? ''); setRequests(res.requests) })
      .catch((e) => setError(e.message))
  }, [vendor.accurate_id])
  async function tag(teknik: boolean | null) {
    try {
      const res = await api<{ item: Vendor }>(`/api/vendors/${item.accurate_id}`, { method: 'PATCH', json: { teknik } })
      setItem(res.item)
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const phone = item.mobile_phone || item.work_phone
  return (
    <Modal title={item.name} subtitle={[item.vendor_no, item.category, item.city].filter(Boolean).join(' · ')} wide onClose={onClose} footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Tutup</button></>}>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-detail-badges">
        <span className={`pap-status ${item.teknik_efektif ? 'info' : 'neutral'}`}>{item.teknik_efektif ? 'Supplier teknik' : 'Bukan supplier teknik'}{item.teknik === null ? ' (otomatis)' : ''}</span>
        {item.suspended && <span className="pap-status neutral">Nonaktif di Accurate</span>}
      </div>
      <dl className="pap-detail-grid">
        <div><dt>Telepon</dt><dd>{phone ? <><a href={`tel:${phone}`}><Phone className="pap-inline-icon" /> {phone}</a> · <a href={waLink(phone)} target="_blank" rel="noreferrer">WhatsApp</a></> : '—'}</dd></div>
        <div><dt>Email</dt><dd>{item.email ? <a href={`mailto:${item.email}`}><Mail className="pap-inline-icon" /> {item.email}</a> : '—'}</dd></div>
        <div><dt>Alamat</dt><dd>{[item.address, item.city].filter(Boolean).join(', ') || '—'}</dd></div>
        <div><dt>Pengajuan PAP-MS</dt><dd>{requests.length ? requests.map((r) => r.nomor).slice(0, 5).join(', ') : '—'}</dd></div>
      </dl>
      {canManage && (
        <div className="pap-inline-actions pap-wrap">
          {!item.teknik_efektif && <button className="pap-btn" onClick={() => tag(true)}><Wrench /> Tandai supplier teknik</button>}
          {item.teknik_efektif && <button className="pap-btn" onClick={() => tag(false)}>Bukan supplier teknik</button>}
          {item.teknik !== null && <button className="pap-btn" onClick={() => tag(null)}>Kembali otomatis</button>}
        </div>
      )}
      <section className="pap-detail-section">
        <h3>Pembelian terakhir (faktur pembelian Accurate)</h3>
        {purchasesError && <Notice>{purchasesError}</Notice>}
        {purchases === null && !purchasesError && <p className="pap-muted">Memuat riwayat dari Accurate...</p>}
        {purchases?.length === 0 && <p className="pap-muted">Belum ada faktur pembelian dari supplier ini.</p>}
        {!!purchases?.length && (
          <div className="pap-table-wrap bordered">
            <table>
              <thead><tr><th>Faktur</th><th>Barang</th><th>Total</th></tr></thead>
              <tbody>
                {purchases.map((p) => (
                  <tr key={p.number}>
                    <td className="pap-nowrap"><div className="pap-cell-title">{p.number}</div><div className="pap-cell-sub">{formatDate(p.tanggal)}</div></td>
                    <td>{p.items.map((i, k) => <div key={k}>{i.nama} <span className="pap-muted">· {num(i.jumlah)} {i.satuan ?? ''} × {rupiah(i.harga)}</span></div>)}</td>
                    <td className="pap-nowrap">{rupiah(p.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Modal>
  )
}

// Pilih supplier di pengajuan (Purchasing): supplier teknik dulu, bisa tampilkan semua vendor
export function SupplierSelect({ value, onChange, disabled }: { value: number | null; onChange: (id: number | null) => void; disabled?: boolean }) {
  const [list, setList] = useState<Vendor[]>([])
  const [all, setAll] = useState(false)
  useEffect(() => {
    api<{ items: Vendor[] }>(`/api/vendors?filter=${all ? 'semua' : 'teknik'}`).then((r) => setList(r.items)).catch(() => {})
  }, [all])
  return (
    <div className="pap-inline-actions pap-wrap">
      <select className="pap-select" value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} aria-label="Supplier">
        <option value="">— Belum dipilih —</option>
        {value && !list.some((v) => v.accurate_id === value) && <option value={value}>Supplier terpilih</option>}
        {list.filter((v) => !v.suspended).map((v) => <option key={v.accurate_id} value={v.accurate_id}>{v.name}{v.city ? ` · ${v.city}` : ''}</option>)}
      </select>
      <label className="pap-check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Semua vendor</label>
    </div>
  )
}
