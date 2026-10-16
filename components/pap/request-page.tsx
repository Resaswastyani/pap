'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Ban, CheckCircle2, Download, FileText, Hammer, Palette, Plus, RotateCcw, Search, Send, Trash2, Truck, Upload } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { ProspectSelect, type ProspectOption } from './marketing'
import { CustomerSelect, type CustomerOption } from './product-page'
import { AttachmentInput, AttachmentPanel, emptyAttachments, NoteFiles, uploadNoteAttachments, uploadPendingAttachments, type NoteAttachment, type PendingAttachments } from './attachments'
import { api, Field, formatDate, formatSize, Modal, Notice } from './ui'

// ---------------- Konstanta ----------------
type SampleStatus = 'diajukan' | 'dijadwalkan' | 'diproduksi' | 'selesai' | 'dikirim' | 'disetujui' | 'revisi' | 'batal'
const SAMPLE_LABEL: Record<SampleStatus, string> = {
  diajukan: 'Diajukan', dijadwalkan: 'Dijadwalkan PPIC', diproduksi: 'Diproduksi', selesai: 'Selesai produksi',
  dikirim: 'Dikirim ke customer', disetujui: 'Disetujui customer', revisi: 'Revisi spek', batal: 'Batal',
}
const SAMPLE_TONE: Record<SampleStatus, string> = { diajukan: 'warning', dijadwalkan: 'info', diproduksi: 'info', selesai: 'info', dikirim: 'info', disetujui: 'success', revisi: 'danger', batal: 'neutral' }
const SAMPLE_FLOW: SampleStatus[] = ['diajukan', 'dijadwalkan', 'diproduksi', 'selesai', 'dikirim', 'disetujui']

type DesignStatus = 'diajukan' | 'dikerjakan' | 'review' | 'revisi' | 'disetujui' | 'batal'
const DESIGN_LABEL: Record<DesignStatus, string> = { diajukan: 'Diajukan', dikerjakan: 'Dikerjakan', review: 'Review customer', revisi: 'Revisi', disetujui: 'Disetujui', batal: 'Batal' }
const DESIGN_TONE: Record<DesignStatus, string> = { diajukan: 'warning', dikerjakan: 'info', review: 'info', revisi: 'danger', disetujui: 'success', batal: 'neutral' }
const DESIGN_FLOW: DesignStatus[] = ['diajukan', 'dikerjakan', 'review', 'disetujui']

const JENIS = ['HD', 'PP', 'PE', 'Mika rigid', 'Plastik laundry', 'Lainnya']
const Badge = ({ tone, label }: { tone: string; label: string }) => <span className={`pap-status ${tone}`}>{label}</span>

type Log = { id: number; status_from: string | null; status_to: string | null; catatan: string | null; created_at: string; user_name: string; division_name: string; attachments?: NoteAttachment[] }
type PrefillProspect = { id: number; nama_usaha: string; kota: string | null; alamat: string | null; kontak_nama: string | null; kebutuhan?: string | null; products?: { product_id: number | null; label: string; jenis?: string | null; spesifikasi?: string | null; bahan?: string | null }[] }

// Langkah alur (stepper) dengan status batal/revisi ditandai
function Track<T extends string>({ flow, labels, status }: { flow: T[]; labels: Record<T, string>; status: T }) {
  const index = flow.indexOf(status)
  return (
    <ol className="pap-track">
      {flow.map((s, i) => <li key={s} className={i < index || (status === flow[flow.length - 1] && i === index) ? 'done' : i === index ? 'current' : ''}><span>{i + 1}</span>{labels[s]}</li>)}
    </ol>
  )
}

function Timeline({ logs, labels, user, onChanged }: { logs: Log[]; labels: Record<string, string>; user: UserProfile; onChanged: () => void }) {
  return (
    <section className="pap-detail-section">
      <h3>Riwayat</h3>
      <ol className="pap-note-list">
        {logs.map((l) => (
          <li key={l.id} className="pap-note-item">
            <div className="pap-note-head">
              {l.status_to && <span className="pap-note-progress">{labels[l.status_to] ?? l.status_to}</span>}
              <span className="pap-note-meta"><strong>{l.user_name}</strong> · {l.division_name} · {formatDate(l.created_at, true)}</span>
            </div>
            {l.catatan && <p className="pap-prewrap">{l.catatan}</p>}
            <NoteFiles items={l.attachments} currentUserId={user.id} isAdmin={user.role.isAdmin} onChanged={onChanged} />
          </li>
        ))}
      </ol>
    </section>
  )
}

// Prospek atau customer yang dituju
function TargetPicker({ prospect, onChange }: { prospect?: PrefillProspect | null; onChange: (t: { prospect_id: number | null; customer_id: number | null }) => void }) {
  const [mode, setMode] = useState<'prospek' | 'customer'>('prospek')
  const [p, setP] = useState<ProspectOption | null>(null)
  const [c, setC] = useState<CustomerOption | null>(null)
  if (prospect) return <input className="pap-input" value={prospect.nama_usaha} disabled />
  return (
    <div className="pap-target-picker">
      <div className="pap-segmented">
        <button type="button" className={mode === 'prospek' ? 'active' : ''} onClick={() => { setMode('prospek'); onChange({ prospect_id: p?.id ?? null, customer_id: null }) }}>Prospek</button>
        <button type="button" className={mode === 'customer' ? 'active' : ''} onClick={() => { setMode('customer'); onChange({ prospect_id: null, customer_id: c?.id ?? null }) }}>Customer</button>
      </div>
      {mode === 'prospek'
        ? <ProspectSelect value={p} onChange={(v) => { setP(v); onChange({ prospect_id: v.id, customer_id: null }) }} />
        : <CustomerSelect value={c} onChange={(v) => { setC(v); onChange({ prospect_id: null, customer_id: v.id }) }} />}
    </div>
  )
}

