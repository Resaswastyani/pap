'use client'

import { useEffect, useMemo, useState } from 'react'
import { FilePlus2, FileText, Pencil, Plus, Printer, ReceiptText, Save, Search, Trash2 } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { formatRupiah } from './accurate'
import { MonthNav, monthLabel, useDebounced } from './accurate-production'
import { api, Field, formatDate, Modal, Notice, Pager, usePaged } from './ui'

// Dokumen Order: Surat Order & Proforma Invoice. Tab "Dokumen tersimpan" untuk dokumen yang dibuat, diubah, dan
// dihapus di PAP-MS; tab "Sales order Accurate" untuk cetak langsung dari SO atau membuat dokumen tersimpan darinya.
type So = { id: number; number: string; tanggal: string; ship_date: string | null; status: string | null; total: number; customer_name: string | null; customer_no: string | null; baris: number; dp_persen: number | null; ekspedisi: string | null }
type Detail = { id: number; nomor: string; customer_name: string; total: number; terbayar: number; sisa: number; dp_persen: number | null; proforma_nomor: string; payment_term: string | null; items: unknown[] }
type Jenis = 'order' | 'proforma'
type PpnMode = 'none' | 'exclusive' | 'inclusive'
type DocItem = { nama: string; qty: number; unit: string; harga: number; disc_pct: number | null; catatan: string | null }
type DocData = {
  jenis: Jenis; nomor: string; tanggal: string; so_accurate_id: number | null; so_number: string | null
  kepada: string; customer_no: string | null; kontak: string | null; telepon: string | null; alamat: string | null; po_number: string | null
  ship_date: string | null; ekspedisi: string | null; items: DocItem[]; expenses: { nama: string; amount: number }[]
  diskon: number; ppn_mode: PpnMode; ppn_rate: number; terbayar: number; dp_persen: number | null
  catatan: string | null; rekening: string | null; penandatangan: string | null
}
type SavedDoc = DocData & { id: number; created_by: number; created_by_name: string | null; updated_by_name: string | null; updated_at: string | null; total: number; sisa: number }
const STATUS_TONE: Record<string, string> = { 'Menunggu diproses': 'warning', 'Sebagian diproses': 'info', Terproses: 'success', Ditutup: 'neutral' }
const JENIS_LABEL: Record<Jenis, string> = { order: 'Surat Order', proforma: 'Proforma Invoice' }
const thisMonth = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7)
type Editing = { id?: number; soId?: number | null; jenis: Jenis }

export function DokumenOrderPage({ user }: { user: UserProfile }) {
  const [tab, setTab] = useState<'tersimpan' | 'so'>('tersimpan')
  const [editing, setEditing] = useState<Editing | null>(null)
  const [reload, setReload] = useState(0)
  const [message, setMessage] = useState('')

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">MARKETING · ACCURATE</p>
          <h1>Dokumen Order</h1>
          <span>Surat Order (konfirmasi pesanan) dan Proforma Invoice. Buat dari Sales Order Accurate atau manual, ubah isinya, simpan, lalu cetak PDF atau unduh Word. Mengubah dokumen di sini tidak mengubah SO di Accurate.</span>
        </div>
        <button className="pap-primary-button" onClick={() => setEditing({ jenis: 'order', soId: null })}><Plus /> Buat dokumen</button>
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      <div className="pap-segmented pap-doc-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'tersimpan'} className={tab === 'tersimpan' ? 'active' : ''} onClick={() => setTab('tersimpan')}>Dokumen tersimpan</button>
        <button role="tab" aria-selected={tab === 'so'} className={tab === 'so' ? 'active' : ''} onClick={() => setTab('so')}>Sales order Accurate</button>
      </div>
      {tab === 'tersimpan'
        ? <SavedDocs user={user} reload={reload} onEdit={(d) => setEditing({ id: d.id, jenis: d.jenis })} onDeleted={(d) => { setMessage(`${JENIS_LABEL[d.jenis]} ${d.nomor} dihapus.`); setReload((n) => n + 1) }} />
        : <SalesOrders onCreate={(so, jenis) => setEditing({ soId: so.id, jenis })} />}
      {editing && (
        <DocEditor key={`${editing.id ?? 'baru'}-${editing.soId ?? 0}`} editing={editing} onClose={() => setEditing(null)}
          onSaved={(nomor, isNew) => { setEditing(null); setTab('tersimpan'); setReload((n) => n + 1); setMessage(`Dokumen ${nomor} ${isNew ? 'disimpan' : 'diperbarui'}.`) }} />
      )}
    </>
  )
}

