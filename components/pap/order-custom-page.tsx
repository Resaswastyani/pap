'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, ClipboardCheck, Eye, FileDown, FileText, PackageCheck, Plus, Printer, RotateCcw, Save, Search, Send, ShieldCheck, Trash2, Undo2 } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { AttachmentPanel } from './attachments'
import { ProspectPicker, type TaPrefill } from './tech-analysis'
import { api, askReason, confirmDialog, Field, formatDate, Modal, Notice, Pager, RowActions, usePaged } from './ui'

// Form Checklist Order Custom: Marketing isi & cek kelengkapan -> PPIC verifikasi -> Operasional terima; cetak PDF / Word (juga formulir kosong)

type Status = 'draft' | 'ppic' | 'operasional' | 'selesai'
const STATUS: Record<Status, string> = { draft: 'Draft Marketing', ppic: 'Verifikasi PPIC', operasional: 'Penerimaan Operasional', selesai: 'Lengkap & diterima' }
const TONE: Record<Status, string> = { draft: 'neutral', ppic: 'warning', operasional: 'info', selesai: 'success' }
const FLOW: Status[] = ['draft', 'ppic', 'operasional', 'selesai']
const FLOW_LABEL: Record<Status, string> = { draft: 'Marketing isi & cek', ppic: 'PPIC verifikasi', operasional: 'Operasional terima', selesai: 'Lengkap' }

const PLASTIK = [{ key: 'bentuk', label: 'Bentuk Plastik' }, { key: 'ukuran_las', label: 'Detail Ukuran Plastik & Jarak Las' }, { key: 'ketebalan', label: 'Ketebalan plastik' }] as const
const CETAKAN = [
  { key: 'gambar_plastik', label: 'Gambar cetakan pada plastik' }, { key: 'gambar_tabung', label: 'Gambar cetakan pada tabung' },
  { key: 'ukuran_cetakan', label: 'Detail ukuran cetakan' }, { key: 'posisi_cetakan', label: 'Detail ukuran posisi cetakan atas bawah kiri kanan' },
] as const
type LineKey = (typeof PLASTIK)[number]['key'] | (typeof CETAKAN)[number]['key'] | 'pantone' | 'kelengkapan'
const LINE_KEYS: LineKey[] = [...PLASTIK.map((x) => x.key), ...CETAKAN.map((x) => x.key), 'pantone', 'kelengkapan']
type Isian = {
  spek: '' | 'baru' | 'repeat'; order_print: boolean; order_polos: boolean; jumlah_ukuran: string
  aksesoris: '' | 'ada' | 'tidak'; aksesoris_lampiran: boolean; aksesoris_ket: string
  jumlah_tabung: string; jenis_cetakan: '' | 'continue' | 'fixed'; gusset: '' | 'masuk' | 'tidak'
  lines: Record<LineKey, { cek: boolean; ket: string }>
}
const emptyIsian = (): Isian => ({
  spek: '', order_print: false, order_polos: false, jumlah_ukuran: '', aksesoris: '', aksesoris_lampiran: false, aksesoris_ket: '',
  jumlah_tabung: '', jenis_cetakan: '', gusset: '', lines: Object.fromEntries(LINE_KEYS.map((k) => [k, { cek: false, ket: '' }])) as Isian['lines'],
})
// Sama dengan ocProgress di server: bagian Desain Cetakan hanya untuk orderan Print
function progress(i: Isian) {
  const c: boolean[] = [!!i.spek, i.order_print || i.order_polos, !!i.jumlah_ukuran.trim(), ...PLASTIK.map((x) => i.lines[x.key].cek), !!i.aksesoris, ...(i.aksesoris === 'ada' ? [i.aksesoris_lampiran] : [])]
  if (i.order_print) c.push(!!i.jumlah_tabung.trim(), !!i.jenis_cetakan, ...CETAKAN.map((x) => i.lines[x.key].cek), !!i.gusset, i.lines.pantone.cek)
  c.push(i.lines.kelengkapan.cek)
  return { done: c.filter(Boolean).length, total: c.length }
}