// Produk acuan dari Data Produk (opsional)
type ProductRef = { id: number; nama: string; jenis: string | null; spesifikasi: string | null; bahan: string | null; customer_name: string | null }
function ProductRefSelect({ value, onChange }: { value: ProductRef | null; onChange: (p: ProductRef | null) => void }) {
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<ProductRef[]>([])
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => api<{ items: ProductRef[] }>(`/api/products?status=aktif&q=${encodeURIComponent(term)}`).then((r) => setOptions(r.items.slice(0, 15))).catch(() => {}), 250)
    return () => clearTimeout(timer)
  }, [term, open])
  return (
    <div className="pap-combo">
      <input
        className="pap-input"
        value={open ? term : value?.nama ?? ''}
        placeholder="Opsional: cari produk di Data Produk..."
        onFocus={() => { setOpen(true); setTerm('') }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => setTerm(e.target.value)}
      />
      {open && (
        <ul className="pap-combo-list">
          {value && <li><button type="button" onMouseDown={() => onChange(null)}><strong>Tanpa produk acuan</strong><small>Produk baru / custom</small></button></li>}
          {options.map((p) => <li key={p.id}><button type="button" onMouseDown={() => { onChange(p); setOpen(false) }}><strong>{p.nama}</strong><small>{[p.jenis, p.spesifikasi, p.customer_name].filter(Boolean).join(' · ')}</small></button></li>)}
          {!options.length && <li className="pap-combo-empty">Ketik untuk mencari produk.</li>}
        </ul>
      )}
    </div>
  )
}

const ask = (message: string) => {
  const value = window.prompt(message)
  return value === null ? null : value.trim()
}

// ================================================================
// REQUEST SAMPLE
// ================================================================
type Sample = {
  id: number; nomor: string; prospect_id: number | null; customer_id: number | null; product_id: number | null
  nama_produk: string; jenis: string | null; ukuran: string | null; ketebalan: string | null; bahan: string | null; warna_cetak: string | null
  jumlah: string | null; spesifikasi: string | null; special_request: string | null; tenggat: string | null; status: SampleStatus
  jadwal_produksi: string | null; pengiriman: string | null; feedback: string | null; revisi_ke: number; requested_by: number
  requested_name: string; target_name: string | null; customer_no: string | null; product_name: string | null; created_at: string; item_count: number
}
type SampleItemRow = {
  id: number; product_id: number | null; nama_produk: string; jenis: string | null; ukuran: string | null; ketebalan: string | null
  bahan: string | null; warna_cetak: string | null; jumlah: string | null; catatan: string | null; product_name: string | null
}
type SampleRoles = { canRequest: boolean; ppic: boolean; produksi: boolean; isRequester?: boolean }

export function SamplePage({ user, focusId }: { user: UserProfile; focusId?: number | null }) {
  const [items, setItems] = useState<Sample[]>([])
  const [counts, setCounts] = useState({ todo: 0, aktif: 0 })
  const [summary, setSummary] = useState<Partial<Record<SampleStatus, number>>>({})
  const [roles, setRoles] = useState<SampleRoles>({ canRequest: false, ppic: false, produksi: false })
  const [status, setStatus] = useState('aktif')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(focusId ?? null)
  const statusInit = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ status })
      if (q.trim()) params.set('q', q.trim())
      const res = await api<{ items: Sample[]; counts: typeof counts; summary: typeof summary; roles: SampleRoles }>(`/api/samples?${params}`)
      setItems(res.items)
      setCounts(res.counts)
      setSummary(res.summary)
      setRoles(res.roles)
      // Pertama dibuka: langsung tampilkan yang perlu ditindaklanjuti bila ada
      if (!statusInit.current) {
        statusInit.current = true
        if (res.counts.todo && status === 'aktif') setStatus('todo')
      }
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
  const flash = (text: string) => { setMessage(text); setTimeout(() => setMessage(''), 5000); load() }

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">MARKETING · PPIC · PRODUKSI</p>
          <h1>Request Sample</h1>
          <span>Sales mengajukan sample, PPIC menjadwalkan, Produksi membuat, sample dikirim, lalu customer menyetujui atau minta revisi spek.</span>
        </div>
        {roles.canRequest && <button className="pap-primary-button" onClick={() => setForm(true)}><Plus /> Request sample</button>}
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      <RequestFilters
        status={status} setStatus={setStatus} q={q} setQ={setQ} counts={counts} summary={summary}
        labels={SAMPLE_LABEL} order={[...SAMPLE_FLOW, 'revisi', 'batal']} placeholder="Cari nomor, produk, prospek/customer..."
      />
      <div className="pap-table-card">
        {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Nomor</th><th>Produk sample</th><th>Untuk</th><th>Diajukan</th><th>Dibutuhkan</th><th>Jadwal produksi</th><th>Status</th></tr></thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="pap-row-link" onClick={() => setDetailId(s.id)}>
                  <td><div className="pap-cell-title">{s.nomor}</div>{s.revisi_ke > 0 && <div className="pap-cell-sub">Revisi {s.revisi_ke}</div>}</td>
                  <td><div className="pap-cell-title">{s.nama_produk}</div><div className="pap-cell-sub">{s.item_count > 1 ? `${s.item_count} produk` : [s.jenis, s.ukuran, s.jumlah].filter(Boolean).join(' · ')}</div></td>
                  <td>{s.target_name ?? '—'}</td>
                  <td>{s.requested_name}<div className="pap-cell-sub">{formatDate(s.created_at)}</div></td>
                  <td className={s.tenggat && s.tenggat < new Date().toISOString().slice(0, 10) && !['disetujui', 'batal', 'dikirim'].includes(s.status) ? 'pap-followup overdue' : ''}>{formatDate(s.tenggat)}</td>
                  <td>{formatDate(s.jadwal_produksi)}</td>
                  <td><Badge tone={SAMPLE_TONE[s.status]} label={SAMPLE_LABEL[s.status]} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !items.length && <div className="pap-empty">{status === 'todo' ? 'Tidak ada sample yang menunggu tindakan Anda.' : 'Belum ada request sample.'}</div>}
          {loading && !items.length && <div className="pap-empty">Memuat...</div>}
        </div>
      </div>
      {form && <SampleForm onClose={() => setForm(false)} onSaved={(text, id) => { setForm(false); flash(text); setDetailId(id) }} />}
      {detailId && <SampleDetail id={detailId} user={user} onClose={() => setDetailId(null)} onChanged={(text) => flash(text)} />}
    </>
  )
}

