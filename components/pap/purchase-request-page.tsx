'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Ban, CheckCircle2, FileText, PackageCheck, PenLine, Pencil, Phone, Plus, Printer, Save, Search, ShieldCheck, ShoppingCart, Trash2, Truck, XCircle } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { AttachmentPanel } from './attachments'
import { SupplierList, SupplierSelect } from './supplier-list'
import { SignaturePad, type SignaturePadHandle } from './signature-pad'
import { api, Field, formatDate, Modal, Notice, Pager, RowActions, usePaged, useQuickAction, confirmDialog, FreshBadge } from './ui'

type Status = 'diajukan' | 'disetujui' | 'dipesan' | 'diterima' | 'ditolak' | 'batal'
type Priority = 'darurat' | 'tinggi' | 'normal'
type Pr = {
  id: number; nomor: string; keperluan: string; prioritas: Priority; dibutuhkan: string | null; status: Status; repair_id: number | null; repair_nomor: string | null
  repair_mesin: string | null; vendor_accurate_id: number | null; vendor_name: string | null; vendor_phone: string | null; catatan_purchasing: string | null; po_number: string | null; po_status: string | null; po_percent: number | null; requested_by: number; requested_name: string; requester_division: string
  processed_name: string | null; processed_at: string | null; checked_name: string | null; checked_at: string | null; gm_approved_name: string | null; gm_approved_at: string | null; acc_approved_name: string | null; acc_approved_at: string | null;
  gm_ttd_nama: string | null; gm_ttd_jabatan: string | null; gm_ttd_token: string | null; acc_ttd_nama: string | null; acc_ttd_jabatan: string | null; acc_ttd_token: string | null; received_at: string | null; created_at: string; item_count: number; item_names: string | null
}
type PrItem = { id: number; item_id: number | null; item_kode: string | null; item_stok: number | null; nama: string; spesifikasi: string | null; jumlah: number; satuan: string }
type TechItem = { id: number; kode: string; nama: string; satuan: string; stok: number; stok_minimum: number }
type Repair = { id: number; nomor: string; mesin: string }

const STATUS_LABEL: Record<Status, string> = { diajukan: 'Diajukan', disetujui: 'Disetujui', dipesan: 'Dipesan', diterima: 'Diterima', ditolak: 'Ditolak', batal: 'Batal' }
const STATUS_TONE: Record<Status, string> = { diajukan: 'warning', disetujui: 'info', dipesan: 'info', diterima: 'success', ditolak: 'danger', batal: 'neutral' }
const PRIORITY_LABEL: Record<Priority, string> = { darurat: 'Darurat', tinggi: 'Tinggi', normal: 'Normal' }
const PRIORITY_TONE: Record<Priority, string> = { darurat: 'danger', tinggi: 'warning', normal: 'neutral' }
const num = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 2 })