type Checklist = {
  id: number; nomor: string; status: Status; tanggal: string; prospect_id: number | null; prospect_name: string | null
  nama_customer: string; nama_produk: string; referensi: string | null; isian: Isian; progress: { done: number; total: number }
  catatan: string | null; alasan_kembali: string | null
  marketing_name: string | null; marketing_at: string | null; ppic_name: string | null; ppic_at: string | null; operasional_name: string | null; operasional_at: string | null
  lampiran: number; created_by: number | null; created_name: string | null; created_at: string; updated_at: string
}
type ListRes = { items: Checklist[]; counts: Partial<Record<Status, number>>; can: { create: boolean; ppic: boolean; operasional: boolean } }
type Can = { edit: boolean; header: boolean; serahkan: boolean; ppic: boolean; operasional: boolean; kembalikan: boolean; buka: boolean; attach: boolean; delete: boolean }
type Header = { nama_customer: string; nama_produk: string; tanggal: string; referensi: string; catatan: string }
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)

// ---------- Menu "Form Order Custom" (Marketing) & "Checklist Order Custom" (Produksi) ----------
export function OrderCustomPage({ user, focusId, group = 'MARKETING' }: { user: UserProfile; focusId?: number | null; group?: 'MARKETING' | 'PRODUKSI' }) {
  const [data, setData] = useState<ListRes | null>(null)
  const [status, setStatus] = useState<Status | ''>('')
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<number | null>(focusId ?? null)
  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams()
      if (status) p.set('status', status)
      if (q.trim()) p.set('q', q.trim())
      setData(await api<ListRes>(`/api/order-custom?${p}`))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [status, q])
  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t) }, [load, q])
  useEffect(() => { if (focusId) setOpenId(focusId) }, [focusId])
  const paged = usePaged(data?.items ?? [], [status, q])

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">{group}</p>
          <h1>{group === 'PRODUKSI' ? 'Checklist Order Custom' : 'Form Order Custom'}</h1>
          <span>Form checklist kelengkapan data order custom (spek plastik, desain plastik, desain cetakan) dari Marketing, diverifikasi PPIC dan diterima Divisi Operasional sebelum produksi. Centang langsung di SIMPAP atau cetak lalu centang manual dengan pena.</span>
        </div>
      </div>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {notice && <Notice kind="success" onClose={() => setNotice('')}>{notice}</Notice>}
      <div className="pap-ta-pipeline">
        {FLOW.map((s, i) => (
          <button key={s} type="button" className={`pap-ta-stage ${TONE[s]} ${status === s ? 'active' : ''}`} onClick={() => setStatus(status === s ? '' : s)}>
            <b>{data?.counts[s] ?? 0}</b><span>{i + 1}. {STATUS[s]}</span>
          </button>
        ))}
      </div>
      <div className="pap-table-card">
        <div className="pap-card-head">
          <div><h2>Checklist order custom</h2><p>Order custom baru / repeat order: data wajib, desain plastik & desain cetakan, lalu paraf Marketing, PPIC, dan Operasional.</p></div>
          <div className="pap-inline-actions pap-wrap">
            <span className="pap-oc-blank"><FileText className="pap-inline-icon" /> Formulir kosong <DocActions id="kosong" nomor="formulir kosong" compact /></span>
            {data?.can.create && <button className="pap-primary-button" onClick={() => setCreating(true)}><Plus /> Checklist baru</button>}
          </div>
        </div>
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nomor, produk, customer, No. SO / PO..." /></label>
          <select className="pap-select" value={status} onChange={(e) => setStatus(e.target.value as Status | '')} aria-label="Status"><option value="">Semua status</option>{FLOW.map((s) => <option key={s} value={s}>{STATUS[s]}</option>)}</select>
        </div>
        <div className="pap-table-wrap">
          <table className="pap-ta-table pap-oc-table">
            <thead><tr><th>No. & produk</th><th>Customer</th><th>Order</th><th>Kelengkapan</th><th>Status</th><th aria-label="Aksi" /></tr></thead>
            <tbody>
              {paged.items.map((c) => {
                const pct = c.progress.total ? Math.round((c.progress.done / c.progress.total) * 100) : 0
                return (
                  <tr key={c.id} className="pap-clickable" tabIndex={0} onClick={() => setOpenId(c.id)} onKeyDown={(e) => e.key === 'Enter' && setOpenId(c.id)}>
                    <td><div className="pap-cc-nomor">{c.nomor} · {formatDate(c.tanggal)}</div><div className="pap-cell-title">{c.nama_produk}</div></td>
                    <td><div>{c.nama_customer}</div>{c.referensi && <div className="pap-cell-sub">Ref. {c.referensi}</div>}</td>
                    <td className="pap-cell-sub">{[c.isian.spek === 'baru' ? 'Baru' : c.isian.spek === 'repeat' ? 'Repeat order' : null, [c.isian.order_print && 'Print', c.isian.order_polos && 'Polos'].filter(Boolean).join(' + ') || null].filter(Boolean).join(' · ') || '—'}</td>
                    <td><div className={`pap-oc-meter ${pct === 100 ? 'full' : ''}`}><span style={{ width: `${pct}%` }} /></div><div className="pap-cell-sub">{c.progress.done}/{c.progress.total} item{c.lampiran ? ` · ${c.lampiran} lampiran` : ''}</div></td>
                    <td><span className={`pap-status ${TONE[c.status]}`}>{STATUS[c.status]}</span>{c.status === 'draft' && c.alasan_kembali && <div className="pap-cell-sub pap-text-warn">Dikembalikan</div>}</td>
                    <td onClick={(e) => e.stopPropagation()}><div className="pap-ta-row-actions"><RowActions label={c.nomor} onView={() => setOpenId(c.id)} /><DocActions id={c.id} nomor={c.nomor} compact /></div></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {data && !data.items.length && <div className="pap-empty">{q || status ? 'Tidak ada checklist yang cocok.' : 'Belum ada checklist order custom.'}</div>}
          {!data && !error && <div className="pap-empty">Memuat...</div>}
          <Pager {...paged.pager} noun="checklist" />
        </div>
      </div>
      {creating && <ChecklistForm onClose={() => setCreating(false)} onSaved={(id, msg) => { setCreating(false); setNotice(msg); load(); setOpenId(id) }} />}
      {openId && <ChecklistDetail id={openId} user={user} onClose={() => setOpenId(null)} onChanged={(msg) => { if (msg) setNotice(msg); load() }} />}
    </>
  )
}

// ---------- Isian checklist (tampilan seperti formulir kertas) ----------
function Segmented<T extends string>({ value, options, onChange, disabled, label }: { value: T | ''; options: [T, string][]; onChange: (v: T | '') => void; disabled?: boolean; label: string }) {
  return (
    <div className="pap-segmented pap-oc-seg" role="radiogroup" aria-label={label}>
      {options.map(([k, text]) => <button type="button" key={k} role="radio" aria-checked={value === k} disabled={disabled} className={value === k ? 'active' : ''} onClick={() => onChange(value === k ? '' : k)}>{value === k && <CheckCircle2 />}{text}</button>)}
    </div>
  )
}

function CheckLine({ label, value, onChange, disabled, na, strong }: { label: string; value: { cek: boolean; ket: string }; onChange: (v: { cek: boolean; ket: string }) => void; disabled?: boolean; na?: boolean; strong?: boolean }) {
  return (
    <div className={`pap-oc-line ${value.cek ? 'on' : ''} ${na ? 'na' : ''} ${strong ? 'strong' : ''}`}>
      <label className="pap-oc-check">
        <input type="checkbox" checked={value.cek} disabled={disabled} onChange={(e) => onChange({ ...value, cek: e.target.checked })} />
        <span>{label}</span>
      </label>
      <input className="pap-input pap-oc-ket" maxLength={500} disabled={disabled} value={value.ket} onChange={(e) => onChange({ ...value, ket: e.target.value })} placeholder="Keterangan (opsional)" aria-label={`Keterangan ${label}`} />
    </div>
  )
}

function ChecklistEditor({ v, set, disabled }: { v: Isian; set: (patch: Partial<Isian>) => void; disabled?: boolean }) {
  const line = (k: LineKey) => (val: { cek: boolean; ket: string }) => set({ lines: { ...v.lines, [k]: val } })
  const p = progress(v)
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0
  const polosOnly = v.order_polos && !v.order_print
  return (
    <div className="pap-oc-form">
      <div className="pap-oc-progress">
        <div><b>Kelengkapan {p.done}/{p.total}</b><small>{pct === 100 ? 'Semua item lengkap' : 'Centang item yang datanya sudah ada / sudah dicek'}</small></div>
        <div className={`pap-oc-meter ${pct === 100 ? 'full' : ''}`}><span style={{ width: `${pct}%` }} /></div>
      </div>

      <section className="pap-oc-sec">
        <h4>Keterangan Order Custom <span className="pap-oc-req">Wajib ada</span></h4>
        <div className="pap-oc-opt"><span>Spek plastik</span><Segmented label="Spek plastik" disabled={disabled} value={v.spek} options={[['baru', 'Baru'], ['repeat', 'Repeat Order']]} onChange={(x) => set({ spek: x })} /></div>
        <div className="pap-oc-opt">
          <span>Orderan <small className="pap-muted">(centang dua-duanya bila ada)</small></span>
          <div className="pap-oc-toggles">
            <label className={`pap-oc-chip ${v.order_print ? 'on' : ''}`}><input type="checkbox" disabled={disabled} checked={v.order_print} onChange={(e) => set({ order_print: e.target.checked })} /> Print</label>
            <label className={`pap-oc-chip ${v.order_polos ? 'on' : ''}`}><input type="checkbox" disabled={disabled} checked={v.order_polos} onChange={(e) => set({ order_polos: e.target.checked })} /> Polos</label>
          </div>
        </div>
      </section>

      <section className="pap-oc-sec">
        <h4>Desain Plastik <small>(lampiran)</small></h4>
        <label className="pap-oc-fieldline"><span>Jumlah Ukuran &amp; Jenis Plastik</span><input className="pap-input" maxLength={255} disabled={disabled} value={v.jumlah_ukuran} onChange={(e) => set({ jumlah_ukuran: e.target.value })} placeholder="mis. 2 ukuran: HD 30×45 & HD 40×60" /></label>
        {PLASTIK.map((x) => <CheckLine key={x.key} label={x.label} value={v.lines[x.key]} onChange={line(x.key)} disabled={disabled} />)}
        <div className="pap-oc-opt">
          <span>Aksesoris</span>
          <div className="pap-oc-toggles">
            <Segmented label="Aksesoris" disabled={disabled} value={v.aksesoris} options={[['ada', 'Ada'], ['tidak', 'Tidak Ada']]} onChange={(x) => set({ aksesoris: x, aksesoris_lampiran: x === 'ada' ? v.aksesoris_lampiran : false })} />
            {v.aksesoris === 'ada' && <label className={`pap-oc-chip ${v.aksesoris_lampiran ? 'on' : ''}`}><input type="checkbox" disabled={disabled} checked={v.aksesoris_lampiran} onChange={(e) => set({ aksesoris_lampiran: e.target.checked })} /> Lampiran</label>}
          </div>
        </div>
        {v.aksesoris === 'ada' && <input className="pap-input pap-oc-ket solo" maxLength={255} disabled={disabled} value={v.aksesoris_ket} onChange={(e) => set({ aksesoris_ket: e.target.value })} placeholder="Jenis aksesoris (mis. zipper, hanger, plong tangan)" aria-label="Keterangan aksesoris" />}
      </section>

      <section className={`pap-oc-sec ${polosOnly ? 'na' : ''}`}>
        <h4>Desain Cetakan <small>(lampiran)</small>{polosOnly && <span className="pap-oc-na">Tidak berlaku untuk orderan polos</span>}{!v.order_print && !v.order_polos && <span className="pap-oc-na">Diisi bila orderan Print</span>}</h4>
        <label className="pap-oc-fieldline short"><span>Jumlah Tabung Cetak</span><input className="pap-input" maxLength={60} disabled={disabled} value={v.jumlah_tabung} onChange={(e) => set({ jumlah_tabung: e.target.value })} placeholder="mis. 3" /></label>
        <div className="pap-oc-opt"><span>Jenis cetakan</span><Segmented label="Jenis cetakan" disabled={disabled} value={v.jenis_cetakan} options={[['continue', 'Continue'], ['fixed', 'Fixed']]} onChange={(x) => set({ jenis_cetakan: x })} /></div>
        {CETAKAN.map((x) => <CheckLine key={x.key} label={x.label} value={v.lines[x.key]} onChange={line(x.key)} disabled={disabled} na={polosOnly} />)}
        <div className="pap-oc-opt"><span>Gusset</span><Segmented label="Gusset" disabled={disabled} value={v.gusset} options={[['masuk', 'Cetakan Masuk Gusset'], ['tidak', 'Tidak masuk Gusset']]} onChange={(x) => set({ gusset: x })} /></div>
        <CheckLine label="Pantone Warna" value={v.lines.pantone} onChange={line('pantone')} disabled={disabled} na={polosOnly} />
      </section>

      <section className="pap-oc-sec final">
        <CheckLine label="Kelengkapan Data & Tidak ada perubahan" value={v.lines.kelengkapan} onChange={line('kelengkapan')} disabled={disabled} strong />
      </section>
    </div>
  )
}

function HeaderFields({ h, set, disabled }: { h: Header; set: (patch: Partial<Header>) => void; disabled?: boolean }) {
  return (
    <div className="pap-form-grid">
      <Field label="Nama customer *"><input className="pap-input" required maxLength={255} disabled={disabled} value={h.nama_customer} onChange={(e) => set({ nama_customer: e.target.value })} /></Field>
      <Field label="Nama produk *"><input className="pap-input" required maxLength={255} disabled={disabled} value={h.nama_produk} onChange={(e) => set({ nama_produk: e.target.value })} placeholder="mis. HD Jinjing Gusset Uk 45 Print Logo" /></Field>
      <Field label="Tanggal"><input className="pap-input" type="date" disabled={disabled} value={h.tanggal} onChange={(e) => set({ tanggal: e.target.value })} /></Field>
      <Field label="Ref. SO / PO / quotation (opsional)"><input className="pap-input" maxLength={150} disabled={disabled} value={h.referensi} onChange={(e) => set({ referensi: e.target.value })} placeholder="mis. SO-2611-0012" /></Field>
    </div>
  )
}

// ---------- Buat checklist baru (Marketing) ----------
function ChecklistForm({ onClose, onSaved }: { onClose: () => void; onSaved: (id: number, msg: string) => void }) {
  const [source, setSource] = useState<(TaPrefill & { nama?: string }) | undefined>()
  const [h, setH] = useState<Header>({ nama_customer: '', nama_produk: '', tanggal: today(), referensi: '', catatan: '' })
  const [v, setV] = useState<Isian>(emptyIsian)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await api<{ id: number; nomor: string }>('/api/order-custom', { method: 'POST', json: { ...h, prospect_id: source?.prospect_id ?? null, isian: v } })
      onSaved(res.id, `Checklist ${res.nomor} dibuat. Lengkapi lalu klik "Serahkan ke PPIC".`)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }
  return (
    <Modal title="Checklist order custom baru" subtitle="Bagian Marketing: isi data order & centang kelengkapan, lalu serahkan ke PPIC" wide onClose={onClose}
      footer={<><span className="pap-spacer" /><button type="button" className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="pap-oc-form" disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan draft'}</button></>}>
      <form id="pap-oc-form" onSubmit={save}>
        {error && <Notice onClose={() => setError('')}>{error}</Notice>}
        <ProspectPicker value={source} onPick={(s) => { setSource(s); if (s) setH({ ...h, nama_customer: s.nama_customer, nama_produk: s.products[0]?.label ?? h.nama_produk }) }} onError={setError} />
        {!!source?.products.length && (
          <div className="pap-field full">
            <span>Produk prospek</span>
            <div className="pap-chip-tabs">{source.products.map((p, i) => <button type="button" key={`${p.label}-${i}`} className={h.nama_produk === p.label ? 'active' : ''} onClick={() => setH({ ...h, nama_produk: p.label })}>{p.label}</button>)}</div>
          </div>
        )}
        <HeaderFields h={h} set={(p) => setH({ ...h, ...p })} />
        <ChecklistEditor v={v} set={(p) => setV({ ...v, ...p })} />
      </form>
    </Modal>
  )
}

// ---------- Detail: isian, lampiran, paraf 3 divisi ----------
function ChecklistDetail({ id, user, onClose, onChanged }: { id: number; user: UserProfile; onClose: () => void; onChanged: (msg?: string) => void }) {
  const [c, setC] = useState<Checklist | null>(null)
  const [can, setCan] = useState<Can | null>(null)
  const [h, setH] = useState<Header>({ nama_customer: '', nama_produk: '', tanggal: '', referensi: '', catatan: '' })
  const [v, setV] = useState<Isian>(emptyIsian)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await api<{ item: Checklist; can: Can }>(`/api/order-custom/${id}`)
      setC(r.item)
      setCan(r.can)
      setH({ nama_customer: r.item.nama_customer, nama_produk: r.item.nama_produk, tanggal: r.item.tanggal, referensi: r.item.referensi ?? '', catatan: r.item.catatan ?? '' })
      setV(r.item.isian)
      setDirty(false)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [id])
  useEffect(() => { load() }, [load])

  const saveNow = () => api(`/api/order-custom/${id}`, { method: 'PUT', json: { ...h, prospect_id: c?.prospect_id ?? null, isian: v } })
  async function run(task: () => Promise<unknown>, msg: string) {
    setBusy(true)
    setError('')
    try {
      await task()
      setNotice(msg)
      await load()
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  // Isian yang belum disimpan ikut tersimpan sebelum diserahkan / diparaf
  const flow = (action: string, msg: string, extra: Record<string, unknown> = {}) => run(async () => {
    if (can?.edit && dirty) await saveNow()
    await api(`/api/order-custom/${id}`, { method: 'PATCH', json: { action, ...extra } })
  }, msg)
  async function kembalikan() {
    const alasan = await askReason({ title: 'Kembalikan ke Marketing', label: 'Data apa yang kurang / perlu diperbaiki?', placeholder: 'mis. Pantone warna belum ada, ukuran jarak las belum jelas', confirmLabel: 'Kembalikan', danger: true })
    if (alasan) flow('kembalikan', 'Checklist dikembalikan ke Marketing. Paraf dihapus, Marketing diberi tahu.', { alasan })
  }
  async function remove() {
    if (!c || !(await confirmDialog({ title: 'Hapus checklist?', message: `${c.nomor} · ${c.nama_produk}\n\nDipindah ke Data Terhapus dan bisa dipulihkan.`, confirmLabel: 'Hapus', tone: 'danger' }))) return
    try {
      await api(`/api/order-custom/${id}`, { method: 'DELETE' })
      onChanged(`Checklist ${c.nomor} dihapus.`)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (!c || !can) return <Modal title="Checklist order custom" onClose={onClose}>{error ? <Notice>{error}</Notice> : <p className="pap-muted">Memuat...</p>}</Modal>
  const step = FLOW.indexOf(c.status)
  const p = progress(v)
  const signs: [string, string | null, string | null, Status][] = [
    ['Divisi Marketing', c.marketing_name, c.marketing_at, 'draft'], ['Divisi PPIC', c.ppic_name, c.ppic_at, 'ppic'], ['Divisi Operasional', c.operasional_name, c.operasional_at, 'operasional'],
  ]

  return (
    <Modal title={`${c.nomor} · ${c.nama_produk}`} subtitle={`${c.nama_customer}${c.referensi ? ` · Ref. ${c.referensi}` : ''} · ${formatDate(c.tanggal)} · dibuat ${c.created_name ?? ''}`} wide onClose={onClose}
      footer={<>
        {can.delete && <button type="button" className="pap-btn danger" onClick={remove}><Trash2 /> Hapus</button>}
        {can.buka && <button type="button" className="pap-btn" disabled={busy} onClick={() => flow('buka', 'Checklist dibuka lagi untuk Operasional.')}><RotateCcw /> Buka lagi</button>}
        <span className="pap-spacer" />
        {can.kembalikan && <button type="button" className="pap-btn" disabled={busy} onClick={kembalikan}><Undo2 /> Kembalikan ke Marketing</button>}
        {can.edit && <button type="button" className="pap-btn" disabled={busy || !dirty} onClick={() => run(saveNow, 'Checklist disimpan.')}><Save /> Simpan</button>}
        {can.serahkan && <button type="button" className="pap-primary-button" disabled={busy} onClick={() => flow('serahkan', 'Diserahkan ke PPIC & diparaf Marketing. Tim PPIC diberi tahu.')}><Send /> Serahkan ke PPIC</button>}
        {can.ppic && <button type="button" className="pap-primary-button" disabled={busy} onClick={() => flow('verifikasi', 'Diverifikasi & diparaf PPIC, diteruskan ke Operasional.')}><ShieldCheck /> Verifikasi & paraf PPIC</button>}
        {can.operasional && <button type="button" className="pap-primary-button" disabled={busy} onClick={() => flow('terima', 'Diterima & diparaf Operasional. Checklist lengkap.')}><PackageCheck /> Terima & paraf Operasional</button>}
      </>}>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {notice && <Notice kind="success" onClose={() => setNotice('')}>{notice}</Notice>}
      {c.status === 'draft' && c.alasan_kembali && <div className="pap-oc-returned"><Undo2 /><div><b>Dikembalikan untuk dilengkapi</b><p>{c.alasan_kembali}</p></div></div>}
      <ol className="pap-cc-stepper pap-ta-stepper" aria-label="Tahap checklist">
        {FLOW.map((s, i) => (
          <li key={s} className={i < step ? 'done' : i === step ? 'current' : ''}>
            <span className="pap-cc-dot">{i < step || (i === step && s === 'selesai') ? <CheckCircle2 /> : i + 1}</span>
            <b>{FLOW_LABEL[s]}</b>
            <small>{s === 'ppic' && c.marketing_at ? formatDate(c.marketing_at) : s === 'operasional' && c.ppic_at ? formatDate(c.ppic_at) : s === 'selesai' && c.operasional_at ? formatDate(c.operasional_at) : ''}</small>
          </li>
        ))}
      </ol>

      <div className="pap-ta-docbar">
        <span><Printer className="pap-inline-icon" /> Form checklist {c.nomor}: pratinjau PDF, cetak lalu centang manual, atau unduh Word</span>
        <DocActions id={c.id} nomor={c.nomor} compact />
      </div>

      {can.header ? <HeaderFields h={h} set={(x) => { setH({ ...h, ...x }); setDirty(true) }} /> : null}
      {!can.edit && c.status !== 'selesai' && <p className="pap-muted pap-ta-hint">Checklist sedang di tahap <b>{STATUS[c.status]}</b>; isian hanya bisa diubah oleh divisi di tahap tersebut.</p>}
      <ChecklistEditor v={v} set={(x) => { setV({ ...v, ...x }); setDirty(true) }} disabled={!can.edit} />
      <Field label="Catatan (dicetak)" full><textarea className="pap-input" rows={2} maxLength={5000} disabled={!can.edit} value={h.catatan} onChange={(e) => { setH({ ...h, catatan: e.target.value }); setDirty(true) }} placeholder="mis. desain final dari request desain DSN-..., warna mengikuti sampel" /></Field>

      <div className="pap-oc-attach">
        <AttachmentPanel title="Lampiran desain plastik, desain cetakan & aksesoris" basePath={`/api/notes/order_custom/${c.id}/attachments`} fileBase="/api/notes/attachments" canAdd={can.attach} currentUserId={user.id} isAdmin={user.role.isAdmin} />
      </div>

      <h4 className="pap-ta-sub-h"><ClipboardCheck className="pap-inline-icon" /> Paraf divisi</h4>
      <div className="pap-oc-signs">
        {signs.map(([role, name, at, s]) => (
          <div key={role} className={`pap-oc-sign ${name ? 'done' : c.status === s ? 'current' : ''}`}>
            <span>{role}</span>
            {name ? <><b><CheckCircle2 /> {name}</b><small>{formatDate(at, true)}</small></> : <><b className="pap-muted">{c.status === s ? 'Menunggu paraf' : 'Belum'}</b><small>&nbsp;</small></>}
          </div>
        ))}
      </div>
      {dirty && can.edit && <p className="pap-muted pap-ta-hint">Ada perubahan yang belum disimpan ({p.done}/{p.total} item lengkap).</p>}
    </Modal>
  )
}

// Aksi dokumen: Pratinjau PDF (tab baru), Cetak (dialog cetak langsung terbuka), Word. id 'kosong' = formulir kosong
function DocActions({ id, nomor, compact = false }: { id: number | 'kosong'; nomor: string; compact?: boolean }) {
  const base = `/cetak/order-custom/${id}`
  const word = `/api/order-custom/${id}/word`
  return compact ? (
    <span className="pap-ta-doc-icons">
      <a className="pap-row-action" href={base} target="_blank" rel="noreferrer" title="Pratinjau PDF" aria-label={`Pratinjau PDF ${nomor}`}><Eye /><span>PDF</span></a>
      <a className="pap-row-action" href={`${base}?print=1`} target="_blank" rel="noreferrer" title="Cetak" aria-label={`Cetak ${nomor}`}><Printer /><span>Cetak</span></a>
      <a className="pap-row-action" href={word} title="Unduh Word" aria-label={`Unduh Word ${nomor}`}><FileDown /><span>Word</span></a>
    </span>
  ) : (
    <>
      <a className="pap-btn" href={word}><FileDown /> Word</a>
      <a className="pap-btn" href={`${base}?print=1`} target="_blank" rel="noreferrer"><Printer /> Cetak</a>
      <a className="pap-primary-button" href={base} target="_blank" rel="noreferrer"><Eye /> Pratinjau PDF</a>
    </>
  )
}