function RequestFilters({ status, setStatus, q, setQ, counts, summary, labels, order, placeholder }: {
  status: string; setStatus: (s: string) => void; q: string; setQ: (q: string) => void
  counts: { todo: number; aktif: number }; summary: Record<string, number | undefined>; labels: Record<string, string>; order: string[]; placeholder: string
}) {
  return (
    <div className="pap-request-filters">
      <div className="pap-chip-tabs">
        <button className={status === 'todo' ? 'active todo' : 'todo'} onClick={() => setStatus('todo')}>Perlu tindakan saya <b>{counts.todo}</b></button>
        <button className={status === 'aktif' ? 'active' : ''} onClick={() => setStatus('aktif')}>Sedang berjalan <b>{counts.aktif}</b></button>
        {order.map((s) => <button key={s} className={status === s ? 'active' : ''} onClick={() => setStatus(s)}>{labels[s]} <b>{summary[s] ?? 0}</b></button>)}
        <button className={status === '' ? 'active' : ''} onClick={() => setStatus('')}>Semua</button>
      </div>
      <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} /></label>
    </div>
  )
}

// Form pengajuan sample baru, atau ajukan ulang dengan spek revisi (resubmit).
// Produk sample full custom: diketik bebas dengan spesifikasinya (tidak diambil dari Data Produk / Accurate).
// Satu request bisa berisi beberapa produk, plus lampiran (file apa pun maks 2 MB, foto langsung, link).
type SampleItemForm = {
  key: string; nama_produk: string; jenis: string; ukuran: string; ketebalan: string
  bahan: string; warna_cetak: string; jumlah: string; catatan: string
}
let itemSeq = 0
const newItem = (src: Partial<SampleItemForm> = {}): SampleItemForm => ({
  key: `i${++itemSeq}`, nama_produk: '', jenis: '', ukuran: '', ketebalan: '', bahan: '', warna_cetak: '', jumlah: '', catatan: '', ...src,
})

export function SampleForm({ prospect, resubmit, resubmitItems, onClose, onSaved }: {
  prospect?: PrefillProspect | null
  resubmit?: Sample
  resubmitItems?: SampleItemRow[]
  onClose: () => void
  onSaved: (message: string, id: number) => void
}) {
  const [target, setTarget] = useState<{ prospect_id: number | null; customer_id: number | null }>({ prospect_id: prospect?.id ?? null, customer_id: null })
  const [items, setItems] = useState<SampleItemForm[]>(() =>
    resubmitItems?.length
      ? resubmitItems.map((r) => newItem({ nama_produk: r.nama_produk, jenis: r.jenis ?? '', ukuran: r.ukuran ?? '', ketebalan: r.ketebalan ?? '', bahan: r.bahan ?? '', warna_cetak: r.warna_cetak ?? '', jumlah: r.jumlah ?? '', catatan: r.catatan ?? '' }))
      : [newItem()],
  )
  const [values, setValues] = useState({
    tenggat: resubmit?.tenggat ?? '',
    spesifikasi: resubmit?.spesifikasi ?? '',
    special_request: resubmit?.special_request ?? '',
    catatan: '',
  })
  const [attachments, setAttachments] = useState<PendingAttachments>(emptyAttachments)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (key: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }))
  const update = (key: string, patch: Partial<SampleItemForm>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (!items.length) throw new Error('Tambahkan minimal satu produk sample.')
      const payload = { ...values, items: items.map(({ key: _key, ...rest }) => rest) }
      let id: number
      let message: string
      if (resubmit) {
        await api(`/api/samples/${resubmit.id}/status`, { method: 'POST', json: { ...payload, status: 'diajukan' } })
        id = resubmit.id
        message = 'Sample diajukan ulang ke PPIC dengan spek revisi.'
      } else {
        const res = await api<{ id: number; nomor: string }>('/api/samples', { method: 'POST', json: { ...payload, ...target } })
        id = res.id
        message = `Request sample ${res.nomor} terkirim ke PPIC.`
      }
      const failed = await uploadPendingAttachments(`/api/samples/${id}/attachments`, attachments)
      onSaved(failed.length ? `${message} Sebagian lampiran gagal diunggah: ${failed.join(' ')}` : message, id)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={resubmit ? `Ajukan ulang ${resubmit.nomor}` : 'Request sample'}
      subtitle={resubmit ? `Revisi dari customer: ${resubmit.feedback ?? '—'}` : 'Produk custom, dikirim ke PPIC untuk dijadwalkan produksi'}
      wide
      onClose={onClose}
      footer={<><span className="pap-spacer" /><button type="button" className="pap-btn" onClick={onClose}>Batal</button><button type="submit" form="sample-form" className="pap-primary-button" disabled={saving}><Send /> {saving ? 'Mengirim...' : resubmit ? 'Ajukan ulang' : `Kirim ke PPIC (${items.length} produk)`}</button></>}
    >
      <form id="sample-form" className="pap-form-grid" onSubmit={submit}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        {!resubmit && <Field label="Untuk" full><TargetPicker prospect={prospect} onChange={setTarget} /></Field>}

        <div className="pap-field full">
          <span>Produk sample custom ({items.length})</span>
          <div className="pap-sample-items">
            {items.map((it, index) => (
              <div key={it.key} className="pap-sample-item">
                <div className="pap-sample-item-head">
                  <b>{index + 1}</b>
                  <input className="pap-input" required maxLength={255} value={it.nama_produk} onChange={(e) => update(it.key, { nama_produk: e.target.value })} placeholder="Nama produk sample" aria-label={`Nama produk ${index + 1}`} />
                  {items.length > 1 && <button type="button" className="pap-icon-button" aria-label={`Hapus produk ${index + 1}`} onClick={() => setItems((list) => list.filter((i) => i.key !== it.key))}><Trash2 /></button>}
                </div>
                <div className="pap-sample-spec-grid">
                  <input className="pap-input" list="pap-jenis-sample" maxLength={80} value={it.jenis} onChange={(e) => update(it.key, { jenis: e.target.value })} placeholder="Jenis (HD/PE/PP...)" aria-label="Jenis" />
                  <input className="pap-input" maxLength={150} value={it.ukuran} onChange={(e) => update(it.key, { ukuran: e.target.value })} placeholder="Ukuran, mis. 40 x 60 cm" aria-label="Ukuran" />
                  <input className="pap-input" maxLength={80} value={it.ketebalan} onChange={(e) => update(it.key, { ketebalan: e.target.value })} placeholder="Ketebalan, mis. 40 mikron" aria-label="Ketebalan" />
                  <input className="pap-input" maxLength={255} value={it.bahan} onChange={(e) => update(it.key, { bahan: e.target.value })} placeholder="Bahan, mis. HDPE" aria-label="Bahan" />
                  <input className="pap-input" maxLength={255} value={it.warna_cetak} onChange={(e) => update(it.key, { warna_cetak: e.target.value })} placeholder="Warna / cetak" aria-label="Warna / cetak" />
                  <input className="pap-input" maxLength={80} value={it.jumlah} onChange={(e) => update(it.key, { jumlah: e.target.value })} placeholder="Jumlah, mis. 50 pcs" aria-label="Jumlah" />
                  <input className="pap-input full" maxLength={1000} value={it.catatan} onChange={(e) => update(it.key, { catatan: e.target.value })} placeholder="Catatan / spek lain (model, seal, lubang...)" aria-label="Catatan produk" />
                </div>
              </div>
            ))}
            <button type="button" className="pap-btn pap-add-item" onClick={() => setItems((list) => [...list, newItem()])}><Plus /> Tambah produk lain</button>
          </div>
        </div>

        <Field label="Dibutuhkan tanggal (opsional)"><input className="pap-input" type="date" value={values.tenggat} onChange={set('tenggat')} /></Field>
        <span />
        <Field label="Catatan umum (opsional)" full><textarea className="pap-input" rows={2} maxLength={5000} value={values.spesifikasi} onChange={set('spesifikasi')} /></Field>
        <Field label="Special request customer (opsional)" full><textarea className="pap-input" rows={2} maxLength={5000} value={values.special_request} onChange={set('special_request')} /></Field>
        {resubmit && <Field label="Catatan untuk PPIC" full><input className="pap-input" maxLength={1000} value={values.catatan} onChange={set('catatan')} placeholder="Apa yang berubah dari sample sebelumnya" /></Field>}
        <Field label="Lampiran (opsional)" full><AttachmentInput value={attachments} onChange={setAttachments} /></Field>
        <datalist id="pap-jenis-sample">{JENIS.map((j) => <option key={j} value={j} />)}</datalist>
      </form>
    </Modal>
  )
}

