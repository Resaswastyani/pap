'use client'

import { useCallback, useEffect, useState } from 'react'
import { Ban, CheckCircle2, Copy, FileDown, FileText, MessageCircle, Pencil, Plus, Printer, Receipt, Search, Send, Settings2, Trash2, TrendingUp, Truck, Wallet, XCircle } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { rupiah } from '@/lib/hpp-calc'
import { DocForm, useHppData } from './hpp-page'
import { ProspectSelect, waLink, type ProspectOption } from './marketing'
import { PaymentForm } from './payment-page'
import { CustomerSelect, type CustomerOption } from './product-page'
import { api, Field, formatDate, Modal, Notice } from './ui'

type Status = 'draft' | 'dikirim' | 'diterima' | 'ditolak' | 'batal'
const STATUS_LABEL: Record<Status, string> = { draft: 'Draft', dikirim: 'Dikirim', diterima: 'Diterima', ditolak: 'Ditolak', batal: 'Batal' }
const STATUS_TONE: Record<Status, string> = { draft: 'neutral', dikirim: 'info', diterima: 'success', ditolak: 'danger', batal: 'neutral' }
const Badge = ({ s }: { s: Status }) => <span className={`pap-status ${STATUS_TONE[s]}`}>{STATUS_LABEL[s]}</span>
// Persetujuan internal Kepala Marketing / GM (hanya relevan selama draft)
type Approval = 'menunggu' | 'disetujui' | 'ditolak'
const APPROVAL_LABEL: Record<Approval, string> = { menunggu: 'Menunggu persetujuan', disetujui: 'Disetujui atasan', ditolak: 'Ditolak atasan' }
const APPROVAL_TONE: Record<Approval, string> = { menunggu: 'warning', disetujui: 'success', ditolak: 'danger' }
const ApprovalBadge = ({ q, show = true }: { q: Pick<Quotation, 'status' | 'approval'>; show?: boolean }) => (show && q.status === 'draft' && q.approval ? <span className={`pap-status ${APPROVAL_TONE[q.approval]}`}>{APPROVAL_LABEL[q.approval]}</span> : null)