// ---------- Dokumen tersimpan ----------
function SavedDocs({ user, reload, onEdit, onDeleted }: { user: UserProfile; reload: number; onEdit: (d: SavedDoc) => void; onDeleted: (d: SavedDoc) => void }) {
  const [q, setQ] = useState('')
  const query = useDebounced(q.trim())
  const [jenis, setJenis] = useState('')
  const [items, setItems] = useState<SavedDoc[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    setItems(null)
    api<{ items: SavedDoc[] }>(`/api/order-documents?jenis=${jenis}${query ? `&q=${encodeURIComponent(query)}` : ''}`)
      .then((r) => alive && (setItems(r.items), setError('')))
      .catch((e) => alive && setError(e.message))
    return () => { alive = false }
  }, [jenis, query, reload])
  const paged = usePaged(items ?? [], `${jenis}-${query}-${reload}`, 25)
  const management = user.role.isAdmin || user.division.code === 'general_manager'

  async function remove(d: SavedDoc) {
    if (!window.confirm(`Hapus ${JENIS_LABEL[d.jenis]} ${d.nomor} (${d.kepada})? Dokumen bisa dipulihkan dari menu Data Terhapus.`)) return
    setBusy(d.id)
    try {
      await api(`/api/order-documents/${d.id}`, { method: 'DELETE' })
      onDeleted(d)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="pap-table-card">
      <div className="pap-card-head"><div><h2>Dokumen tersimpan</h2><p>{items ? `${items.length} dokumen` : 'Memuat...'}</p></div></div>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-filters">
        <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nomor, customer, atau nomor SO..." /></label>
        <select className="pap-select" value={jenis} onChange={(e) => setJenis(e.target.value)} aria-label="Jenis dokumen">
          <option value="">Semua jenis</option><option value="order">Surat Order</option><option value="proforma">Proforma Invoice</option>
        </select>
      </div>
      <div className="pap-table-wrap">
        <table>
          <thead><tr><th>Dokumen</th><th>Customer</th><th>SO</th><th className="pap-num">Total</th><th>Diubah</th><th className="pap-actions-col">Aksi</th></tr></thead>
          <tbody>
            {paged.items.map((d) => (
              <tr key={d.id}>
                <td className="pap-nowrap"><div className="pap-cell-title">{d.nomor}</div><div className="pap-cell-sub">{JENIS_LABEL[d.jenis]} · {formatDate(d.tanggal)}</div></td>
                <td>{d.kepada}<div className="pap-cell-sub">{d.customer_no}{d.jenis === 'proforma' && d.dp_persen ? ` · DP ${d.dp_persen}%` : ''}</div></td>
                <td className="pap-nowrap">{d.so_number ?? <span className="pap-muted">Manual</span>}</td>
                <td className="pap-num pap-nowrap">{formatRupiah(d.total)}</td>
                <td className="pap-nowrap"><div className="pap-cell-sub">{d.updated_by_name ?? d.created_by_name ?? '—'}</div><div className="pap-cell-sub">{formatDate(d.updated_at, true)}</div></td>
                <td className="pap-actions-cell">
                  <div className="pap-inline-actions">
                    <a className="pap-btn small" href={`/cetak/dokumen-order/${d.id}`} target="_blank" rel="noreferrer" title="Cetak / PDF"><Printer /> Cetak</a>
                    <a className="pap-btn small" href={`/api/order-documents/${d.id}/word`} title="Unduh Word">Word</a>
                    <button className="pap-icon-button" onClick={() => onEdit(d)} aria-label={`Ubah ${d.nomor}`} title="Ubah"><Pencil /></button>
                    {(d.created_by === user.id || management) && <button className="pap-icon-button" disabled={busy === d.id} onClick={() => remove(d)} aria-label={`Hapus ${d.nomor}`} title="Hapus"><Trash2 /></button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items && !items.length && <div className="pap-empty">{query || jenis ? 'Tidak ada dokumen yang cocok.' : 'Belum ada dokumen tersimpan. Klik "Buat dokumen" atau buat dari tab Sales order Accurate.'}</div>}
        {!items && !error && <div className="pap-empty">Memuat...</div>}
        <Pager {...paged.pager} noun="dokumen" />
      </div>
    </div>
  )
}

// ---------- Sales order Accurate ----------
function SalesOrders({ onCreate }: { onCreate: (so: So, jenis: Jenis) => void }) {
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
                      <a className="pap-btn small" href={`/cetak/sales-order/${s.id}?jenis=order`} target="_blank" rel="noreferrer" title="Cetak Surat Order langsung dari SO"><FileText /> Surat Order</a>
                      <button className="pap-btn small" onClick={() => setProforma(s)} title="Cetak Proforma Invoice langsung dari SO"><ReceiptText /> Proforma</button>
                      <button className="pap-btn small" onClick={() => onCreate(s, 'order')} title="Salin SO ke dokumen tersimpan yang bisa diedit"><FilePlus2 /> Buat & edit</button>
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

// ---------- Form buat / ubah dokumen ----------
type Line = { key: string; nama: string; qty: string; unit: string; harga: string; disc_pct: string; catatan: string }
type Cost = { key: string; nama: string; amount: string }
let lineSeq = 0
const toLine = (it?: Partial<DocItem>): Line => ({ key: `l${++lineSeq}`, nama: it?.nama ?? '', qty: it?.qty != null ? String(it.qty) : '', unit: it?.unit ?? '', harga: it?.harga != null ? String(it.harga) : '', disc_pct: it?.disc_pct ? String(it.disc_pct) : '', catatan: it?.catatan ?? '' })
const toCost = (e?: { nama: string; amount: number }): Cost => ({ key: `c${++lineSeq}`, nama: e?.nama ?? '', amount: e ? String(e.amount) : '' })
const num = (v: string) => { const n = Number(v.replace(',', '.')); return Number.isFinite(n) ? n : 0 }
const lineTotal = (l: Line) => Math.round(num(l.qty) * num(l.harga) * (1 - num(l.disc_pct) / 100) * 100) / 100

function DocEditor({ editing, onClose, onSaved }: { editing: Editing; onClose: () => void; onSaved: (nomor: string, isNew: boolean) => void }) {
  const isNew = !editing.id
  const [jenis, setJenis] = useState<Jenis>(editing.jenis)
  const [v, setV] = useState<DocData | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [costs, setCosts] = useState<Cost[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Dokumen baru: isian awal dari SO / kosong, dimuat ulang bila jenis diganti. Dokumen lama: dibaca sekali.
  useEffect(() => {
    let alive = true
    setV(null)
    const url = isNew ? `/api/order-documents/draft?jenis=${jenis}${editing.soId ? `&so=${editing.soId}` : ''}` : `/api/order-documents/${editing.id}`
    api<{ item: DocData }>(url)
      .then((r) => { if (!alive) return; setV(r.item); setLines(r.item.items.map(toLine)); setCosts(r.item.expenses.map(toCost)); setError('') })
      .catch((e) => alive && setError(e.message))
    return () => { alive = false }
  }, [isNew, jenis, editing.id, editing.soId])

  const set = <K extends keyof DocData>(k: K, value: DocData[K]) => setV((cur) => (cur ? { ...cur, [k]: value } : cur))
  const totals = useMemo(() => {
    if (!v) return null
    const subtotal = lines.reduce((t, l) => t + lineTotal(l), 0)
    const dasar = subtotal - v.diskon
    const ppn = v.ppn_mode === 'exclusive' ? Math.round((dasar * v.ppn_rate) / 100) : v.ppn_mode === 'inclusive' ? Math.round((dasar * v.ppn_rate) / (100 + v.ppn_rate)) : 0
    const total = dasar + (v.ppn_mode === 'exclusive' ? ppn : 0) + costs.reduce((t, c) => t + num(c.amount), 0)
    const sisa = Math.max(0, total - v.terbayar)
    const tagihan = v.jenis !== 'proforma' ? null : v.terbayar > 0 ? sisa : v.dp_persen ? Math.round((total * v.dp_persen) / 100) : total
    return { subtotal, ppn, total, tagihan }
  }, [v, lines, costs])
  const updateLine = (key: string, patch: Partial<Line>) => setLines((list) => list.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const updateCost = (key: string, patch: Partial<Cost>) => setCosts((list) => list.map((c) => (c.key === key ? { ...c, ...patch } : c)))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!v) return
    setBusy(true)
    setError('')
    const body = {
      ...v, jenis,
      items: lines.filter((l) => l.nama.trim()).map((l) => ({ nama: l.nama, qty: num(l.qty), unit: l.unit, harga: num(l.harga), disc_pct: num(l.disc_pct) || null, catatan: l.catatan || null })),
      expenses: costs.filter((c) => c.nama.trim() && num(c.amount)).map((c) => ({ nama: c.nama, amount: num(c.amount) })),
    }
    try {
      if (isNew) await api('/api/order-documents', { method: 'POST', json: body })
      else await api(`/api/order-documents/${editing.id}`, { method: 'PUT', json: body })
      onSaved(v.nomor, isNew)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  const title = isNew ? (editing.soId ? 'Buat dokumen dari SO' : 'Buat dokumen order') : `Ubah ${JENIS_LABEL[jenis]}`
  return (
    <Modal wide title={title} subtitle={v ? `${v.nomor}${v.so_number ? ` · dari ${v.so_number}` : ''}` : undefined} onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="order-doc-form" disabled={busy || !v}><Save /> {busy ? 'Menyimpan...' : 'Simpan'}</button></>}>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {!v && !error && <p className="pap-muted">{editing.soId ? 'Membaca SO dari Accurate...' : 'Memuat...'}</p>}
      {v && (
        <form id="order-doc-form" className="pap-po-form" onSubmit={submit}>
          <div className="pap-form-grid">
            <Field label="Jenis dokumen" hint={isNew ? undefined : 'Jenis tidak bisa diganti setelah disimpan'}>
              <select className="pap-select" value={jenis} disabled={!isNew} onChange={(e) => setJenis(e.target.value as Jenis)}>
                <option value="order">Surat Order (konfirmasi pesanan)</option><option value="proforma">Proforma Invoice</option>
              </select>
            </Field>
            <Field label="Nomor *"><input className="pap-input" required maxLength={60} value={v.nomor} onChange={(e) => set('nomor', e.target.value)} /></Field>
            <Field label="Tanggal *"><input className="pap-input" type="date" required value={v.tanggal} onChange={(e) => set('tanggal', e.target.value)} /></Field>
            <Field label={jenis === 'order' ? 'No. PO customer' : 'Ref. SO'}>
              {jenis === 'order'
                ? <input className="pap-input" maxLength={100} value={v.po_number ?? ''} onChange={(e) => set('po_number', e.target.value || null)} />
                : <input className="pap-input" maxLength={60} value={v.so_number ?? ''} onChange={(e) => set('so_number', e.target.value || null)} />}
            </Field>
          </div>
          <div className="pap-po-sections">
            <fieldset>
              <legend>Customer</legend>
              <Field label="Kepada (nama customer) *"><input className="pap-input" required maxLength={255} value={v.kepada} onChange={(e) => set('kepada', e.target.value)} /></Field>
              <Field label="Up. (kontak)"><input className="pap-input" maxLength={150} value={v.kontak ?? ''} onChange={(e) => set('kontak', e.target.value || null)} /></Field>
              <Field label="Telepon"><input className="pap-input" maxLength={100} value={v.telepon ?? ''} onChange={(e) => set('telepon', e.target.value || null)} /></Field>
              <Field label="Alamat kirim"><textarea className="pap-input" rows={3} maxLength={2000} value={v.alamat ?? ''} onChange={(e) => set('alamat', e.target.value || null)} /></Field>
            </fieldset>
            <fieldset>
              <legend>Pengiriman & pajak</legend>
              <Field label="Rencana kirim"><input className="pap-input" type="date" value={v.ship_date ?? ''} onChange={(e) => set('ship_date', e.target.value || null)} /></Field>
              <Field label="Ekspedisi"><input className="pap-input" maxLength={255} value={v.ekspedisi ?? ''} onChange={(e) => set('ekspedisi', e.target.value || null)} placeholder="mis. SL Cargo (Rp 1.000/kg)" /></Field>
              <Field label="PPN">
                <select className="pap-select" value={v.ppn_mode} onChange={(e) => set('ppn_mode', e.target.value as PpnMode)}>
                  <option value="none">Tanpa PPN</option><option value="exclusive">PPN ditambahkan</option><option value="inclusive">Harga termasuk PPN</option>
                </select>
              </Field>
              {v.ppn_mode !== 'none' && <Field label="Tarif PPN (%)"><input className="pap-input pap-num" type="number" min={1} max={100} step="0.01" value={v.ppn_rate} onChange={(e) => set('ppn_rate', num(e.target.value))} /></Field>}
            </fieldset>
          </div>

          <div className="pap-field">
            <span>Barang</span>
            <div className="pap-table-wrap bordered pap-po-lines">
              <table>
                <thead><tr><th>Produk & spesifikasi</th><th className="pap-num">Jumlah</th><th>Satuan</th><th className="pap-num">Harga @</th><th className="pap-num">Disk %</th><th className="pap-num">Jumlah harga</th><th /></tr></thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.key}>
                      <td>
                        <input className="pap-input" required={i === 0} maxLength={500} value={l.nama} onChange={(e) => updateLine(l.key, { nama: e.target.value })} aria-label="Nama produk" />
                        <input className="pap-input pap-doc-line-note" maxLength={500} value={l.catatan} onChange={(e) => updateLine(l.key, { catatan: e.target.value })} placeholder="Catatan / spesifikasi (opsional)" aria-label="Catatan produk" />
                      </td>
                      <td><input className="pap-input pap-num" inputMode="decimal" required={!!l.nama} value={l.qty} onChange={(e) => updateLine(l.key, { qty: e.target.value })} aria-label="Jumlah" /></td>
                      <td><input className="pap-input" maxLength={40} value={l.unit} onChange={(e) => updateLine(l.key, { unit: e.target.value })} aria-label="Satuan" /></td>
                      <td><input className="pap-input pap-num" inputMode="decimal" required={!!l.nama} value={l.harga} onChange={(e) => updateLine(l.key, { harga: e.target.value })} aria-label="Harga satuan" /></td>
                      <td><input className="pap-input pap-num" inputMode="decimal" value={l.disc_pct} onChange={(e) => updateLine(l.key, { disc_pct: e.target.value })} aria-label="Diskon persen" /></td>
                      <td className="pap-num pap-nowrap">{formatRupiah(lineTotal(l))}</td>
                      <td>{lines.length > 1 && <button type="button" className="pap-icon-button" aria-label={`Hapus barang ${i + 1}`} onClick={() => setLines((list) => list.filter((x) => x.key !== l.key))}><Trash2 /></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" className="pap-btn pap-add-item" onClick={() => setLines((list) => [...list, toLine({ unit: list[list.length - 1]?.unit ?? '' })])}><Plus /> Tambah barang</button>
          </div>

          <div className="pap-field">
            <span>Biaya lain (ongkir, dll.)</span>
            {costs.map((c) => (
              <div key={c.key} className="pap-doc-cost">
                <input className="pap-input" maxLength={150} value={c.nama} onChange={(e) => updateCost(c.key, { nama: e.target.value })} placeholder="Nama biaya" aria-label="Nama biaya" />
                <input className="pap-input pap-num" inputMode="decimal" value={c.amount} onChange={(e) => updateCost(c.key, { amount: e.target.value })} placeholder="Jumlah" aria-label="Jumlah biaya" />
                <button type="button" className="pap-icon-button" aria-label="Hapus biaya" onClick={() => setCosts((list) => list.filter((x) => x.key !== c.key))}><Trash2 /></button>
              </div>
            ))}
            <button type="button" className="pap-btn pap-add-item" onClick={() => setCosts((list) => [...list, toCost()])}><Plus /> Tambah biaya</button>
          </div>

          {totals && (
            <dl className="pap-po-totals">
              <div><dt>Subtotal</dt><dd>{formatRupiah(totals.subtotal)}</dd></div>
              <div><dt>Diskon <input className="pap-input pap-num pap-doc-diskon" inputMode="decimal" value={v.diskon || ''} onChange={(e) => set('diskon', num(e.target.value))} placeholder="0" aria-label="Diskon (Rp)" /></dt><dd>{v.diskon ? `- ${formatRupiah(v.diskon)}` : '—'}</dd></div>
              {v.ppn_mode !== 'none' && <div><dt>PPN {v.ppn_rate}%{v.ppn_mode === 'inclusive' ? ' (termasuk)' : ''}</dt><dd>{formatRupiah(totals.ppn)}</dd></div>}
              <div className="total"><dt>TOTAL</dt><dd>{formatRupiah(totals.total)}</dd></div>
              <div><dt>Uang muka diterima <input className="pap-input pap-num pap-doc-diskon" inputMode="decimal" value={v.terbayar || ''} onChange={(e) => set('terbayar', num(e.target.value))} placeholder="0" aria-label="Uang muka diterima" /></dt><dd>{v.terbayar ? `- ${formatRupiah(v.terbayar)}` : '—'}</dd></div>
              {jenis === 'proforma' && v.terbayar <= 0 && (
                <div><dt>Tagih DP (%) <input className="pap-input pap-num pap-doc-diskon" type="number" min={1} max={99} value={v.dp_persen ?? ''} onChange={(e) => set('dp_persen', num(e.target.value) > 0 && num(e.target.value) < 100 ? num(e.target.value) : null)} placeholder="Total" aria-label="DP persen" /></dt><dd /></div>
              )}
              {totals.tagihan != null && <div className="total"><dt>{v.terbayar > 0 ? 'SISA TAGIHAN' : v.dp_persen ? `DP ${v.dp_persen}%` : 'TAGIHAN'}</dt><dd>{formatRupiah(totals.tagihan)}</dd></div>}
            </dl>
          )}

          <div className="pap-form-grid">
            <Field label="Catatan pesanan" full><textarea className="pap-input" rows={4} maxLength={5000} value={v.catatan ?? ''} onChange={(e) => set('catatan', e.target.value || null)} /></Field>
            {jenis === 'proforma' && <Field label="Rekening pembayaran" full><textarea className="pap-input" rows={3} maxLength={2000} value={v.rekening ?? ''} onChange={(e) => set('rekening', e.target.value || null)} /></Field>}
            <Field label="Penandatangan (Hormat kami)" hint="Kosongkan bila hanya nama perusahaan"><input className="pap-input" maxLength={150} value={v.penandatangan ?? ''} onChange={(e) => set('penandatangan', e.target.value || null)} /></Field>
          </div>
        </form>
      )}
    </Modal>
  )
}

// Cetak proforma langsung dari SO: pilih jumlah tagihan (sisa setelah uang muka, DP x%, atau total)
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
