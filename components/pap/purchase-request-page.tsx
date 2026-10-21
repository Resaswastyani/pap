'use client'

import { useCallback, useEffect, useState } from 'react'
import { Ban, CheckCircle2, PackageCheck, Plus, Search, ShoppingCart, Trash2, XCircle } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { AttachmentPanel } from './attachments'
import { api, Field, formatDate, Modal, Notice, Pager, usePaged } from './ui'

type Status = 'diajukan' | 'disetujui' | 'dipesan' | 'diterima' | 'ditolak' | 'batal'
type Priority = 'darurat' | 'tinggi' | 'normal'
type Pr = {
  id: number; nomor: string; keperluan: string; prioritas: Priority; dibutuhkan: string | null; status: Status; repair_id: number | null; repair_nomor: string | null
  repair_mesin: string | null; catatan_purchasing: string | null; requested_by: number; requested_name: string; requester_division: string
  processed_name: string | null; processed_at: string | null; received_at: string | null; created_at: string; item_count: number; item_names: string | null
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
  const [detailId, setDetailId] = useState<number | null>(focusId ?? null)

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
          <span>Teknik mengajukan pembelian sparepart / peralatan; Purchasing menyetujui, memesan, dan menandai diterima. Barang yang terhubung ke data sparepart otomatis masuk stok saat diterima.</span>
        </div>
        {can.create && <button className="pap-primary-button" onClick={() => setFormOpen(true)}><Plus /> Ajukan pembelian</button>}
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      <div className="pap-table-card">
        <div className="pap-filters pap-filters-top">
          <div className="pap-segmented" role="tablist" aria-label="Status pengajuan">
            {[['terbuka', `Berjalan (${open})`], ['diajukan', `Menunggu (${counts.diajukan ?? 0})`], ['diterima', 'Diterima'], ['semua', 'Semua']].map(([k, l]) => (
              <button key={k} role="tab" aria-selected={status === k} className={status === k ? 'active' : ''} onClick={() => setStatus(k)}>{l}</button>
            ))}
          </div>
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nomor, keperluan, barang..." /></label>
        </div>
        {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Pengajuan</th><th>Barang</th><th>Prioritas</th><th>Dibutuhkan</th><th>Status</th></tr></thead>
            <tbody>
              {paged.items.map((p) => (
                <tr key={p.id} className="pap-row-link" onClick={() => setDetailId(p.id)}>
                  <td className="pap-nowrap"><div className="pap-cell-title">{p.nomor}</div><div className="pap-cell-sub">{p.requested_name} · {formatDate(p.created_at)}</div></td>
                  <td><div className="pap-repair-keluhan">{p.item_names}</div><div className="pap-cell-sub">{p.item_count} barang · {p.keperluan}</div></td>
                  <td><span className={`pap-status ${PRIORITY_TONE[p.prioritas]}`}>{PRIORITY_LABEL[p.prioritas]}</span></td>
                  <td className="pap-nowrap">{p.dibutuhkan ? formatDate(p.dibutuhkan) : '—'}</td>
                  <td><span className={`pap-status ${STATUS_TONE[p.status]}`}>{STATUS_LABEL[p.status]}</span>{p.processed_name && <div className="pap-cell-sub">{p.processed_name}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !items.length && <div className="pap-empty">{status === 'terbuka' ? 'Tidak ada pengajuan yang sedang berjalan.' : 'Tidak ada pengajuan yang cocok.'}</div>}
          {loading && !items.length && <div className="pap-empty">Memuat pengajuan...</div>}
        </div>
        <Pager {...paged.pager} noun="pengajuan" />
      </div>
      {formOpen && <PrForm techItems={techItems} repairs={repairs} onClose={() => setFormOpen(false)} onSaved={(id) => { setFormOpen(false); flash('Pengajuan terkirim. Purchasing sudah mendapat notifikasi.'); setDetailId(id) }} />}
      {detailId && <PrDetail id={detailId} user={user} onClose={() => setDetailId(null)} onChanged={load} />}
    </>
  )
}

type Row = { key: number; item_id: string; nama: string; spesifikasi: string; jumlah: string; satuan: string }
let rowSeq = 0
const newRow = (src: Partial<Row> = {}): Row => ({ key: ++rowSeq, item_id: '', nama: '', spesifikasi: '', jumlah: '', satuan: 'pcs', ...src })

function PrForm({ techItems, repairs, onClose, onSaved }: { techItems: TechItem[]; repairs: Repair[]; onClose: () => void; onSaved: (id: number) => void }) {
  // Sparepart yang stoknya menipis disarankan lebih dulu
  const lowItems = techItems.filter((t) => t.stok_minimum > 0 && t.stok <= t.stok_minimum)
  const [values, setValues] = useState({ keperluan: '', prioritas: 'normal' as Priority, dibutuhkan: '', repair_id: '' })
  const [rows, setRows] = useState<Row[]>(() => [newRow()])
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
      const res = await api<{ id: number }>('/api/purchase-requests', { method: 'POST', json: { ...values, items: rows.map(({ key: _k, ...r }) => r) } })
      onSaved(res.id)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title="Ajukan pembelian ke Purchasing"
      subtitle="Sparepart, peralatan, atau bahan teknik"
      wide
      onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="pr-form" disabled={busy}><ShoppingCart /> {busy ? 'Mengirim...' : `Ajukan (${rows.length} barang)`}</button></>}
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

function PrDetail({ id, user, onClose, onChanged }: { id: number; user: UserProfile; onClose: () => void; onChanged: () => void }) {
  const [item, setItem] = useState<Pr | null>(null)
  const [rows, setRows] = useState<PrItem[]>([])
  const [can, setCan] = useState({ process: false, cancel: false })
  const [catatan, setCatatan] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try {
      const res = await api<{ item: Pr; items: PrItem[]; can: typeof can }>(`/api/purchase-requests/${id}`)
      setItem(res.item)
      setRows(res.items)
      setCan(res.can)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [id])
  useEffect(() => { load() }, [load])
  async function act(status: Status) {
    if (status === 'ditolak' && !catatan.trim()) return setError('Tuliskan alasan penolakan di kolom catatan.')
    if (status === 'batal' && !window.confirm('Batalkan pengajuan ini?')) return
    setBusy(true)
    setError('')
    try {
      await api(`/api/purchase-requests/${id}`, { method: 'PATCH', json: { status, catatan } })
      setCatatan('')
      await load()
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
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
        <span className="pap-spacer" />
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
        {item.processed_name && <div><dt>Diproses</dt><dd>{item.processed_name} · {formatDate(item.processed_at, true)}</dd></div>}
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
      {item.catatan_purchasing && <section className="pap-detail-section"><h3>Catatan Purchasing</h3><p className="pap-prewrap">{item.catatan_purchasing}</p></section>}
      {can.process && ['diajukan', 'disetujui', 'dipesan'].includes(s) && (
        <section className="pap-detail-section">
          <h3>Proses Purchasing</h3>
          <textarea className="pap-input" rows={2} maxLength={5000} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Catatan: vendor, harga, estimasi tiba, atau alasan ditolak" />
          <div className="pap-inline-actions pap-wrap">
            {s === 'diajukan' && <button className="pap-btn danger" disabled={busy} onClick={() => act('ditolak')}><XCircle /> Tolak</button>}
            {s === 'diajukan' && <button className="pap-primary-button" disabled={busy} onClick={() => act('disetujui')}><CheckCircle2 /> Setujui</button>}
            {s === 'disetujui' && <button className="pap-primary-button" disabled={busy} onClick={() => act('dipesan')}><ShoppingCart /> Tandai sudah dipesan</button>}
            {(s === 'disetujui' || s === 'dipesan') && <button className="pap-primary-button" disabled={busy} onClick={() => act('diterima')}><PackageCheck /> Barang diterima</button>}
          </div>
          {(s === 'disetujui' || s === 'dipesan') && rows.some((r) => r.item_id) && <p className="pap-hint">Saat ditandai diterima, barang yang terhubung ke data sparepart otomatis masuk stok.</p>}
        </section>
      )}
      <AttachmentPanel title="Lampiran (foto barang, penawaran / nota vendor)" basePath={`/api/notes/purchase_request/${item.id}/attachments`} fileBase="/api/notes/attachments" canAdd={!['ditolak', 'batal'].includes(s)} currentUserId={user.id} isAdmin={user.role.isAdmin} />
    </Modal>
  )
}