type Quotation = {
  id: number; nomor: string; prospect_id: number | null; customer_id: number | null; kepada: string; kontak: string | null; telepon: string | null; whatsapp: string | null
  alamat: string | null; tanggal: string; berlaku_hari: number; berlaku_sampai: string; status: Status; pakai_ppn: boolean; ppn_persen: number
  subtotal: number; ppn: number; total: number; syarat: string | null; catatan: string | null; alasan: string | null; created_by: number
  created_name: string; sent_at: string | null; created_at: string; prospect_name: string | null; customer_no: string | null; item_count: number
  order_nomor: string | null; proforma_nomor: string | null; tanggal_kirim: string | null; dp_persen: number | null; expedition_id: number | null
  expedition_name: string | null; expedition_estimasi: string | null; ongkir: number | null; catatan_order: string | null; terbayar: number
  approval: Approval | null; approval_note: string | null; approved_name: string | null; approved_at: string | null; rekening: string | null; telepon_kop: string | null
}
type Item = { id: number; product_id: number | null; nama_produk: string; spesifikasi: string | null; qty: number; satuan: string; harga_satuan: number; subtotal: number }
const UNITS = ['pcs', 'kg', 'pack', 'roll', 'lembar'] as const
// Unduh dokumen: PDF lewat halaman cetak (dialog cetak > Simpan sebagai PDF), Word langsung terunduh
const docLinks = (id: number, jenis: 'penawaran' | 'order' | 'proforma') => ({ pdf: `/cetak/quotation/${id}${jenis === 'penawaran' ? '' : `?jenis=${jenis}`}`, word: `/api/quotations/${id}/word?jenis=${jenis}` })
type Prefill = { prospect?: { id: number; nama_usaha: string; kontak_nama: string | null; telepon: string | null; alamat: string | null; kota: string | null; products?: { product_id: number | null; label: string }[] } }

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function QuotationPage({ focusId }: { user: UserProfile; focusId?: number | null }) {
  const [items, setItems] = useState<Quotation[]>([])
  const [summary, setSummary] = useState<Partial<Record<Status, { n: number; total: number }>>>({})
  const [pendingApproval, setPendingApproval] = useState(0)
  const [canWrite, setCanWrite] = useState(false)
  const [canApprove, setCanApprove] = useState(false)
  const [approvalRequired, setApprovalRequired] = useState(false)
  const [seesAll, setSeesAll] = useState(false)
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState<{ edit?: Quotation & { items: Item[] }; copy?: Quotation & { items: Item[] } } | null>(null)
  // Dibuka dari notifikasi persetujuan
  const [detailId, setDetailId] = useState<number | null>(focusId ?? null)
  const [docOpen, setDocOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (status) params.set('status', status)
      if (q.trim()) params.set('q', q.trim())
      const res = await api<{ items: Quotation[]; summary: typeof summary; pendingApproval: number; canWrite: boolean; canApprove: boolean; approvalRequired: boolean; seesAll: boolean }>(`/api/quotations?${params}`)
      setItems(res.items)
      setSummary(res.summary)
      setPendingApproval(res.pendingApproval)
      setCanWrite(res.canWrite)
      setCanApprove(res.canApprove)
      setApprovalRequired(res.approvalRequired)
      setSeesAll(res.seesAll)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [status, q])
  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0)
    return () => clearTimeout(t)
  }, [load, q])
  const flash = (text: string) => { setMessage(text); setTimeout(() => setMessage(''), 5000); load() }
  const sum = (s: Status) => summary[s] ?? { n: 0, total: 0 }
  const closed = sum('diterima').n + sum('ditolak').n

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">MARKETING</p>
          <h1>Quotation</h1>
          <span>Template surat penawaran ke prospek / customer dengan harga diisi manual. Ekspor ke PDF atau Word lalu kirim lewat WhatsApp / email.</span>
        </div>
        <div className="pap-inline-actions">
          {canApprove && <button className="pap-btn" onClick={() => setDocOpen(true)}><Settings2 /> Template dokumen</button>}
          {canWrite && <button className="pap-primary-button" onClick={() => setForm({})}><Plus /> Buat penawaran</button>}
        </div>
      </div>
      {docOpen && <DocTemplateModal onClose={() => setDocOpen(false)} onSaved={(t) => { setDocOpen(false); flash(t) }} />}
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      <div className="pap-stat-grid four">
        <button className="pap-stat-card pap-stat-button" onClick={() => setStatus(approvalRequired && pendingApproval ? 'persetujuan' : 'draft')}><div><span>Draft</span><strong>{sum('draft').n}</strong><small className={approvalRequired && pendingApproval ? '' : 'neutral'}>{approvalRequired && pendingApproval ? `${pendingApproval} menunggu persetujuan${canApprove ? ' Anda' : ''}` : 'Belum dikirim'}</small></div><div className="pap-stat-icon stat-1"><FileText /></div></button>
        <div className="pap-stat-card"><div><span>Menunggu jawaban</span><strong>{sum('dikirim').n}</strong><small className="neutral">{rupiah(sum('dikirim').total)}</small></div><div className="pap-stat-icon stat-1"><Send /></div></div>
        <div className="pap-stat-card"><div><span>Diterima</span><strong>{sum('diterima').n}</strong><small className="neutral">{rupiah(sum('diterima').total)}</small></div><div className="pap-stat-icon stat-0"><CheckCircle2 /></div></div>
        <div className="pap-stat-card"><div><span>Win rate</span><strong>{closed ? `${Math.round((sum('diterima').n / closed) * 100)}%` : '—'}</strong><small className="neutral">dari {closed} penawaran selesai</small></div><div className="pap-stat-icon stat-0"><TrendingUp /></div></div>
      </div>
      <div className="pap-table-card">
        <div className="pap-card-head"><div><h2>Daftar penawaran</h2><p>{seesAll ? 'Semua penawaran.' : 'Penawaran yang Anda buat.'}</p></div></div>
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nomor, nama usaha, kontak..." /></label>
          <select className="pap-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter status">
            <option value="">Semua status</option>
            {approvalRequired && <option value="persetujuan">Menunggu persetujuan</option>}
            {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Nomor</th><th>Kepada</th><th>Tanggal</th><th>Berlaku s/d</th><th className="pap-num">Total</th><th>Sales</th><th>Status</th></tr></thead>
            <tbody>
              {items.map((x) => (
                <tr key={x.id} className="pap-row-link" onClick={() => setDetailId(x.id)}>
                  <td><div className="pap-cell-title">{x.nomor}</div><div className="pap-cell-sub">{x.item_count} produk</div></td>
                  <td><div className="pap-cell-title">{x.kepada}</div><div className="pap-cell-sub">{x.kontak ?? (x.prospect_name ? 'Prospek' : x.customer_no ?? '')}</div></td>
                  <td>{formatDate(x.tanggal)}</td>
                  <td className={x.status === 'dikirim' && x.berlaku_sampai < today() ? 'pap-followup overdue' : ''}>{formatDate(x.berlaku_sampai)}</td>
                  <td className="pap-num">{rupiah(x.total)}</td>
                  <td>{x.created_name}</td>
                  <td><div className="pap-detail-badges"><Badge s={x.status} /><ApprovalBadge q={x} show={approvalRequired} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !items.length && <div className="pap-empty">{q || status ? 'Tidak ada penawaran yang cocok.' : 'Belum ada penawaran. Klik "Buat penawaran".'}</div>}
          {loading && !items.length && <div className="pap-empty">Memuat...</div>}
        </div>
      </div>
      {form && <QuotationForm edit={form.edit} copy={form.copy} onClose={() => setForm(null)} onSaved={(text, id) => { setForm(null); flash(text); setDetailId(id) }} />}
      {detailId && (
        <QuotationDetail
          id={detailId}
          onClose={() => setDetailId(null)}
          onChanged={flash}
          onEdit={(qt) => { setDetailId(null); setForm({ edit: qt }) }}
          onCopy={(qt) => { setDetailId(null); setForm({ copy: qt }) }}
          onDeleted={() => { setDetailId(null); flash('Penawaran dihapus.') }}
        />
      )}
    </>
  )
}

// ---------------- Form penawaran ----------------
// Template penawaran: produk, spesifikasi, jumlah, dan harga diisi manual (tanpa perhitungan HPP)
type FormItem = { key: string; product_id: number | null; nama_produk: string; spesifikasi: string; qty: string; satuan: string; harga_satuan: string }
let seq = 0
const blankItem = (product_id: number | null = null, nama_produk = ''): FormItem => ({ key: `q${++seq}`, product_id, nama_produk, spesifikasi: '', qty: '', satuan: 'pcs', harga_satuan: '' })
const fromItem = (it: Item): FormItem => ({
  key: `q${++seq}`, product_id: it.product_id, nama_produk: it.nama_produk, spesifikasi: it.spesifikasi ?? '',
  qty: String(it.qty), satuan: it.satuan, harga_satuan: String(it.harga_satuan),
})
const toNum = (v: string) => Number(v.replace(',', '.')) || 0
// Teks multi-baris (pilihan di Template dokumen) -> daftar baris tidak kosong
const lines = (text: string | null | undefined) => String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

export function QuotationForm({ edit, copy, prefill, onClose, onSaved }: { edit?: Quotation & { items: Item[] }; copy?: Quotation & { items: Item[] }; prefill?: Prefill; onClose: () => void; onSaved: (message: string, id: number) => void }) {
  // Hanya untuk syarat default & tarif PPN dari pengaturan dokumen
  const { data, error: loadError } = useHppData()
  const base = edit ?? copy
  const pp = prefill?.prospect
  const [mode, setMode] = useState<'prospek' | 'customer'>(base?.customer_id && !base.prospect_id ? 'customer' : 'prospek')
  const [prospect, setProspect] = useState<ProspectOption | null>(null)
  const [customer, setCustomer] = useState<CustomerOption | null>(null)
  const [target, setTarget] = useState({ prospect_id: base?.prospect_id ?? pp?.id ?? null, customer_id: base?.customer_id ?? null })
  const [values, setValues] = useState({
    kepada: base?.kepada ?? pp?.nama_usaha ?? '', kontak: base?.kontak ?? pp?.kontak_nama ?? '', telepon: base?.telepon ?? '', whatsapp: base?.whatsapp ?? pp?.telepon ?? '',
    alamat: base?.alamat ?? [pp?.alamat, pp?.kota].filter(Boolean).join(', '), tanggal: edit?.tanggal ?? today(), berlaku_hari: String(base?.berlaku_hari ?? 14),
    syarat: base?.syarat ?? '', catatan: base?.catatan ?? '', pakai_ppn: base ? base.pakai_ppn : true,
  })
  // Nomor Telepon / WA perusahaan di kop (bisa lebih dari satu)
  const [teleponKop, setTeleponKop] = useState<string[]>(() => lines(base?.telepon_kop))
  const [items, setItems] = useState<FormItem[]>(() => (base ? base.items.map(fromItem) : pp?.products?.length ? pp.products.map((p) => blankItem(p.product_id, p.label)) : [blankItem()]))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }))

  const teleponOptions = lines(data?.doc.telepon)

  // Syarat & ketentuan default dari template dokumen (bila belum diisi)
  useEffect(() => {
    if (!data) return
    setValues((v) => ({ ...v, syarat: v.syarat || data.doc.syarat || '' }))
    // Penawaran baru: nomor pertama di Template dokumen terpilih
    setTeleponKop((list) => (list.length || base ? list : lines(data.doc.telepon).slice(0, 1)))
  }, [data])

  const update = (key: string, patch: Partial<FormItem>) => setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)))
  const subtotal = items.reduce((n, it) => n + toNum(it.qty) * toNum(it.harga_satuan), 0)
  const ppnPersen = data?.params.ppn_persen ?? 11
  const ppn = values.pakai_ppn ? Math.round(subtotal * ppnPersen) / 100 : 0

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const payload = {
        ...values, ...target, berlaku_hari: Number(values.berlaku_hari) || 14, telepon_kop: teleponKop,
        items: items.map((it) => ({ product_id: it.product_id, nama_produk: it.nama_produk, spesifikasi: it.spesifikasi, qty: it.qty, satuan: it.satuan, harga_satuan: it.harga_satuan })),
      }
      if (edit) {
        await api(`/api/quotations/${edit.id}`, { method: 'PATCH', json: payload })
        onSaved('Penawaran diperbarui.', edit.id)
      } else {
        const res = await api<{ id: number; nomor: string }>('/api/quotations', { method: 'POST', json: payload })
        onSaved(`Penawaran ${res.nomor} disimpan sebagai draft.`, res.id)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  function pickProspect(p: ProspectOption) {
    setProspect(p)
    setTarget({ prospect_id: p.id, customer_id: null })
    api<{ item: { nama_usaha: string; kontak_nama: string | null; telepon: string | null; alamat: string | null; kota: string | null } }>(`/api/prospects/${p.id}`).then(({ item }) => {
      setValues((v) => ({ ...v, kepada: item.nama_usaha, kontak: item.kontak_nama ?? '', whatsapp: item.telepon ?? '', alamat: [item.alamat, item.kota].filter(Boolean).join(', ') }))
    }).catch(() => setValues((v) => ({ ...v, kepada: p.nama_usaha })))
  }
  function pickCustomer(c: CustomerOption) {
    setCustomer(c)
    setTarget({ prospect_id: null, customer_id: c.id })
    const full = c as CustomerOption & { mobile_phone?: string | null; work_phone?: string | null; bill_street?: string | null }
    setValues((v) => ({ ...v, kepada: c.name, telepon: full.work_phone ?? '', whatsapp: full.mobile_phone ?? '', alamat: [full.bill_street, c.bill_city].filter(Boolean).join(', ') }))
  }

  return (
    <Modal
      title={edit ? `Edit ${edit.nomor}` : copy ? `Revisi dari ${copy.nomor}` : 'Buat penawaran'}
      subtitle="Isi produk, spesifikasi, jumlah, dan harga secara manual."
      wide
      onClose={onClose}
      footer={<><span className="pap-quote-total">Total: <b>{rupiah(subtotal + ppn)}</b></span><span className="pap-spacer" /><button type="button" className="pap-btn" onClick={onClose}>Batal</button><button type="submit" form="quotation-form" className="pap-primary-button" disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan draft'}</button></>}
    >
      {(error || loadError) && <Notice onClose={() => setError('')}>{error || loadError}</Notice>}
      <form id="quotation-form" className="pap-form-grid" onSubmit={submit}>
        {!pp && (
          <div className="pap-field full">
            <span>Untuk</span>
            <div className="pap-target-picker">
              <div className="pap-segmented">
                <button type="button" className={mode === 'prospek' ? 'active' : ''} onClick={() => setMode('prospek')}>Prospek</button>
                <button type="button" className={mode === 'customer' ? 'active' : ''} onClick={() => setMode('customer')}>Customer</button>
              </div>
              {mode === 'prospek' ? <ProspectSelect value={prospect} onChange={pickProspect} /> : <CustomerSelect value={customer} onChange={pickCustomer} />}
              {base && !prospect && !customer && <small className="pap-muted">Tetap: {base.prospect_name ?? base.kepada}</small>}
            </div>
          </div>
        )}
        <Field label="Kepada (nama usaha)"><input className="pap-input" required maxLength={200} value={values.kepada} onChange={set('kepada')} /></Field>
        <Field label="Up. (nama kontak)"><input className="pap-input" maxLength={150} value={values.kontak} onChange={set('kontak')} /></Field>
        <Field label="No. telepon"><input className="pap-input" maxLength={40} value={values.telepon} onChange={set('telepon')} placeholder="mis. (0271) 7685458" /></Field>
        <Field label="No. WA"><input className="pap-input" maxLength={40} value={values.whatsapp} onChange={set('whatsapp')} placeholder="mis. 0812xxxx" /></Field>
        <Field label="Alamat"><input className="pap-input" maxLength={500} value={values.alamat} onChange={set('alamat')} /></Field>
        <Field label="Tanggal"><input className="pap-input" type="date" required value={values.tanggal} onChange={set('tanggal')} /></Field>
        <Field label="Berlaku (hari)"><input className="pap-input" type="number" min={1} max={365} value={values.berlaku_hari} onChange={set('berlaku_hari')} /></Field>

        <div className="pap-field full">
          <span>Produk ({items.length})</span>
          <div className="pap-quote-items">
            {items.map((it, i) => (
              <div key={it.key} className="pap-quote-item">
                <div className="pap-sample-item-head">
                  <b>{i + 1}</b>
                  <input className="pap-input" required maxLength={255} value={it.nama_produk} onChange={(e) => update(it.key, { nama_produk: e.target.value })} placeholder="Nama produk, mis. Kantong laundry HD" aria-label={`Nama produk ${i + 1}`} />
                  <button type="button" className="pap-icon-button" aria-label={`Hapus produk ${i + 1}`} disabled={items.length === 1} onClick={() => setItems((l) => l.filter((x) => x.key !== it.key))}><Trash2 /></button>
                </div>
                <label className="pap-quote-spec"><span>Spesifikasi (dicetak di penawaran)</span><textarea className="pap-input" rows={2} maxLength={1000} value={it.spesifikasi} onChange={(e) => update(it.key, { spesifikasi: e.target.value })} placeholder="mis. HD 30 x 40 cm, 50 mikron, cetak 2 warna" /></label>
                <div className="pap-quote-price">
                  <label><span>Jumlah</span><input className="pap-input" inputMode="decimal" required value={it.qty} onChange={(e) => update(it.key, { qty: e.target.value })} placeholder="10000" /></label>
                  <label><span>Satuan</span><select className="pap-select" value={it.satuan} onChange={(e) => update(it.key, { satuan: e.target.value })}>{UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</select></label>
                  <label><span>Harga / {it.satuan} (Rp)</span><input className="pap-input" inputMode="decimal" required value={it.harga_satuan} onChange={(e) => update(it.key, { harga_satuan: e.target.value })} /></label>
                  <div className="pap-quote-line"><small>Subtotal</small><b>{rupiah(toNum(it.qty) * toNum(it.harga_satuan))}</b></div>
                </div>
              </div>
            ))}
            <button type="button" className="pap-btn pap-add-item" onClick={() => setItems((l) => [...l, blankItem()])}><Plus /> Tambah produk</button>
          </div>
        </div>

        <div className="pap-quote-totals full">
          <label className="pap-check"><input type="checkbox" checked={values.pakai_ppn} onChange={(e) => {
            const ppn = e.target.checked
            setValues((v) => ({ ...v, pakai_ppn: ppn }))
          }} /><span>Kenakan PPN {ppnPersen}%</span></label>
          <dl><dt>Subtotal</dt><dd>{rupiah(subtotal)}</dd>{values.pakai_ppn && <><dt>PPN {ppnPersen}%</dt><dd>{rupiah(ppn)}</dd></>}<dt className="grand">Total</dt><dd className="grand">{rupiah(subtotal + ppn)}</dd></dl>
        </div>
        <Field label="Telepon / WA perusahaan di kop surat (bisa lebih dari satu)" full>
          <MultiSelect options={teleponOptions} value={teleponKop} onChange={setTeleponKop} empty="Belum ada nomor di Template dokumen" placeholder="Semua nomor di Template dokumen" />
        </Field>
        <Field label="Syarat & ketentuan (dicetak)" full><textarea className="pap-input" rows={4} maxLength={5000} value={values.syarat} onChange={set('syarat')} /></Field>
        <Field label="Catatan internal (tidak dicetak)" full><textarea className="pap-input" rows={2} maxLength={5000} value={values.catatan} onChange={set('catatan')} /></Field>
      </form>
    </Modal>
  )
}

// Dropdown pilih banyak (checkbox). Kosong = placeholder (mis. dokumen memakai semua pilihan).
function MultiSelect({ options, value, onChange, empty, placeholder }: { options: string[]; value: string[]; onChange: (next: string[]) => void; empty: string; placeholder: string }) {
  // Nilai lama yang sudah tidak ada di Template dokumen tetap ditampilkan agar bisa dilepas
  const all = [...options, ...value.filter((v) => !options.includes(v))]
  const toggle = (o: string) => onChange(value.includes(o) ? value.filter((v) => v !== o) : all.filter((x) => x === o || value.includes(x)))
  return (
    <details className="pap-multiselect">
      <summary className="pap-select">{value.length ? value.join(' · ') : options.length ? placeholder : empty}</summary>
      {all.length > 0 && (
        <div className="pap-multiselect-menu">
          {all.map((o) => <label key={o} className="pap-check"><input type="checkbox" checked={value.includes(o)} onChange={() => toggle(o)} /><span>{o}</span></label>)}
        </div>
      )}
    </details>
  )
}

// Template dokumen (kop surat, rekening, syarat default, penandatangan) - dulu di menu Tabel HPP
function DocTemplateModal({ onClose, onSaved }: { onClose: () => void; onSaved: (message: string) => void }) {
  const { data, error } = useHppData()
  return (
    <Modal title="Template dokumen penawaran" subtitle="Dipakai di surat penawaran, surat order, dan proforma (PDF & Word)." wide onClose={onClose}>
      {error && <Notice>{error}</Notice>}
      {data ? <DocForm data={data} onSaved={onSaved} /> : !error && <p className="pap-muted">Memuat...</p>}
    </Modal>
  )
}

// ---------------- Detail penawaran ----------------
function QuotationDetail({ id, onClose, onChanged, onEdit, onCopy, onDeleted }: {
  id: number; onClose: () => void; onChanged: (m: string) => void
  onEdit: (q: Quotation & { items: Item[] }) => void; onCopy: (q: Quotation & { items: Item[] }) => void; onDeleted: () => void
}) {
  const [item, setItem] = useState<Quotation | null>(null)
  const [rows, setRows] = useState<Item[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [canWrite, setCanWrite] = useState(false)
  const [canApprove, setCanApprove] = useState(false)
  const [approvalRequired, setApprovalRequired] = useState(false)
  const [isOwner, setIsOwner] = useState(false)
  const [approvalNote, setApprovalNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    try {
      const res = await api<{ item: Quotation; items: Item[]; canEdit: boolean; canWrite: boolean; canApprove: boolean; isOwner: boolean; approvalRequired: boolean }>(`/api/quotations/${id}`)
      setItem(res.item)
      setRows(res.items)
      setCanEdit(res.canEdit)
      setCanWrite(res.canWrite)
      setCanApprove(res.canApprove)
      setApprovalRequired(res.approvalRequired)
      setIsOwner(res.isOwner)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [id])
  useEffect(() => { load() }, [load])

  async function status(to: Status, needReason = false) {
    let alasan = ''
    if (needReason) {
      alasan = window.prompt(to === 'ditolak' ? 'Alasan ditolak customer (harga, spek, waktu, dll.):' : 'Alasan dibatalkan:') ?? ''
      if (!alasan.trim()) return
    }
    setBusy(true)
    try {
      await api(`/api/quotations/${id}/status`, { method: 'POST', json: { status: to, alasan } })
      await load()
      onChanged(`Penawaran ditandai ${STATUS_LABEL[to].toLowerCase()}.`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function approval(action: 'ajukan' | 'setujui' | 'tolak') {
    if (action === 'tolak' && !approvalNote.trim()) return setError('Tulis alasan penolakan agar sales bisa memperbaiki penawaran.')
    setBusy(true)
    setError('')
    try {
      await api(`/api/quotations/${id}/approval`, { method: 'POST', json: { action, catatan: approvalNote } })
      setApprovalNote('')
      await load()
      onChanged(action === 'ajukan' ? 'Penawaran diajukan, Kepala Marketing / GM diberi tahu.' : action === 'setujui' ? 'Penawaran disetujui, sales diberi tahu.' : 'Penawaran ditolak, sales diberi tahu.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    if (!window.confirm('Hapus draft penawaran ini?')) return
    try {
      await api(`/api/quotations/${id}`, { method: 'DELETE' })
      onDeleted()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  if (!item) return <Modal title="Penawaran" onClose={onClose}>{error ? <Notice>{error}</Notice> : <p className="pap-muted">Memuat...</p>}</Modal>
  const links = docLinks(item.id, 'penawaran')
  const waText = `Halo${item.kontak ? ` ${item.kontak}` : ''}, berikut penawaran harga dari PT. Pandawa Amerta Packindo no. ${item.nomor} senilai ${rupiah(item.total)}, berlaku s/d ${formatDate(item.berlaku_sampai)}. File PDF penawaran kami lampirkan. Terima kasih.`
  const full = { ...item, items: rows }
  // Draft boleh dikirim bila sudah disetujui, atau penawaran milik penyetuju sendiri (otomatis tercatat disetujui saat dikirim)
  const draft = item.status === 'draft'
  const approved = item.approval === 'disetujui'
  const sendable = !approvalRequired || approved || (canApprove && isOwner)
  const approvalNoteInput = <textarea className="pap-input" rows={2} maxLength={500} value={approvalNote} onChange={(e) => setApprovalNote(e.target.value)} placeholder="Catatan (wajib bila menolak)" />

  return (
    <Modal
      title={`${item.nomor} · ${item.kepada}`}
      subtitle={`${formatDate(item.tanggal)} · berlaku s/d ${formatDate(item.berlaku_sampai)} · ${item.created_name}`}
      wide
      onClose={onClose}
      footer={<>
        {item.status === 'draft' && canEdit && <button className="pap-btn danger" onClick={remove}><Trash2 /> Hapus</button>}
        {['draft', 'dikirim'].includes(item.status) && canWrite && <button className="pap-btn danger" disabled={busy} onClick={() => status('batal', true)}><Ban /> Batalkan</button>}
        <span className="pap-spacer" />
        {canWrite && <button className="pap-btn" onClick={() => onCopy(full)}><Copy /> Buat revisi</button>}
        {item.status === 'draft' && canEdit && <button className="pap-btn" onClick={() => onEdit(full)}><Pencil /> Edit</button>}
        <a className="pap-btn" href={links.word}><FileDown /> Word</a>
        <a className="pap-btn" href={links.pdf} target="_blank" rel="noreferrer"><Printer /> PDF</a>
      </>}
    >
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-detail-badges"><Badge s={item.status} /><ApprovalBadge q={item} show={approvalRequired} />{item.prospect_name && <span className="pap-status neutral">Prospek: {item.prospect_name}</span>}{item.customer_no && <span className="pap-status neutral">Customer {item.customer_no}</span>}</div>

      {approvalRequired && draft && item.approval === 'ditolak' && item.approval_note && <Notice>Ditolak {item.approved_name ?? 'atasan'}: {item.approval_note}. Perbaiki penawaran lalu ajukan ulang.</Notice>}
      {approvalRequired && draft && approved && <p className="pap-muted">Disetujui {item.approved_name ?? 'atasan'}{item.approved_at ? `, ${formatDate(item.approved_at, true)}` : ''}{item.approval_note ? ` · ${item.approval_note}` : ''}</p>}
      {approvalRequired && draft && !approved && canApprove && !isOwner && (
        <div className="pap-inline-panel">
          <strong>Persetujuan penawaran{item.approval === 'menunggu' ? ` dari ${item.created_name}` : ''}</strong>
          <p className="pap-muted">Periksa produk & harga di bawah. Setelah disetujui, sales bisa mengirim penawaran ke customer.</p>
          {approvalNoteInput}
          <div className="pap-inline-actions pap-wrap">
            {item.approval === 'menunggu' && <button className="pap-btn danger" disabled={busy} onClick={() => approval('tolak')}><XCircle /> Tolak</button>}
            <span className="pap-spacer" />
            <button className="pap-primary-button" disabled={busy} onClick={() => approval('setujui')}><CheckCircle2 /> Setujui</button>
          </div>
        </div>
      )}
      {draft && !sendable && isOwner && item.approval !== 'menunggu' && (
        <div className="pap-inline-panel">
          <strong>Ajukan persetujuan</strong>
          <p className="pap-muted">Penawaran harus disetujui Kepala Marketing atau General Manager sebelum dikirim ke customer.</p>
          {approvalNoteInput}
          <div className="pap-inline-actions"><span className="pap-spacer" /><button className="pap-primary-button" disabled={busy} onClick={() => approval('ajukan')}><Send /> Ajukan persetujuan</button></div>
        </div>
      )}
      {draft && !sendable && !canApprove && (!isOwner || item.approval === 'menunggu') && item.approval !== 'ditolak' && <p className="pap-muted">{item.approval === 'menunggu' ? 'Menunggu persetujuan Kepala Marketing / GM.' : 'Belum diajukan untuk persetujuan oleh pembuatnya.'}</p>}
      {draft && sendable && canWrite && (
        <div className="pap-inline-panel">
          <strong>Kirim penawaran ke customer</strong>
          <p className="pap-muted">1) Unduh <b>PDF</b> (simpan sebagai PDF di dialog cetak) atau <b>Word</b>. 2) Kirim lewat WhatsApp/email. 3) Tandai terkirim — status prospek otomatis menjadi &quot;Penawaran&quot;.</p>
          <div className="pap-inline-actions pap-wrap">
            {waLink(item.whatsapp || item.telepon, waText) && <a className="pap-btn pap-wa" href={waLink(item.whatsapp || item.telepon, waText)!} target="_blank" rel="noreferrer"><MessageCircle /> Buka WhatsApp</a>}
            <span className="pap-spacer" />
            <button className="pap-primary-button" disabled={busy} onClick={() => status('dikirim')}><Send /> Tandai terkirim</button>
          </div>
        </div>
      )}
      {item.status === 'dikirim' && canWrite && (
        <div className="pap-inline-panel">
          <strong>Jawaban customer</strong>
          <div className="pap-inline-actions pap-wrap">
            {waLink(item.whatsapp || item.telepon, `Halo${item.kontak ? ` ${item.kontak}` : ''}, menindaklanjuti penawaran kami no. ${item.nomor}. Apakah ada pertanyaan atau bisa kami bantu proses ordernya?`) && <a className="pap-btn pap-wa" href={waLink(item.whatsapp || item.telepon, `Halo${item.kontak ? ` ${item.kontak}` : ''}, menindaklanjuti penawaran kami no. ${item.nomor}. Apakah ada pertanyaan atau bisa kami bantu proses ordernya?`)!} target="_blank" rel="noreferrer"><MessageCircle /> Follow-up WA</a>}
            <span className="pap-spacer" />
            <button className="pap-btn danger" disabled={busy} onClick={() => status('ditolak', true)}><XCircle /> Ditolak</button>
            <button className="pap-primary-button" disabled={busy} onClick={() => status('diterima')}><CheckCircle2 /> Diterima / deal</button>
          </div>
        </div>
      )}
      {item.status === 'diterima' && <OrderPanel item={item} canWrite={canWrite} onSaved={async (t) => { await load(); onChanged(t) }} />}
      {item.alasan && <Notice>Alasan {STATUS_LABEL[item.status].toLowerCase()}: {item.alasan}</Notice>}

      <dl className="pap-detail-grid">
        <div><dt>Kepada</dt><dd>{item.kepada}{item.kontak ? ` · up. ${item.kontak}` : ''}</dd></div>
        <div><dt>Telepon / WA</dt><dd>{[item.telepon && `Telp ${item.telepon}`, item.whatsapp && `WA ${item.whatsapp}`].filter(Boolean).join(' · ') || '—'}</dd></div>
        <div><dt>Alamat</dt><dd>{item.alamat || '—'}</dd></div>
      </dl>
      <div className="pap-table-wrap pap-sample-table">
        <table>
          <thead><tr><th>#</th><th>Produk</th><th className="pap-num">Jumlah</th><th className="pap-num">Harga</th><th className="pap-num">Subtotal</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td>{i + 1}</td>
                <td><div className="pap-cell-title">{r.nama_produk}</div>{r.spesifikasi && <div className="pap-cell-sub">{r.spesifikasi}</div>}</td>
                <td className="pap-num">{r.qty.toLocaleString('id-ID')} {r.satuan}</td>
                <td className="pap-num">{rupiah(r.harga_satuan, r.harga_satuan % 1 ? 2 : 0)}</td>
                <td className="pap-num">{rupiah(r.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pap-quote-totals">
        <span />
        <dl><dt>Subtotal</dt><dd>{rupiah(item.subtotal)}</dd>{item.pakai_ppn && <><dt>PPN {item.ppn_persen}%</dt><dd>{rupiah(item.ppn)}</dd></>}<dt className="grand">Total</dt><dd className="grand">{rupiah(item.total)}</dd></dl>
      </div>
      {item.syarat && <section className="pap-detail-section"><h3>Syarat & ketentuan</h3><p className="pap-prewrap">{item.syarat}</p></section>}
      {item.catatan && <section className="pap-detail-section"><h3>Catatan internal</h3><p className="pap-prewrap">{item.catatan}</p></section>}
    </Modal>
  )
}

// ---------------- Surat Order, Proforma Invoice, pembayaran ----------------
type Expedition = { id: number; nama: string; tujuan: string; tarif_per_kg: number | null; estimasi_hari: string | null; aktif: number }

function OrderPanel({ item, canWrite, onSaved }: { item: Quotation; canWrite: boolean; onSaved: (m: string) => void }) {
  const [editing, setEditing] = useState(!item.order_nomor)
  const [paying, setPaying] = useState(false)
  const [expeditions, setExpeditions] = useState<Expedition[]>([])
  const [v, setV] = useState({
    tanggal_kirim: item.tanggal_kirim ?? '', dp_persen: item.dp_persen?.toString() ?? '50', expedition_id: item.expedition_id ? String(item.expedition_id) : '',
    ongkir: item.ongkir?.toString() ?? '', catatan_order: item.catatan_order ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (editing) api<{ items: Expedition[] }>('/api/expeditions').then((r) => setExpeditions(r.items.filter((e) => e.aktif))).catch(() => {}) }, [editing])
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }))
  const grand = item.total + (item.ongkir ?? 0)
  const sisa = Math.max(0, grand - item.terbayar)
  const dp = item.dp_persen ? Math.round((grand * item.dp_persen) / 100) : null
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api(`/api/quotations/${item.id}/order`, { method: 'POST', json: v })
      setEditing(false)
      onSaved('Data surat order & proforma disimpan.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="pap-inline-panel pap-order-panel">
      <strong><Receipt className="pap-inline-icon" /> Order: {item.order_nomor ? `${item.order_nomor} · ${item.proforma_nomor}` : 'buat Surat Order & Proforma Invoice'}</strong>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {editing && canWrite ? (
        <form className="pap-form-grid" onSubmit={save}>
          <Field label="Rencana tanggal kirim"><input className="pap-input" type="date" value={v.tanggal_kirim} onChange={set('tanggal_kirim')} /></Field>
          <Field label="DP (%)"><input className="pap-input" inputMode="decimal" value={v.dp_persen} onChange={set('dp_persen')} placeholder="50" /></Field>
          <Field label="Ekspedisi" hint="Diurutkan termurah per rute. Kelola di Master Data → Ekspedisi.">
            <select className="pap-select" value={v.expedition_id} onChange={set('expedition_id')}>
              <option value="">— Diambil sendiri / belum ditentukan —</option>
              {expeditions.map((e) => <option key={e.id} value={e.id}>{e.tujuan} · {e.nama}{e.tarif_per_kg ? ` · ${rupiah(e.tarif_per_kg)}/kg` : ''}{e.estimasi_hari ? ` · ${e.estimasi_hari} hari` : ''}</option>)}
            </select>
          </Field>
          <Field label="Ongkir (Rp, opsional)"><input className="pap-input" inputMode="numeric" value={v.ongkir} onChange={set('ongkir')} /></Field>
          <Field label="Catatan order (dicetak)" full><textarea className="pap-input" rows={2} maxLength={5000} value={v.catatan_order} onChange={set('catatan_order')} placeholder="Mis. desain final DSN-..., packing per 100 pcs, special request" /></Field>
          <div className="pap-inline-actions full">{item.order_nomor && <button type="button" className="pap-btn" onClick={() => setEditing(false)}>Batal</button>}<button className="pap-primary-button" disabled={busy}>{busy ? 'Menyimpan...' : item.order_nomor ? 'Simpan' : 'Buat surat order'}</button></div>
        </form>
      ) : (
        <>
          <dl className="pap-detail-grid">
            <div><dt>Tanggal kirim</dt><dd>{formatDate(item.tanggal_kirim)}</dd></div>
            <div><dt>Ekspedisi</dt><dd>{item.expedition_name ? <><Truck className="pap-inline-icon" /> {item.expedition_name}{item.expedition_estimasi ? ` (${item.expedition_estimasi} hari)` : ''}</> : '—'}</dd></div>
            <div><dt>Total + ongkir</dt><dd>{rupiah(grand)}{dp ? ` · DP ${item.dp_persen}% = ${rupiah(dp)}` : ''}</dd></div>
            <div><dt>Sudah dibayar (diverifikasi)</dt><dd className={sisa > 0 ? 'pap-text-warn' : 'pap-text-ok'}>{rupiah(item.terbayar)}{sisa > 0 ? ` · sisa ${rupiah(sisa)}` : ' · LUNAS'}</dd></div>
          </dl>
          <div className="pap-inline-actions pap-wrap">
            {canWrite && <button className="pap-btn" onClick={() => setEditing(true)}><Pencil /> Ubah data order</button>}
            <span className="pap-spacer" />
            <a className="pap-btn" href={docLinks(item.id, 'order').pdf} target="_blank" rel="noreferrer"><Printer /> Surat Order PDF</a>
            <a className="pap-btn" href={docLinks(item.id, 'order').word}><FileDown /> Word</a>
            <a className="pap-btn" href={docLinks(item.id, 'proforma').pdf} target="_blank" rel="noreferrer"><Printer /> Proforma PDF</a>
            <a className="pap-btn" href={docLinks(item.id, 'proforma').word}><FileDown /> Word</a>
            {sisa > 0 && <button className="pap-primary-button" onClick={() => setPaying(true)}><Wallet /> Konfirmasi pembayaran</button>}
          </div>
        </>
      )}
      {paying && (
        <PaymentForm
          preset={{ quotation_id: item.id, pembayar: item.kepada, nomor: item.order_nomor ?? item.nomor, sisa, dp: item.terbayar === 0 ? dp : null }}
          onClose={() => setPaying(false)}
          onSaved={(t) => { setPaying(false); onSaved(t) }}
        />
      )}
    </div>
  )
}