function SampleDetail({ id, user, onClose, onChanged }: { id: number; user: UserProfile; onClose: () => void; onChanged: (message: string) => void }) {
  const [item, setItem] = useState<Sample | null>(null)
  const [items, setItems] = useState<SampleItemRow[]>([])
  const [logs, setLogs] = useState<Log[]>([])
  const [roles, setRoles] = useState<SampleRoles>({ canRequest: false, ppic: false, produksi: false })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [jadwal, setJadwal] = useState('')
  const [catatan, setCatatan] = useState('')
  const [noteFiles, setNoteFiles] = useState<PendingAttachments>(emptyAttachments)
  const [pengiriman, setPengiriman] = useState('')
  const [resubmit, setResubmit] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await api<{ item: Sample; items: SampleItemRow[]; logs: Log[]; roles: SampleRoles }>(`/api/samples/${id}`)
      setItem(res.item)
      setItems(res.items)
      setLogs(res.logs)
      setRoles(res.roles)
      setJadwal(res.item.jadwal_produksi ?? res.item.tenggat ?? '')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [id])
  useEffect(() => { load() }, [load])

  async function act(json: Record<string, unknown>, text: string) {
    setBusy(true)
    setError('')
    try {
      const res = await api<{ logId?: number }>(`/api/samples/${id}/status`, { method: 'POST', json })
      const failed = res.logId ? await uploadNoteAttachments('request_log', res.logId, noteFiles) : []
      setCatatan('')
      setNoteFiles(emptyAttachments())
      await load()
      onChanged(failed.length ? `${text} Sebagian lampiran gagal: ${failed.join(' ')}` : text)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  if (!item) return <Modal title="Request sample" onClose={onClose}>{error ? <Notice>{error}</Notice> : <p className="pap-muted">Memuat...</p>}</Modal>
  const s = item.status
  const requester = !!roles.isRequester
  const canCancel = !['disetujui', 'batal', 'dikirim'].includes(s) && (requester || roles.ppic)
  const note = <><textarea className="pap-input" rows={2} maxLength={5000} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Catatan (opsional)" /><div className="pap-note-attach"><AttachmentInput value={noteFiles} onChange={setNoteFiles} /></div></>

  return (
    <>
      <Modal
        title={`${item.nomor} · ${item.nama_produk}`}
        subtitle={`Untuk ${item.target_name ?? '—'} · diajukan ${item.requested_name}, ${formatDate(item.created_at, true)}`}
        wide
        onClose={onClose}
        footer={<>{canCancel && <button className="pap-btn danger" disabled={busy} onClick={() => { const a = ask('Alasan membatalkan request sample:'); if (a) act({ status: 'batal', catatan: a }, 'Request sample dibatalkan.') }}><Ban /> Batalkan</button>}<span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Tutup</button></>}
      >
        {error && <Notice onClose={() => setError('')}>{error}</Notice>}
        <div className="pap-detail-badges"><Badge tone={SAMPLE_TONE[s]} label={SAMPLE_LABEL[s]} />{item.revisi_ke > 0 && <span className="pap-status warning">Revisi ke-{item.revisi_ke}</span>}</div>
        {s !== 'batal' && <Track flow={SAMPLE_FLOW} labels={SAMPLE_LABEL} status={s === 'revisi' ? 'dikirim' : s} />}

        {/* Panel tindakan sesuai peran & tahap */}
        {s === 'diajukan' && roles.ppic && (
          <div className="pap-inline-panel">
            <strong>PPIC: jadwalkan produksi sample</strong>
            <div className="pap-activity-row two"><label className="pap-activity-date"><span>Tanggal produksi</span><input className="pap-input" type="date" value={jadwal} onChange={(e) => setJadwal(e.target.value)} /></label>{note}</div>
            <div className="pap-inline-actions"><button className="pap-primary-button" disabled={busy || !jadwal} onClick={() => act({ status: 'dijadwalkan', jadwal_produksi: jadwal, catatan }, 'Sample dijadwalkan, Produksi diberi tahu.')}><CheckCircle2 /> Jadwalkan</button></div>
          </div>
        )}
        {s === 'dijadwalkan' && (roles.produksi || roles.ppic) && (
          <div className="pap-inline-panel">
            <strong>{roles.produksi ? 'Produksi' : 'PPIC'}: sample dijadwalkan {formatDate(item.jadwal_produksi)}</strong>
            {note}
            <div className="pap-inline-actions pap-wrap">
              {roles.ppic && <button className="pap-btn" disabled={busy || !jadwal} onClick={() => act({ status: 'dijadwalkan', jadwal_produksi: jadwal, catatan: catatan || 'Jadwal diubah' }, 'Jadwal produksi diubah.')}>Ubah jadwal ke</button>}
              {roles.ppic && <input className="pap-input pap-date-inline" type="date" value={jadwal} onChange={(e) => setJadwal(e.target.value)} />}
              <span className="pap-spacer" />
              <button className="pap-primary-button" disabled={busy} onClick={() => act({ status: 'diproduksi', catatan }, 'Produksi sample dimulai.')}><Hammer /> Mulai produksi</button>
            </div>
          </div>
        )}
        {s === 'diproduksi' && (roles.produksi || roles.ppic) && (
          <div className="pap-inline-panel">
            <strong>Produksi: sample sedang dibuat</strong>
            {note}
            <div className="pap-inline-actions"><button className="pap-primary-button" disabled={busy} onClick={() => act({ status: 'selesai', catatan }, 'Sample selesai diproduksi, sales diberi tahu.')}><CheckCircle2 /> Selesai produksi</button></div>
          </div>
        )}
        {s === 'selesai' && (requester || roles.ppic) && (
          <div className="pap-inline-panel">
            <strong>Kirim sample ke customer</strong>
            <input className="pap-input" maxLength={255} value={pengiriman} onChange={(e) => setPengiriman(e.target.value)} placeholder="Diantar sales / nama kurir + nomor resi" />
            {note}
            <div className="pap-inline-actions"><button className="pap-primary-button" disabled={busy || !pengiriman.trim()} onClick={() => act({ status: 'dikirim', pengiriman, catatan }, 'Sample ditandai dikirim.')}><Truck /> Tandai dikirim</button></div>
          </div>
        )}
        {s === 'dikirim' && requester && (
          <div className="pap-inline-panel">
            <strong>Tanggapan customer atas sample</strong>
            <textarea className="pap-input" rows={3} maxLength={5000} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Tanggapan customer. Wajib diisi bila minta revisi: bagian spek apa yang diubah." />
            <div className="pap-note-attach"><AttachmentInput value={noteFiles} onChange={setNoteFiles} /></div>
            <div className="pap-inline-actions pap-wrap">
              <button className="pap-btn danger" disabled={busy || !catatan.trim()} onClick={() => act({ status: 'revisi', catatan }, 'Revisi spek dicatat, PPIC & Produksi diberi tahu.')}><RotateCcw /> Minta revisi spek</button>
              <span className="pap-spacer" />
              <button className="pap-primary-button" disabled={busy} onClick={() => act({ status: 'disetujui', catatan }, 'Sample disetujui customer.')}><CheckCircle2 /> Customer setuju</button>
            </div>
          </div>
        )}
        {s === 'revisi' && requester && (
          <div className="pap-inline-panel">
            <strong>Customer minta revisi spek</strong>
            <p className="pap-prewrap">{item.feedback}</p>
            <div className="pap-inline-actions"><button className="pap-primary-button" onClick={() => setResubmit(true)}><Send /> Ubah spek & ajukan ulang</button></div>
          </div>
        )}

        <section className="pap-detail-section pap-sample-table">
          <h3>Produk sample ({items.length})</h3>
          <div className="pap-table-wrap">
            <table>
              <thead><tr><th>#</th><th>Produk</th><th>Jenis</th><th>Ukuran</th><th>Ketebalan</th><th>Bahan</th><th>Warna / cetak</th><th>Jumlah</th></tr></thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={it.id}>
                    <td>{i + 1}</td>
                    <td><div className="pap-cell-title">{it.nama_produk}</div>{it.product_name && <div className="pap-cell-sub">Data Produk: {it.product_name}</div>}{it.catatan && <div className="pap-cell-sub pap-prewrap">{it.catatan}</div>}</td>
                    <td>{it.jenis ?? '—'}</td><td>{it.ukuran ?? '—'}</td><td>{it.ketebalan ?? '—'}</td><td>{it.bahan ?? '—'}</td><td>{it.warna_cetak ?? '—'}</td><td>{it.jumlah ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <dl className="pap-detail-grid">
          <div><dt>Dibutuhkan</dt><dd>{formatDate(item.tenggat)}</dd></div>
          <div><dt>Jadwal produksi</dt><dd>{formatDate(item.jadwal_produksi)}</dd></div>
          {item.pengiriman && <div><dt>Pengiriman</dt><dd>{item.pengiriman}</dd></div>}
          {item.spesifikasi && <div className="full"><dt>Catatan umum</dt><dd className="pap-prewrap">{item.spesifikasi}</dd></div>}
          {item.special_request && <div className="full"><dt>Special request</dt><dd className="pap-prewrap">{item.special_request}</dd></div>}
          {item.feedback && s !== 'revisi' && <div className="full"><dt>Tanggapan customer</dt><dd className="pap-prewrap">{item.feedback}</dd></div>}
        </dl>
        <AttachmentPanel title="Lampiran sample" basePath={`/api/samples/${item.id}/attachments`} fileBase="/api/samples/attachments" canAdd={item.status !== 'batal'} currentUserId={user.id} isAdmin={user.role.isAdmin} />
        <Timeline logs={logs} labels={SAMPLE_LABEL} user={user} onChanged={load} />
      </Modal>
      {resubmit && <SampleForm resubmit={item} resubmitItems={items} onClose={() => setResubmit(false)} onSaved={(text) => { setResubmit(false); load(); onChanged(text) }} />}
    </>
  )
}

// ================================================================
// REQUEST DESAIN
// ================================================================
type Design = {
  id: number; nomor: string; prospect_id: number | null; customer_id: number | null; product_id: number | null
  judul: string; jenis: string | null; ukuran: string | null; warna_cetak: string | null; brief: string; deadline: string | null
  status: DesignStatus; designer_id: number | null; revisi_ke: number; feedback: string | null; final_file_id: number | null
  requested_by: number; requested_name: string; designer_name: string | null; target_name: string | null; customer_no: string | null
  product_name: string | null; design_count: number; created_at: string
}
type DesignFile = { id: number; kind: 'referensi' | 'desain'; versi: number; name: string; mime: string; size: number; created_at: string; uploaded_by_name: string }
type DesignRoles = { canRequest: boolean; designer: boolean; isRequester?: boolean; isDesignerOf?: boolean }

export function DesignPage({ user, focusId }: { user: UserProfile; focusId?: number | null }) {
  const [items, setItems] = useState<Design[]>([])
  const [counts, setCounts] = useState({ todo: 0, aktif: 0 })
  const [summary, setSummary] = useState<Partial<Record<DesignStatus, number>>>({})
  const [roles, setRoles] = useState<DesignRoles>({ canRequest: false, designer: false })
  const [status, setStatus] = useState('aktif')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(focusId ?? null)
  const statusInit = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ status })
      if (q.trim()) params.set('q', q.trim())
      const res = await api<{ items: Design[]; counts: typeof counts; summary: typeof summary; roles: DesignRoles }>(`/api/designs?${params}`)
      setItems(res.items)
      setCounts(res.counts)
      setSummary(res.summary)
      setRoles(res.roles)
      if (!statusInit.current) {
        statusInit.current = true
        if (res.counts.todo && status === 'aktif') setStatus('todo')
      }
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
  const flash = (text: string) => { setMessage(text); setTimeout(() => setMessage(''), 5000); load() }

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">MARKETING · TIM DESAIN</p>
          <h1>Request Desain</h1>
          <span>Sales mengirim brief desain klise, Tim Desain mengunggah desain, customer menyetujui atau minta revisi. Desain final otomatis masuk ke Data Produk.</span>
        </div>
        {roles.canRequest && <button className="pap-primary-button" onClick={() => setForm(true)}><Plus /> Request desain</button>}
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      <RequestFilters
        status={status} setStatus={setStatus} q={q} setQ={setQ} counts={counts} summary={summary}
        labels={DESIGN_LABEL} order={[...DESIGN_FLOW, 'revisi', 'batal']} placeholder="Cari nomor, judul, prospek/customer..."
      />
      <div className="pap-table-card">
        {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Nomor</th><th>Desain</th><th>Untuk</th><th>Sales</th><th>Desainer</th><th>Deadline</th><th>Status</th></tr></thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id} className="pap-row-link" onClick={() => setDetailId(d.id)}>
                  <td><div className="pap-cell-title">{d.nomor}</div>{d.revisi_ke > 0 && <div className="pap-cell-sub">Revisi {d.revisi_ke}</div>}</td>
                  <td><div className="pap-cell-title">{d.judul}</div><div className="pap-cell-sub">{[d.jenis, d.ukuran, d.design_count ? `${d.design_count} file desain` : null].filter(Boolean).join(' · ')}</div></td>
                  <td>{d.target_name ?? '—'}</td>
                  <td>{d.requested_name}<div className="pap-cell-sub">{formatDate(d.created_at)}</div></td>
                  <td>{d.designer_name ?? <span className="pap-muted">Belum diambil</span>}</td>
                  <td className={d.deadline && d.deadline < new Date().toISOString().slice(0, 10) && !['disetujui', 'batal'].includes(d.status) ? 'pap-followup overdue' : ''}>{formatDate(d.deadline)}</td>
                  <td><Badge tone={DESIGN_TONE[d.status]} label={DESIGN_LABEL[d.status]} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !items.length && <div className="pap-empty">{status === 'todo' ? 'Tidak ada desain yang menunggu tindakan Anda.' : 'Belum ada request desain.'}</div>}
          {loading && !items.length && <div className="pap-empty">Memuat...</div>}
        </div>
      </div>
      {form && <DesignForm onClose={() => setForm(false)} onSaved={(text, id) => { setForm(false); flash(text); setDetailId(id) }} />}
      {detailId && <DesignDetail id={detailId} user={user} onClose={() => setDetailId(null)} onChanged={flash} />}
    </>
  )
}