export function PurchaseRequestPage({ user, focusId }: { user: UserProfile; focusId?: number | null }) {
  const [items, setItems] = useState<Pr[]>([])
  const [counts, setCounts] = useState<Partial<Record<Status, number>>>({})
  const [techItems, setTechItems] = useState<TechItem[]>([])
  const [repairs, setRepairs] = useState<Repair[]>([])
  const [can, setCan] = useState({ create: false, process: false })
  const [status, setStatus] = useState('terbuka')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<{ item: Pr; rows: PrItem[] } | null>(null)
  useQuickAction('ajukan-pembelian', () => setFormOpen(true))
  const [detailId, setDetailId] = useState<number | null>(focusId ?? null)
  // Sama dengan canEditPurchaseRequest di server: masih diajukan, oleh pengaju atau Purchasing
  const editable = (p: Pr) => p.status === 'diajukan' && (p.requested_by === user.id || can.process)
  async function openEdit(id: number) {
    try {
      const res = await api<{ item: Pr; items: PrItem[]; can: { edit: boolean } }>(`/api/purchase-requests/${id}`)
      if (!res.can.edit) return setError('Pengajuan yang sudah diproses tidak bisa diubah.')
      setEditing({ item: res.item, rows: res.items })
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const [tab, setTab] = useState<'pengajuan' | 'supplier'>('pengajuan')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ status })
      if (q.trim()) params.set('q', q.trim())
      const res = await api<{ items: Pr[]; counts: typeof counts; techItems: TechItem[]; repairs: Repair[]; can: typeof can }>(`/api/purchase-requests?${params}`)
      setItems(res.items)
      setCounts(res.counts)
      setTechItems(res.techItems)
      setRepairs(res.repairs)
      setCan(res.can)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [status, q])
  useEffect(() => {
    const timer = setTimeout(load, q ? 300 : 0)
    return () => clearTimeout(timer)
  }, [load, q])
  const flash = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 5000)
    load()
  }
  const paged = usePaged(items, `${status}-${q}`)
  const open = (counts.diajukan ?? 0) + (counts.disetujui ?? 0) + (counts.dipesan ?? 0)

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">TEKNIK · PURCHASING</p>
          <h1>Pengajuan Pembelian</h1>
          <span>Teknik mengajukan sparepart / peralatan, PPIC mengajukan bahan baku / pendukung, Purchasing juga bisa membuat pengajuan sendiri. Pengajuan diperiksa Purchasing (supplier, harga), lalu wajib disetujui GM dan Accounting; setelah itu Purchasing memesan (nomor PO Accurate) dan menandai diterima. Barang yang terhubung ke data sparepart otomatis masuk stok saat diterima.</span>
        </div>
        {can.create && tab === 'pengajuan' && <button className="pap-primary-button" onClick={() => setFormOpen(true)}><Plus /> Ajukan pembelian</button>}
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      <div className="pap-segmented pap-page-tabs" role="tablist" aria-label="Pengajuan pembelian">
        <button role="tab" aria-selected={tab === 'pengajuan'} className={tab === 'pengajuan' ? 'active' : ''} onClick={() => setTab('pengajuan')}><ShoppingCart /> Pengajuan</button>
        <button role="tab" aria-selected={tab === 'supplier'} className={tab === 'supplier' ? 'active' : ''} onClick={() => setTab('supplier')}><Truck /> Supplier (Accurate)</button>
      </div>
      {tab === 'supplier' ? <SupplierList /> : <div className="pap-table-card">
        <div className="pap-filters pap-filters-top">
          <div className="pap-segmented" role="tablist" aria-label="Status pengajuan">
            {[['terbuka', `Berjalan (${open})`], ['diajukan', `Menunggu (${counts.diajukan ?? 0})`], ['diterima', 'Diterima'], ['semua', 'Semua']].map(([k, l]) => (
              <button key={k} role="tab" aria-selected={status === k} className={status === k ? 'active' : ''} onClick={() => setStatus(k)}>{l}</button>
            ))}
          </div>
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nomor, keperluan, barang, no. PO..." /></label>
        </div>
        {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Pengajuan</th><th>Barang</th><th>Prioritas</th><th>Dibutuhkan</th><th>Status</th><th className="pap-actions-col">Aksi</th></tr></thead>
            <tbody>
              {paged.items.map((p) => (
                <tr key={p.id} className="pap-row-link" onClick={() => setDetailId(p.id)}>
                  <td className="pap-nowrap"><div className="pap-cell-title">{p.nomor}<FreshBadge item={p} /></div><div className="pap-cell-sub">{p.requested_name} · {formatDate(p.created_at)}</div></td>
                  <td><div className="pap-repair-keluhan">{p.item_names}</div><div className="pap-cell-sub">{p.item_count} barang · {p.keperluan}</div></td>
                  <td><span className={`pap-status ${PRIORITY_TONE[p.prioritas]}`}>{PRIORITY_LABEL[p.prioritas]}</span></td>
                  <td className="pap-nowrap">{p.dibutuhkan ? formatDate(p.dibutuhkan) : '—'}</td>
                  <td><span className={`pap-status ${STATUS_TONE[p.status]}`}>{STATUS_LABEL[p.status]}</span>{p.status === 'diajukan' && <div className="pap-cell-sub">Purchasing {p.checked_name ? '✓' : '–'} · GM {p.gm_approved_name ? '✓' : '–'} · Accounting {p.acc_approved_name ? '✓' : '–'}</div>}{(p.vendor_name || p.po_number || p.processed_name) && <div className="pap-cell-sub">{[p.vendor_name, p.po_number, p.processed_name].filter(Boolean).join(' · ')}</div>}</td>
                  <td className="pap-actions-cell"><RowActions label={p.nomor} onView={() => setDetailId(p.id)} onEdit={editable(p) ? () => openEdit(p.id) : undefined} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !items.length && <div className="pap-empty">{status === 'terbuka' ? 'Tidak ada pengajuan yang sedang berjalan.' : 'Tidak ada pengajuan yang cocok.'}</div>}
          {loading && !items.length && <div className="pap-empty">Memuat pengajuan...</div>}
        </div>
        <Pager {...paged.pager} noun="pengajuan" />
      </div>}
      {formOpen && <PrForm techItems={techItems} repairs={repairs} onClose={() => setFormOpen(false)} onSaved={(id) => { setFormOpen(false); flash('Pengajuan terkirim. Purchasing sudah mendapat notifikasi.'); setDetailId(id) }} />}
      {editing && <PrForm techItems={techItems} repairs={repairs} initial={editing} onClose={() => setEditing(null)} onSaved={(id) => { setEditing(null); flash('Pengajuan diperbarui.'); setDetailId(id) }} />}
      {detailId && !editing && (
        <PrDetail id={detailId} user={user} onClose={() => setDetailId(null)} onChanged={load}
          onEdit={(item, rows) => { setDetailId(null); setEditing({ item, rows }) }}
          onDeleted={(nomor) => { setDetailId(null); flash(`Pengajuan ${nomor} dihapus.`) }} />
      )}
    </>
  )
}

type Row = { key: number; item_id: string; nama: string; spesifikasi: string; jumlah: string; satuan: string }
let rowSeq = 0
const newRow = (src: Partial<Row> = {}): Row => ({ key: ++rowSeq, item_id: '', nama: '', spesifikasi: '', jumlah: '', satuan: 'pcs', ...src })

function PrForm({ techItems, repairs, initial, onClose, onSaved }: { techItems: TechItem[]; repairs: Repair[]; initial?: { item: Pr; rows: PrItem[] }; onClose: () => void; onSaved: (id: number) => void }) {
  // Sparepart yang stoknya menipis disarankan lebih dulu
  const lowItems = techItems.filter((t) => t.stok_minimum > 0 && t.stok <= t.stok_minimum)
  const [values, setValues] = useState(() => initial
    ? { keperluan: initial.item.keperluan, prioritas: initial.item.prioritas, dibutuhkan: initial.item.dibutuhkan?.slice(0, 10) ?? '', repair_id: initial.item.repair_id ? String(initial.item.repair_id) : '' }
    : { keperluan: '', prioritas: 'normal' as Priority, dibutuhkan: '', repair_id: '' })
  const [rows, setRows] = useState<Row[]>(() => initial?.rows.length
    ? initial.rows.map((r) => newRow({ item_id: r.item_id ? String(r.item_id) : '', nama: r.nama, spesifikasi: r.spesifikasi ?? '', jumlah: String(r.jumlah), satuan: r.satuan }))
    : [newRow()])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const update = (key: number, patch: Partial<Row>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const pickItem = (key: number, id: string) => {
    const t = techItems.find((i) => String(i.id) === id)
    update(key, t ? { item_id: id, nama: t.nama, satuan: t.satuan } : { item_id: '' })
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const json = { ...values, items: rows.map(({ key: _k, ...r }) => r) }
      if (initial) {
        await api(`/api/purchase-requests/${initial.item.id}`, { method: 'PUT', json })
        onSaved(initial.item.id)
      } else {
        const res = await api<{ id: number }>('/api/purchase-requests', { method: 'POST', json })
        onSaved(res.id)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={initial ? `Ubah pengajuan ${initial.item.nomor}` : 'Ajukan pembelian ke Purchasing'}
      subtitle="Sparepart, peralatan, bahan baku / pendukung, atau kebutuhan lain"
      wide
      onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="pr-form" disabled={busy}>{initial ? <><Save /> {busy ? 'Menyimpan...' : 'Simpan perubahan'}</> : <><ShoppingCart /> {busy ? 'Mengirim...' : `Ajukan (${rows.length} barang)`}</>}</button></>}
    >
      <form id="pr-form" className="pap-form-grid" onSubmit={submit}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        {lowItems.length > 0 && (
          <div className="pap-inline-panel full">
            <strong>Stok menipis</strong>
            <div className="pap-inline-actions pap-wrap">
              {lowItems.map((t) => (
                <button type="button" key={t.id} className="pap-btn" disabled={rows.some((r) => r.item_id === String(t.id))} onClick={() => setRows((list) => [...list.filter((r) => r.nama || r.item_id), newRow({ item_id: String(t.id), nama: t.nama, satuan: t.satuan, jumlah: String(Math.max(1, t.stok_minimum * 2 - t.stok)) })])}>
                  <Plus /> {t.nama} ({num(t.stok)}/{num(t.stok_minimum)} {t.satuan})
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="pap-field full">
          <span>Barang yang dibeli</span>
          <div className="pap-sample-items">
            {rows.map((r, i) => (
              <div key={r.key} className="pap-sample-item">
                <div className="pap-sample-item-head">
                  <b>{i + 1}</b>
                  <select className="pap-select" value={r.item_id} onChange={(e) => pickItem(r.key, e.target.value)} aria-label={`Barang ${i + 1} dari data sparepart`}>
                    <option value="">Barang baru (belum ada di data sparepart)</option>
                    {techItems.map((t) => <option key={t.id} value={t.id}>{t.nama} ({t.kode}) · stok {num(t.stok)} {t.satuan}</option>)}
                  </select>
                  {rows.length > 1 && <button type="button" className="pap-icon-button" aria-label={`Hapus barang ${i + 1}`} onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))}><Trash2 /></button>}
                </div>
                <div className="pap-sample-spec-grid">
                  <input className="pap-input" required maxLength={200} value={r.nama} onChange={(e) => update(r.key, { nama: e.target.value })} placeholder="Nama barang" aria-label="Nama barang" readOnly={!!r.item_id} />
                  <input className="pap-input" type="number" min={0} step="any" required value={r.jumlah} onChange={(e) => update(r.key, { jumlah: e.target.value })} placeholder="Jumlah" aria-label="Jumlah" />
                  <input className="pap-input" maxLength={40} value={r.satuan} onChange={(e) => update(r.key, { satuan: e.target.value })} placeholder="Satuan" aria-label="Satuan" />
                  <input className="pap-input full" maxLength={500} value={r.spesifikasi} onChange={(e) => update(r.key, { spesifikasi: e.target.value })} placeholder="Spesifikasi / merek / ukuran (opsional)" aria-label="Spesifikasi" />
                </div>
              </div>
            ))}
            <button type="button" className="pap-btn pap-add-item" onClick={() => setRows((list) => [...list, newRow()])}><Plus /> Tambah barang</button>
          </div>
        </div>
        <Field label="Keperluan / alasan" full><textarea className="pap-input" rows={2} required maxLength={5000} value={values.keperluan} onChange={(e) => setValues((v) => ({ ...v, keperluan: e.target.value }))} placeholder="Mis. stok cadangan menipis, untuk perbaikan MC Blow" /></Field>
        <Field label="Prioritas">
          <select className="pap-select" value={values.prioritas} onChange={(e) => setValues((v) => ({ ...v, prioritas: e.target.value as Priority }))}>
            {Object.entries(PRIORITY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Dibutuhkan tanggal (opsional)"><input className="pap-input" type="date" value={values.dibutuhkan} onChange={(e) => setValues((v) => ({ ...v, dibutuhkan: e.target.value }))} /></Field>
        <Field label="Untuk perbaikan mesin (opsional)" full>
          <select className="pap-select" value={values.repair_id} onChange={(e) => setValues((v) => ({ ...v, repair_id: e.target.value }))}>
            <option value="">— Tidak terkait laporan kerusakan —</option>
            {repairs.map((r) => <option key={r.id} value={r.id}>{r.nomor} · {r.mesin}</option>)}
          </select>
        </Field>
      </form>
    </Modal>
  )
}

function PrDetail({ id, user, onClose, onChanged, onEdit, onDeleted }: { id: number; user: UserProfile; onClose: () => void; onChanged: () => void; onEdit: (item: Pr, rows: PrItem[]) => void; onDeleted: (nomor: string) => void }) {
  const [item, setItem] = useState<Pr | null>(null)
  const [rows, setRows] = useState<PrItem[]>([])
  const [can, setCan] = useState({ process: false, cancel: false, edit: false, delete: false, check: false, approveGm: false, approveAccounting: false, reject: false })
  const [catatan, setCatatan] = useState('')
  const [poNumber, setPoNumber] = useState('')
  const [openPos, setOpenPos] = useState<{ number: string; vendor_name: string | null }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [mine, setMine] = useState<MySig>(null)
  const [signing, setSigning] = useState(false)
  const load = useCallback(async () => {
    try {
      const res = await api<{ item: Pr; items: PrItem[]; can: typeof can; mine: MySig }>(`/api/purchase-requests/${id}`)
      setItem(res.item)
      setRows(res.items)
      setCan(res.can)
      setMine(res.mine)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [id])
  useEffect(() => { load() }, [load])
  // Saran nomor PO: PO Accurate yang masih menunggu barang (hanya bila punya akses menu PO Pembelian)
  useEffect(() => {
    if (!can.process || !user.menus.includes('po-pembelian' as never)) return
    api<{ items: { number: string; vendor_name: string | null }[] }>('/api/purchasing/orders?status=terbuka').then((res) => setOpenPos(res.items)).catch(() => {})
  }, [can.process, user.menus])

  async function pickVendor(vendor_id: number | null) {
    setBusy(true)
    setError('')
    try {
      await api(`/api/purchase-requests/${id}`, { method: 'PATCH', json: { vendor_id } })
      await load()
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function act(status: Status) {
    if (status === 'ditolak' && !catatan.trim()) return setError('Tuliskan alasan penolakan di kolom catatan.')
    if (status === 'batal' && !(await confirmDialog('Batalkan pengajuan ini?'))) return
    setBusy(true)
    setError('')
    try {
      await api(`/api/purchase-requests/${id}`, { method: 'PATCH', json: { status, catatan, po_number: poNumber } })
      setCatatan('')
      setPoNumber('')
      await load()
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  // Purchasing selesai memeriksa (supplier, harga, catatan) -> diteruskan ke GM
  async function check() {
    if (!(await confirmDialog('Teruskan pengajuan ini ke GM untuk disetujui?'))) return
    setBusy(true)
    setError('')
    try {
      await api(`/api/purchase-requests/${id}`, { method: 'PATCH', json: { check: true, catatan } })
      setCatatan('')
      await load()
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  // Setujui = tanda tangan dulu (form tanda tangan), lalu persetujuan tersimpan bersama gambar tanda tangannya
  async function approve(ttd: SignInput) {
    await api(`/api/purchase-requests/${id}`, { method: 'PATCH', json: { approve: true, catatan, ttd } })
    setSigning(false)
    setCatatan('')
    await load()
    onChanged()
  }
  async function remove() {
    if (!item || !(await confirmDialog(`Hapus pengajuan ${item.nomor}? Data bisa dipulihkan dari menu Data Terhapus.`))) return
    setBusy(true)
    setError('')
    try {
      await api(`/api/purchase-requests/${id}`, { method: 'DELETE' })
      onDeleted(item.nomor)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }
  if (!item) return <Modal title="Pengajuan pembelian" onClose={onClose}>{error ? <Notice>{error}</Notice> : <p className="pap-muted">Memuat...</p>}</Modal>
  const s = item.status
  const flow: Status[] = ['diajukan', 'disetujui', 'dipesan', 'diterima']
  const step = flow.indexOf(s)
  return (
    <Modal
      title={item.nomor}
      subtitle={`Diajukan ${item.requested_name} (${item.requester_division}) · ${formatDate(item.created_at, true)}`}
      wide
      onClose={onClose}
      footer={<>
        {can.cancel && ['diajukan', 'disetujui', 'dipesan'].includes(s) && <button className="pap-btn danger" disabled={busy} onClick={() => act('batal')}><Ban /> Batalkan</button>}
        {can.delete && <button className="pap-btn danger" disabled={busy} onClick={remove}><Trash2 /> Hapus</button>}
        <span className="pap-spacer" />
        <a className="pap-btn" href={`/cetak/pengajuan-pembelian/${item.id}`} target="_blank" rel="noreferrer"><Printer /> Cetak / PDF</a>
        <a className="pap-btn" href={`/api/purchase-requests/${item.id}/word`}><FileText /> Word</a>
        {can.edit && <button className="pap-btn" disabled={busy} onClick={() => onEdit(item, rows)}><Pencil /> Ubah</button>}
        <button className="pap-btn" onClick={onClose}>Tutup</button>
      </>}
    >
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {step >= 0 ? (
        <ol className="pap-track">
          {flow.map((f, i) => <li key={f} className={i < step || (s === 'diterima' && i === step) ? 'done' : i === step ? 'current' : ''}><span>{i + 1}</span>{STATUS_LABEL[f]}</li>)}
        </ol>
      ) : <div className="pap-detail-badges"><span className={`pap-status ${STATUS_TONE[s]}`}>{STATUS_LABEL[s]}</span></div>}
      <dl className="pap-detail-grid">
        <div><dt>Prioritas</dt><dd><span className={`pap-status ${PRIORITY_TONE[item.prioritas]}`}>{PRIORITY_LABEL[item.prioritas]}</span></dd></div>
        <div><dt>Dibutuhkan</dt><dd>{item.dibutuhkan ? formatDate(item.dibutuhkan) : '—'}</dd></div>
        {item.repair_nomor && <div><dt>Untuk perbaikan</dt><dd>{item.repair_nomor} · {item.repair_mesin}</dd></div>}
        {item.vendor_name && <div><dt>Supplier</dt><dd>{item.vendor_name}{item.vendor_phone && <> · <a href={`tel:${item.vendor_phone}`}><Phone className="pap-inline-icon" /> {item.vendor_phone}</a></>}</dd></div>}
        {item.processed_name && <div><dt>Diproses</dt><dd>{item.processed_name} · {formatDate(item.processed_at, true)}</dd></div>}
        {item.po_number && <div><dt>PO Accurate</dt><dd>{item.po_number}{item.po_status ? ` · ${item.po_status}${item.po_percent !== null ? ` (${Math.round(item.po_percent)}% diterima)` : ''}` : ''}</dd></div>}
      </dl>
      <section className="pap-detail-section"><h3>Keperluan</h3><p className="pap-prewrap">{item.keperluan}</p></section>
      <section className="pap-detail-section">
        <h3>Barang ({rows.length})</h3>
        <div className="pap-table-wrap bordered">
          <table>
            <thead><tr><th>Barang</th><th>Jumlah</th><th>Stok saat ini</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><div className="pap-cell-title">{r.nama}</div><div className="pap-cell-sub">{[r.item_kode ?? 'Barang baru', r.spesifikasi].filter(Boolean).join(' · ')}</div></td>
                  <td className="pap-nowrap">{num(r.jumlah)} {r.satuan}</td>
                  <td className="pap-nowrap">{r.item_stok === null ? '—' : `${num(r.item_stok)} ${r.satuan}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {s === 'diajukan' && (
        <section className="pap-detail-section">
          <h3>Pemeriksaan & persetujuan (Purchasing → GM → Accounting)</h3>
          <dl className="pap-detail-grid">
            <div><dt>Diperiksa Purchasing</dt><dd>{item.checked_name ? <><CheckCircle2 className="pap-inline-icon" /> {item.checked_name} · {formatDate(item.checked_at, true)}</> : <span className="pap-muted">Menunggu pemeriksaan Purchasing</span>}</dd></div>
            <div><dt>GM</dt><dd>{item.gm_approved_name ? <ApprovalSig nama={item.gm_ttd_nama ?? item.gm_approved_name} jabatan={item.gm_ttd_jabatan} token={item.gm_ttd_token} at={item.gm_approved_at} /> : <span className="pap-muted">{item.checked_name ? 'Menunggu persetujuan' : 'Menunggu pemeriksaan Purchasing dulu'}</span>}</dd></div>
            <div><dt>Accounting</dt><dd>{item.acc_approved_name ? <ApprovalSig nama={item.acc_ttd_nama ?? item.acc_approved_name} jabatan={item.acc_ttd_jabatan} token={item.acc_ttd_token} at={item.acc_approved_at} /> : <span className="pap-muted">{item.gm_approved_name ? 'Menunggu persetujuan' : 'Menunggu persetujuan GM dulu'}</span>}</dd></div>
          </dl>
          {(can.approveGm || can.approveAccounting) && (
            <>
              <textarea className="pap-input" rows={2} maxLength={5000} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Catatan persetujuan, atau alasan ditolak" />
              <div className="pap-inline-actions pap-wrap">
                <button className="pap-btn danger" disabled={busy} onClick={() => act('ditolak')}><XCircle /> Tolak</button>
                <button className="pap-primary-button" disabled={busy} onClick={() => setSigning(true)}><PenLine /> Tanda tangan &amp; setujui sebagai {can.approveGm ? 'GM' : 'Accounting'}</button>
              </div>
            </>
          )}
        </section>
      )}
      {item.catatan_purchasing && <section className="pap-detail-section"><h3>Catatan</h3><p className="pap-prewrap">{item.catatan_purchasing}</p></section>}
      {can.process && ['diajukan', 'disetujui', 'dipesan'].includes(s) && (
        <section className="pap-detail-section">
          <h3>Proses Purchasing</h3>
          <Field label="Supplier (dari Accurate)"><SupplierSelect value={item.vendor_accurate_id} disabled={busy} onChange={pickVendor} /></Field>
          {!(s === 'diajukan' && (can.approveGm || can.approveAccounting)) && <textarea className="pap-input" rows={2} maxLength={5000} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Catatan: harga, estimasi tiba, atau alasan ditolak" />}
          {(s === 'disetujui' || s === 'dipesan') && (
            <>
              <input className="pap-input" list={`pr-po-${item.id}`} maxLength={80} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder={item.po_number ? `No. PO Accurate: ${item.po_number}` : 'No. PO Accurate (mis. PO.2026.10.00021)'} aria-label="Nomor PO Accurate" />
              <datalist id={`pr-po-${item.id}`}>{openPos.map((p) => <option key={p.number} value={p.number}>{p.vendor_name ?? ''}</option>)}</datalist>
            </>
          )}
          <div className="pap-inline-actions pap-wrap">
            {s === 'diajukan' && !(can.approveGm || can.approveAccounting) && <button className="pap-btn danger" disabled={busy} onClick={() => act('ditolak')}><XCircle /> Tolak</button>}
            {can.check && <button className="pap-primary-button" disabled={busy} onClick={check}><CheckCircle2 /> Periksa &amp; teruskan ke GM</button>}
            {s === 'disetujui' && <button className="pap-primary-button" disabled={busy} onClick={() => act('dipesan')}><ShoppingCart /> Tandai sudah dipesan</button>}
            {(s === 'disetujui' || s === 'dipesan') && <button className="pap-primary-button" disabled={busy} onClick={() => act('diterima')}><PackageCheck /> Barang diterima</button>}
          </div>
          {can.check && <p className="pap-hint">Pilih supplier dan tulis catatan (harga, estimasi tiba) bila perlu, lalu teruskan ke GM. Setelah GM, Accounting menyetujui.</p>}
          {s === 'diajukan' && item.checked_name && !can.approveGm && !can.approveAccounting && <p className="pap-hint">Sudah diperiksa Purchasing; menunggu persetujuan {item.gm_approved_name ? 'Accounting' : 'GM'}.</p>}
          {(s === 'disetujui' || s === 'dipesan') && rows.some((r) => r.item_id) && <p className="pap-hint">Saat ditandai diterima, barang yang terhubung ke data sparepart otomatis masuk stok.</p>}
        </section>
      )}
      {(s === 'disetujui' || s === 'dipesan' || s === 'diterima') && item.gm_approved_name && (
        <section className="pap-detail-section">
          <h3>Pemeriksaan & persetujuan</h3>
          <dl className="pap-detail-grid">
            {item.checked_name && <div><dt>Diperiksa Purchasing</dt><dd><CheckCircle2 className="pap-inline-icon" /> {item.checked_name} · {formatDate(item.checked_at, true)}</dd></div>}
            <div><dt>GM</dt><dd><ApprovalSig nama={item.gm_ttd_nama ?? item.gm_approved_name} jabatan={item.gm_ttd_jabatan} token={item.gm_ttd_token} at={item.gm_approved_at} /></dd></div>
            {item.acc_approved_name && <div><dt>Accounting</dt><dd><ApprovalSig nama={item.acc_ttd_nama ?? item.acc_approved_name} jabatan={item.acc_ttd_jabatan} token={item.acc_ttd_token} at={item.acc_approved_at} /></dd></div>}
          </dl>
        </section>
      )}
      {signing && (
        <ApproveSignDialog nomor={item.nomor} peran={can.approveGm ? 'GM' : 'Accounting'} userName={user.name} mine={mine} onClose={() => setSigning(false)} onSubmit={approve} />
      )}
      <AttachmentPanel title="Lampiran (foto barang, penawaran / nota vendor)" basePath={`/api/notes/purchase_request/${item.id}/attachments`} fileBase="/api/notes/attachments" canAdd={!['ditolak', 'batal'].includes(s)} currentUserId={user.id} isAdmin={user.role.isAdmin} />
    </Modal>
  )
}

type MySig = { image: string; jabatan: string | null } | null
type SignInput = { nama: string; jabatan: string; image: string; setuju: true; simpan: boolean }

// Tanda tangan penyetuju (GM / Accounting) di detail pengajuan
function ApprovalSig({ nama, jabatan, token, at }: { nama: string; jabatan: string | null; token: string | null; at: string | null }) {
  return (
    <div className="pap-pr-sig">
      {/* aislop-ignore-next-line next/no-img-element -- gambar tanda tangan privat lewat API (bukan aset statis) */}
      {token && <div className="pap-sig-image"><img src={`/api/ttd/${token}`} alt={`Tanda tangan ${nama}`} /></div>}
      <div><ShieldCheck className="pap-inline-icon" /> <b>{nama}</b>{jabatan && <> · {jabatan}</>}</div>
      <small className="pap-muted">{formatDate(at, true)}</small>
    </div>
  )
}

// Form tanda tangan persetujuan: nama, jabatan, gambar tanda tangan (atau pakai yang tersimpan), pernyataan sah
function ApproveSignDialog({ nomor, peran, userName, mine, onClose, onSubmit }: {
  nomor: string; peran: 'GM' | 'Accounting'; userName: string; mine: MySig; onClose: () => void; onSubmit: (ttd: SignInput) => Promise<void>
}) {
  const pad = useRef<SignaturePadHandle | null>(null)
  const [nama, setNama] = useState(userName)
  const [jabatan, setJabatan] = useState(mine?.jabatan ?? (peran === 'GM' ? 'General Manager' : 'Accounting'))
  const [empty, setEmpty] = useState(true)
  const [simpan, setSimpan] = useState(!mine)
  const [setuju, setSetuju] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const image = pad.current?.toDataUrl()
    if (!image) return setError('Gambar tanda tangan dulu di kotak yang tersedia.')
    if (!nama.trim()) return setError('Isi nama penandatangan.')
    if (!setuju) return setError('Centang pernyataan persetujuan.')
    setBusy(true)
    try {
      await onSubmit({ nama, jabatan, image, setuju: true, simpan })
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }
  return (
    <Modal title={`Tanda tangan persetujuan ${peran}`} subtitle={`Pengajuan pembelian ${nomor}`} wide onClose={onClose}
      footer={<><span className="pap-spacer" /><button type="button" className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="pap-pr-sig-form" disabled={busy || empty || !setuju}><CheckCircle2 /> {busy ? 'Menyimpan...' : `Setujui sebagai ${peran}`}</button></>}>
      <form id="pap-pr-sig-form" className="pap-sig-form" onSubmit={submit}>
        {error && <Notice onClose={() => setError('')}>{error}</Notice>}
        <div className="pap-form-grid">
          <label className="pap-field"><span>Nama penandatangan *</span><input className="pap-input" maxLength={150} required value={nama} onChange={(e) => setNama(e.target.value)} /></label>
          <label className="pap-field"><span>Jabatan</span><input className="pap-input" maxLength={150} value={jabatan} onChange={(e) => setJabatan(e.target.value)} /></label>
        </div>
        <div className="pap-field">
          <div className="pap-sig-pad-head">
            <span>Tanda tangan *</span>
            {mine && <button type="button" className="pap-link-button pap-shift-edit" onClick={() => pad.current?.load(mine.image)}>Pakai tanda tangan tersimpan</button>}
          </div>
          <SignaturePad ref={pad} onChange={setEmpty} />
        </div>
        <label className="pap-ma-check"><input type="checkbox" checked={simpan} onChange={(e) => setSimpan(e.target.checked)} /> Simpan sebagai tanda tangan saya (dipakai lagi tanpa menggambar ulang)</label>
        <label className="pap-sig-consent"><input type="checkbox" checked={setuju} onChange={(e) => setSetuju(e.target.checked)} /><span>Saya menyetujui pengajuan pembelian {nomor} sebagai {peran} dan menyatakan tanda tangan ini sah.</span></label>
        <small className="pap-muted">Tanda tangan tercetak di formulir PDF & Word. Bila isi pengajuan diubah, persetujuan dan tanda tangan diulang.</small>
      </form>
    </Modal>
  )
}