// Format file desain & referensi: PDF atau gambar, maks 4 MB. Semua file dicek dulu sebelum ada yang diunggah.
const DESIGN_FILE_ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp'
const DESIGN_FILE_EXT = /\.(pdf|jpe?g|png|webp)$/i
const DESIGN_FILE_MAX = 4 * 1024 * 1024
export function checkDesignFiles(files: File[]) {
  const problems = files.flatMap((f) => {
    const typeOk = DESIGN_FILE_ACCEPT.split(',').includes(f.type) || (!f.type && DESIGN_FILE_EXT.test(f.name))
    if (!typeOk) return [`${f.name} (format tidak didukung)`]
    if (f.size > DESIGN_FILE_MAX) return [`${f.name} (${formatSize(f.size)}, maks 4 MB)`]
    return []
  })
  return problems.length ? `File ditolak: ${problems.join(', ')}. Hanya PDF, JPG, PNG, atau WEBP, maks 4 MB per file.` : ''
}

async function uploadDesignFile(designId: number, kind: 'referensi' | 'desain', file: File) {
  const form = new FormData()
  form.append('kind', kind)
  form.append('file', file)
  await api(`/api/designs/${designId}/files`, { method: 'POST', body: form })
}

export function DesignForm({ prospect, onClose, onSaved }: { prospect?: PrefillProspect | null; onClose: () => void; onSaved: (message: string, id: number) => void }) {
  const [target, setTarget] = useState<{ prospect_id: number | null; customer_id: number | null }>({ prospect_id: prospect?.id ?? null, customer_id: null })
  const [product, setProduct] = useState<ProductRef | null>(null)
  const [values, setValues] = useState({ judul: prospect?.kebutuhan?.split(';')[0]?.trim() ?? '', deadline: '', brief: '' })
  const [files, setFiles] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (key: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const invalid = checkDesignFiles(files)
      if (invalid) throw new Error(invalid)
      const res = await api<{ id: number; nomor: string }>('/api/designs', { method: 'POST', json: { ...values, ...target, product_id: product?.id ?? null } })
      const failed: string[] = []
      for (const file of files) await uploadDesignFile(res.id, 'referensi', file).catch((err: Error) => failed.push(err.message))
      onSaved(`Request desain ${res.nomor} terkirim ke Tim Desain.${failed.length ? ` Sebagian referensi gagal diunggah: ${failed.join('; ')}` : ''}`, res.id)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal
      title="Request desain klise"
      subtitle="Brief dikirim ke Tim Desain"
      wide
      onClose={onClose}
      footer={<><span className="pap-spacer" /><button type="button" className="pap-btn" onClick={onClose}>Batal</button><button type="submit" form="design-form" className="pap-primary-button" disabled={saving}><Send /> {saving ? 'Mengirim...' : 'Kirim ke Tim Desain'}</button></>}
    >
      <form id="design-form" className="pap-form-grid" onSubmit={submit}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Untuk" full><TargetPicker prospect={prospect} onChange={setTarget} /></Field>
        <Field label="Produk yang sudah ada" full hint="Pilih bila ini revisi desain produk lama; desain final akan ditambahkan ke produk tersebut. Kosongkan untuk produk baru.">
          <ProductRefSelect value={product} onChange={(p) => { setProduct(p); if (p) setValues((v) => ({ ...v, judul: p.nama })) }} />
        </Field>
        <Field label="Nama produk / desain" full><input className="pap-input" required maxLength={255} value={values.judul} onChange={set('judul')} placeholder="Contoh: Kantong laundry Bersih Jaya 40x60" /></Field>
        <Field label="Deadline"><input className="pap-input" type="date" value={values.deadline} onChange={set('deadline')} /></Field>
        <Field label="Brief desain" full><textarea className="pap-input" rows={4} required maxLength={10000} value={values.brief} onChange={set('brief')} placeholder="Isi teks (nama usaha, alamat, nomor WA), logo, posisi, gaya, warna dominan, contoh yang disukai customer..." /></Field>
        <Field label="File referensi (opsional)" full hint="Logo, foto contoh, sketsa. PDF/JPG/PNG/WEBP, maks 4 MB per file.">
          <input className="pap-input" type="file" multiple accept={DESIGN_FILE_ACCEPT} onChange={(e) => { const list = [...(e.target.files ?? [])]; const invalid = checkDesignFiles(list); setError(invalid); setFiles(invalid ? [] : list); if (invalid) e.target.value = '' }} />
        </Field>
      </form>
    </Modal>
  )
}

function DesignDetail({ id, user, onClose, onChanged }: { id: number; user: UserProfile; onClose: () => void; onChanged: (message: string) => void }) {
  const [item, setItem] = useState<Design | null>(null)
  const [files, setFiles] = useState<DesignFile[]>([])
  const [logs, setLogs] = useState<Log[]>([])
  const [roles, setRoles] = useState<DesignRoles>({ canRequest: false, designer: false })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [catatan, setCatatan] = useState('')
  const [noteFiles, setNoteFiles] = useState<PendingAttachments>(emptyAttachments)
  const [finalId, setFinalId] = useState<number | null>(null)
  const designInput = useRef<HTMLInputElement>(null)
  const refInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await api<{ item: Design; files: DesignFile[]; logs: Log[]; roles: DesignRoles }>(`/api/designs/${id}`)
      setItem(res.item)
      setFiles(res.files)
      setLogs(res.logs)
      setRoles(res.roles)
      const latest = res.files.find((f) => f.kind === 'desain')
      setFinalId(latest?.id ?? null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [id])
  useEffect(() => { load() }, [load])

  async function act(json: Record<string, unknown>, text: string) {
    setBusy(true)
    setError('')
    try {
      const res = await api<{ logId?: number }>(`/api/designs/${id}/status`, { method: 'POST', json })
      const failed = res.logId ? await uploadNoteAttachments('request_log', res.logId, noteFiles) : []
      setCatatan('')
      setNoteFiles(emptyAttachments())
      await load()
      onChanged(failed.length ? `${text} Sebagian lampiran gagal: ${failed.join(' ')}` : text)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function upload(kind: 'referensi' | 'desain', list: FileList | null) {
    if (!list?.length) return
    const invalid = checkDesignFiles([...list])
    if (invalid) return setError(invalid)
    setBusy(true)
    setError('')
    try {
      for (const file of list) await uploadDesignFile(id, kind, file)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function removeFile(f: DesignFile) {
    if (!window.confirm(`Hapus file ${f.name}?`)) return
    try {
      await api(`/api/designs/files/${f.id}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (!item) return <Modal title="Request desain" onClose={onClose}>{error ? <Notice>{error}</Notice> : <p className="pap-muted">Memuat...</p>}</Modal>
  const s = item.status
  const currentVersi = item.revisi_ke + 1
  const designs = files.filter((f) => f.kind === 'desain')
  const refs = files.filter((f) => f.kind === 'referensi')
  const versions = [...new Set(designs.map((f) => f.versi))]
  const latestVersi = versions[0]
  const open = !['disetujui', 'batal'].includes(s)

  const fileRow = (f: DesignFile, selectable = false) => (
    <li key={f.id} className={item.final_file_id === f.id ? 'final' : ''}>
      {selectable ? <input type="radio" name="final" checked={finalId === f.id} onChange={() => setFinalId(f.id)} aria-label={`Pilih ${f.name} sebagai final`} /> : <FileText />}
      {f.mime.startsWith('image/') && <a href={`/api/designs/files/${f.id}`} target="_blank" rel="noreferrer"><img className="pap-file-thumb" src={`/api/designs/files/${f.id}`} alt="" /></a>}
      <div>
        <a href={`/api/designs/files/${f.id}`} target="_blank" rel="noreferrer">{f.name}</a>
        <span>{formatSize(f.size)} · {f.uploaded_by_name} · {formatDate(f.created_at, true)}{item.final_file_id === f.id ? ' · DESAIN FINAL' : ''}</span>
      </div>
      <a className="pap-icon-button" href={`/api/designs/files/${f.id}?download=1`} aria-label={`Unduh ${f.name}`}><Download /></a>
      {open && <button className="pap-icon-button" onClick={() => removeFile(f)} aria-label={`Hapus ${f.name}`}><Trash2 /></button>}
    </li>
  )

  return (
    <Modal
      title={`${item.nomor} · ${item.judul}`}
      subtitle={`Untuk ${item.target_name ?? '—'} · diajukan ${item.requested_name}, ${formatDate(item.created_at, true)}`}
      wide
      onClose={onClose}
      footer={<>{open && (roles.isRequester || roles.isDesignerOf) && <button className="pap-btn danger" disabled={busy} onClick={() => { const a = ask('Alasan membatalkan request desain:'); if (a) act({ status: 'batal', catatan: a }, 'Request desain dibatalkan.') }}><Ban /> Batalkan</button>}<span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Tutup</button></>}
    >
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-detail-badges"><Badge tone={DESIGN_TONE[s]} label={DESIGN_LABEL[s]} />{item.revisi_ke > 0 && <span className="pap-status warning">Revisi ke-{item.revisi_ke}</span>}{item.designer_name && <span className="pap-status neutral">Desainer: {item.designer_name}</span>}</div>
      {s !== 'batal' && <Track flow={DESIGN_FLOW} labels={DESIGN_LABEL} status={s === 'revisi' ? 'dikerjakan' : s} />}

      {s === 'diajukan' && roles.designer && (
        <div className="pap-inline-panel">
          <strong>Tim Desain: ambil request ini</strong>
          <div className="pap-inline-actions"><button className="pap-primary-button" disabled={busy} onClick={() => act({ status: 'dikerjakan' }, 'Request desain diambil.')}><Palette /> Ambil & kerjakan</button></div>
        </div>
      )}
      {(s === 'dikerjakan' || s === 'revisi') && roles.isDesignerOf && (
        <div className="pap-inline-panel">
          <strong>Unggah desain versi {currentVersi}{s === 'revisi' ? ' (revisi)' : ''}</strong>
          {s === 'revisi' && item.feedback && <p className="pap-prewrap">Revisi dari customer: {item.feedback}</p>}
          <input ref={designInput} type="file" multiple hidden accept={DESIGN_FILE_ACCEPT} onChange={(e) => { upload('desain', e.target.files); e.target.value = '' }} />
          <textarea className="pap-input" rows={2} maxLength={5000} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Catatan untuk sales (opsional)" />
          <div className="pap-note-attach"><AttachmentInput value={noteFiles} onChange={setNoteFiles} /></div>
          <div className="pap-inline-actions pap-wrap">
            <button className="pap-btn" disabled={busy} onClick={() => designInput.current?.click()}><Upload /> Unggah file desain</button>
            <span className="pap-spacer" />
            <button className="pap-primary-button" disabled={busy || latestVersi !== currentVersi} onClick={() => act({ status: 'review', catatan }, 'Desain dikirim ke sales untuk review customer.')}><Send /> Kirim untuk review</button>
          </div>
        </div>
      )}
      {s === 'review' && roles.isRequester && (
        <div className="pap-inline-panel">
          <strong>Tanggapan customer atas desain versi {latestVersi}</strong>
          <p className="pap-muted">Pilih file final di daftar desain di bawah bila customer setuju. Desain final otomatis masuk ke Data Produk.</p>
          <textarea className="pap-input" rows={3} maxLength={5000} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Tanggapan customer. Wajib diisi bila minta revisi." />
          <div className="pap-note-attach"><AttachmentInput value={noteFiles} onChange={setNoteFiles} /></div>
          <div className="pap-inline-actions pap-wrap">
            <button className="pap-btn danger" disabled={busy || !catatan.trim()} onClick={() => act({ status: 'revisi', catatan }, 'Revisi dikirim ke Tim Desain.')}><RotateCcw /> Minta revisi</button>
            <span className="pap-spacer" />
            <button className="pap-primary-button" disabled={busy || !finalId} onClick={() => act({ status: 'disetujui', catatan, file_id: finalId }, 'Desain disetujui dan masuk ke Data Produk.')}><CheckCircle2 /> Customer setuju</button>
          </div>
        </div>
      )}
      {s === 'disetujui' && (
        <Notice kind="success">Desain final sudah masuk ke Data Produk{item.product_name ? `: ${item.product_name}` : ''}.{item.customer_id ? '' : ' Produk akan terhubung ke customer saat prospek dijadikan customer.'}</Notice>
      )}

      <dl className="pap-detail-grid">
        {item.jenis && <div><dt>Jenis</dt><dd>{item.jenis}</dd></div>}
        {item.ukuran && <div><dt>Ukuran</dt><dd>{item.ukuran}</dd></div>}
        {item.warna_cetak && <div><dt>Warna cetak</dt><dd>{item.warna_cetak}</dd></div>}
        <div><dt>Deadline</dt><dd>{formatDate(item.deadline)}</dd></div>
        {item.product_name && <div><dt>Produk</dt><dd>{item.product_name}</dd></div>}
        <div className="full"><dt>Brief</dt><dd className="pap-prewrap">{item.brief}</dd></div>
        {item.feedback && s !== 'revisi' && <div className="full"><dt>Tanggapan customer</dt><dd className="pap-prewrap">{item.feedback}</dd></div>}
      </dl>

      <section className="pap-detail-section">
        <div className="pap-section-head">
          <h3>Desain ({designs.length})</h3>
        </div>
        {versions.map((v) => (
          <div key={v} className="pap-version">
            <span className="pap-version-label">Versi {v}{v === latestVersi ? ' (terbaru)' : ''}</span>
            <ul className="pap-file-list">{designs.filter((f) => f.versi === v).map((f) => fileRow(f, s === 'review' && roles.isRequester))}</ul>
          </div>
        ))}
        {!designs.length && <p className="pap-muted">Belum ada file desain.</p>}
      </section>
      <section className="pap-detail-section">
        <div className="pap-section-head">
          <h3>Referensi dari sales ({refs.length})</h3>
          {open && roles.isRequester && <><input ref={refInput} type="file" multiple hidden accept={DESIGN_FILE_ACCEPT} onChange={(e) => { upload('referensi', e.target.files); e.target.value = '' }} /><button className="pap-btn" disabled={busy} onClick={() => refInput.current?.click()}><Upload /> Tambah referensi</button></>}
        </div>
        <ul className="pap-file-list">{refs.map((f) => fileRow(f))}</ul>
        {!refs.length && <p className="pap-muted">Tidak ada file referensi.</p>}
      </section>
      <Timeline logs={logs} labels={DESIGN_LABEL} user={user} onChanged={load} />
    </Modal>
  )
}
