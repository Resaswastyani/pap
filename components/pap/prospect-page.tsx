'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Download, FileText, FlaskConical, Package, Palette, CalendarClock, CalendarPlus, Columns3, Handshake, LayoutList, Link2, Mail, MapPin, Pencil, Phone, Plus, Search, Send, Trash2, Upload, UserPlus } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { CustomerSelect, type CustomerOption } from './product-page'
import {
  CheckinForm, nowInput, PIPELINE, PROSPECT_LABEL, ProspectBadge, toInputDateTime, VisitBadge, VisitDetail, VisitForm, WaButton,
  type MarketingUser, type ProspectStatus, type Visit,
} from './marketing'
import { QuotationForm } from './quotation-page'
import { DesignForm, SampleForm } from './request-page'
import { AttachmentInput, AttachmentPanel, emptyAttachments, NoteFiles, pendingCount, uploadNoteAttachments, uploadPendingAttachments, type NoteAttachment, type PendingAttachments } from './attachments'
import { api, askReason, Field, formatDate, Modal, Notice, Pager, RowActions, useQuickAction, confirmDialog } from './ui'

export type Prospect = {
  id: number
  nama_usaha: string
  sektor: string | null
  kontak_nama: string | null
  kontak_jabatan: string | null
  telepon: string | null
  email: string | null
  alamat: string | null
  kota: string | null
  sumber: string | null
  kebutuhan: string | null
  estimasi_order: string | null
  status: ProspectStatus
  alasan_gagal: string | null
  assigned_to: number | null
  maintenance_to: number | null
  customer_id: number | null
  next_followup_at: string | null
  last_activity_at: string | null
  catatan: string | null
  kompetitor?: string | null
  payment?: string | null
  created_by: number
  created_at: string
  assigned_name: string | null
  maintenance_name: string | null
  created_name: string | null
  customer_name: string | null
  customer_no: string | null
  activity_count: number
  next_visit: string | null
  products?: NeedItem[]
}
type Activity = { id: number; jenis: string; hasil: string | null; status_from: ProspectStatus | null; status_to: ProspectStatus | null; created_at: string; user_name: string; attachments?: NoteAttachment[] }
type ListResponse = {
  items: Prospect[]
  total: number
  pageSize: number
  summary: Partial<Record<ProspectStatus, number>>
  due: { overdue: number; today: number }
  users: MarketingUser[]
  sources: string[]
  sectors?: string[]
  canSupervise: boolean
}

const ACTIVITY_LABEL: Record<string, string> = { whatsapp: 'WhatsApp', telepon: 'Telepon', email: 'Email', visit: 'Visit', meeting: 'Meeting', catatan: 'Catatan', status: 'Status', handover: 'Handover' }
const today = () => nowInput().slice(0, 10)
const followupState = (p: Prospect) => {
  if (!p.next_followup_at || p.status === 'gagal') return ''
  const d = p.next_followup_at.slice(0, 10)
  return d < today() ? 'overdue' : d === today() ? 'today' : ''
}

export function ProspectPage({ user, focusId }: { user: UserProfile; focusId?: number | null }) {
  const [data, setData] = useState<ListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [view, setView] = useState<'list' | 'kanban'>('list')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('aktif')
  const [sumber, setSumber] = useState('')
  const [sektor, setSektor] = useState('')
  const [owner, setOwner] = useState('')
  const [followup, setFollowup] = useState('')
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(50)
  const [form, setForm] = useState<Prospect | 'new' | null>(null)
  useQuickAction('tambah-prospek', () => setForm('new'))
  const [autoEdit, setAutoEdit] = useState(false)
  const [importing, setImporting] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(focusId ?? null)

  // Filter daftar (tanpa halaman) untuk unduh PDF / Excel / CSV
  const exportQuery = useMemo(() => {
    const p = new URLSearchParams()
    if (q.trim()) p.set('q', q.trim())
    p.set('status', view === 'kanban' ? 'aktif' : status || 'semua')
    if (sumber) p.set('sumber', sumber)
    if (sektor) p.set('sektor', sektor)
    if (owner) p.set('owner', owner)
    if (followup) p.set('followup', followup)
    return p.toString()
  }, [q, status, view, sumber, sektor, owner, followup])
  const [downloadOpen, setDownloadOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(size), view })
      if (q.trim()) params.set('q', q.trim())
      if (status && view === 'list') params.set('status', status)
      if (view === 'kanban') params.set('status', 'aktif')
      if (sumber) params.set('sumber', sumber)
      if (sektor) params.set('sektor', sektor)
      if (owner) params.set('owner', owner)
      if (followup) params.set('followup', followup)
      setData(await api<ListResponse>(`/api/prospects?${params}`))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [q, status, sumber, sektor, owner, followup, page, view, size])
  useEffect(() => {
    const timer = setTimeout(load, q ? 300 : 0)
    return () => clearTimeout(timer)
  }, [load, q])
  useEffect(() => setPage(1), [q, status, sumber, sektor, owner, followup, view])

  const flash = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 5000)
  }
  const summary = data?.summary ?? {}
  const count = (s: ProspectStatus) => summary[s] ?? 0
  const activeTotal = PIPELINE.filter((s) => s !== 'handover').reduce((n, s) => n + count(s), 0)
  const won = count('order_pertama') + count('handover')
  const closed = won + count('gagal')
  const isDigital = user.division.code === 'marketing_digital'

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">MARKETING</p>
          <h1>Prospek</h1>
          <span>Pipeline calon customer: lead dari Marketing Digital, follow-up & visit Marketing Development, hingga handover ke Marketing Maintenance.</span>
        </div>
        <div className="pap-inline-actions pap-wrap">
          <div className="pap-download" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDownloadOpen(false) }}>
            <button className="pap-btn" aria-haspopup="menu" aria-expanded={downloadOpen} onClick={() => setDownloadOpen((v) => !v)}><Download /> Unduh daftar</button>
            {downloadOpen && (
              <div className="pap-download-menu" role="menu">
                <a role="menuitem" href={`/cetak/prospek?${exportQuery}`} target="_blank" rel="noreferrer" onClick={() => setDownloadOpen(false)}><FileText /> PDF<small>Buka halaman cetak, pilih Simpan sebagai PDF</small></a>
                <a role="menuitem" href={`/api/prospects/export?format=xlsx&${exportQuery}`} onClick={() => setDownloadOpen(false)}><Download /> Excel (.xlsx)</a>
                <a role="menuitem" href={`/api/prospects/export?format=csv&${exportQuery}`} onClick={() => setDownloadOpen(false)}><Download /> CSV</a>
                <p>Sesuai filter yang sedang dipakai</p>
              </div>
            )}
          </div>
          <button className="pap-btn" onClick={() => setImporting(true)}><Upload /> Impor Excel / CSV</button>
          <button className="pap-primary-button" onClick={() => setForm('new')}><Plus /> Tambah prospek</button>
        </div>
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      <div className="pap-stat-grid four">
        <button className={`pap-stat-card pap-stat-button ${status === 'aktif' && !followup ? 'active' : ''}`} onClick={() => { setStatus('aktif'); setFollowup('') }}>
          <div><span>Prospek aktif</span><strong>{activeTotal}</strong><small className="neutral">{count('baru')} lead baru belum dihubungi</small></div>
          <div className="pap-stat-icon stat-1"><UserPlus /></div>
        </button>
        <button className={`pap-stat-card pap-stat-button ${followup === 'overdue' ? 'active' : ''}`} onClick={() => setFollowup((f) => (f === 'overdue' ? '' : 'overdue'))}>
          <div><span>Follow-up terlambat</span><strong>{data?.due.overdue ?? 0}</strong><small className="neutral">Lewat jadwal follow-up</small></div>
          <div className="pap-stat-icon stat-2"><AlertTriangle /></div>
        </button>
        <button className={`pap-stat-card pap-stat-button ${followup === 'today' ? 'active' : ''}`} onClick={() => setFollowup((f) => (f === 'today' ? '' : 'today'))}>
          <div><span>Follow-up hari ini</span><strong>{data?.due.today ?? 0}</strong><small className="neutral">Jadwal WA / telepon / visit</small></div>
          <div className="pap-stat-icon stat-1"><CalendarClock /></div>
        </button>
        <button className={`pap-stat-card pap-stat-button ${status === 'order_pertama' ? 'active' : ''}`} onClick={() => setStatus((s) => (s === 'order_pertama' ? 'aktif' : 'order_pertama'))}>
          <div><span>Closing</span><strong>{won}</strong><small className="neutral">{closed ? `${Math.round((won / closed) * 100)}% berhasil dari ${closed} prospek selesai` : 'Order pertama & handover'}</small></div>
          <div className="pap-stat-icon stat-0"><Handshake /></div>
        </button>
      </div>

      <div className="pap-funnel" aria-label="Funnel prospek">
        {[...PIPELINE, 'gagal' as const].map((s) => (
          <button key={s} className={`pap-funnel-step ${status === s ? 'active' : ''} ${s}`} onClick={() => { setView('list'); setStatus((cur) => (cur === s ? 'aktif' : s)) }}>
            <strong>{count(s)}</strong><span>{PROSPECT_LABEL[s]}</span>
          </button>
        ))}
      </div>

      <div className="pap-table-card">
        <div className="pap-card-head">
          <div><h2>Daftar prospek</h2><p>{data?.canSupervise ? 'Anda melihat semua prospek dan dapat membagikannya ke sales.' : 'Semua prospek tim marketing. Follow-up bisa dicatat untuk prospek mana pun; data prospek diubah oleh pemiliknya.'}</p></div>
          <div className="pap-segmented" role="tablist" aria-label="Tampilan prospek">
            <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}><LayoutList /> Daftar</button>
            <button className={view === 'kanban' ? 'active' : ''} onClick={() => setView('kanban')}><Columns3 /> Kanban</button>
          </div>
        </div>
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari usaha, kontak, nomor, kota, kebutuhan..." /></label>
          {view === 'list' && (
            <select className="pap-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter status">
              <option value="aktif">Semua aktif</option>
              <option value="">Semua status</option>
              {Object.entries(PROSPECT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          )}
          <select className="pap-select" value={sektor} onChange={(e) => setSektor(e.target.value)} aria-label="Filter bidang usaha">
            <option value="">Semua bidang usaha</option>
            {sektor && sektor !== '-' && !(data?.sectors ?? []).includes(sektor) && <option value={sektor}>{sektor}</option>}
            {(data?.sectors ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
            <option value="-">Belum diisi</option>
          </select>
          <select className="pap-select" value={sumber} onChange={(e) => setSumber(e.target.value)} aria-label="Filter sumber">
            <option value="">Semua sumber</option>
            {(data?.sources ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="pap-select" value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Filter sales">
            <option value="">{data?.canSupervise ? 'Semua sales' : 'Semua prospek'}</option>
            <option value="me">Ditugaskan ke saya</option>
            {data?.canSupervise && <option value="none">Belum ada sales</option>}
            {data?.canSupervise && data.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        {view === 'list' ? (
          <div className="pap-table-wrap">
            <table>
              <thead><tr><th>Prospek</th><th>Kontak</th><th>Kebutuhan</th><th>Sales</th><th>Follow-up</th><th>Status</th><th className="pap-actions-col">Aksi</th></tr></thead>
              <tbody>
                {(data?.items ?? []).map((p) => (
                  <tr key={p.id} className="pap-row-link" onClick={() => setDetailId(p.id)}>
                    <td><div className="pap-cell-title">{p.nama_usaha}</div><div className="pap-cell-sub">{[p.sektor, p.kota, p.sumber].filter(Boolean).join(' · ') || '—'}</div></td>
                    <td><div>{p.kontak_nama ?? '—'}</div><div className="pap-cell-sub">{p.telepon ?? p.email ?? ''}</div></td>
                    <td><div className="pap-clamp">{p.kebutuhan ?? '—'}</div>{p.estimasi_order && <div className="pap-cell-sub">{p.estimasi_order}</div>}</td>
                    <td>{p.assigned_name ?? <span className="pap-muted">Belum dibagi</span>}{p.maintenance_name && <div className="pap-cell-sub">Maint: {p.maintenance_name}</div>}</td>
                    <td className={`pap-followup ${followupState(p)}`}>{p.next_followup_at ? formatDate(p.next_followup_at, true) : '—'}{p.next_visit && <div className="pap-cell-sub">Visit {formatDate(p.next_visit, true)}</div>}</td>
                    <td><ProspectBadge value={p.status} /></td>
                    <td className="pap-actions-cell"><RowActions label={p.nama_usaha} onView={() => { setAutoEdit(false); setDetailId(p.id) }} onEdit={data?.canSupervise || [p.assigned_to, p.maintenance_to, p.created_by].includes(user.id) ? () => { setAutoEdit(true); setDetailId(p.id) } : undefined} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && !data?.items.length && <div className="pap-empty">{q || sumber || sektor || owner || followup || status !== 'aktif' ? 'Tidak ada prospek yang cocok dengan filter.' : `Belum ada prospek. ${isDigital ? 'Impor lead dari CSV atau tambah satu per satu.' : 'Klik "Tambah prospek" untuk mulai.'}`}</div>}
            {loading && !data && <div className="pap-empty">Memuat prospek...</div>}
          </div>
        ) : (
          <Kanban items={data?.items ?? []} onOpen={setDetailId} />
        )}
        {view === 'list' && data && <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} onPageSize={(v) => { setSize(v); setPage(1) }} />}
      </div>

      {form && (
        <ProspectForm
          user={user}
          initial={form === 'new' ? null : form}
          users={data?.users ?? []}
          sources={data?.sources ?? []}
          canSupervise={!!data?.canSupervise}
          onClose={() => setForm(null)}
          onSaved={(text, id) => { setForm(null); flash(text); load(); if (id) setDetailId(id) }}
        />
      )}
      {importing && <ImportModal users={data?.users ?? []} canSupervise={!!data?.canSupervise} onClose={() => setImporting(false)} onDone={(text) => { setImporting(false); flash(text); load() }} />}
      {detailId && (
        <ProspectDetail
          id={detailId}
          autoEdit={autoEdit}
          user={user}
          users={data?.users ?? []}
          onClose={() => setDetailId(null)}
          onEdit={(p) => { setDetailId(null); setForm(p) }}
          onChanged={load}
          onDeleted={() => { setDetailId(null); flash('Prospek dihapus.'); load() }}
        />
      )}
    </>
  )
}

function Kanban({ items, onOpen }: { items: Prospect[]; onOpen: (id: number) => void }) {
  const columns = PIPELINE.filter((s) => s !== 'handover')
  return (
    <div className="pap-kanban">
      {columns.map((s) => {
        const cards = items.filter((p) => p.status === s)
        return (
          <div key={s} className="pap-kanban-col">
            <div className="pap-kanban-head"><span>{PROSPECT_LABEL[s]}</span><b>{cards.length}</b></div>
            <div className="pap-kanban-cards">
              {cards.map((p) => (
                <button key={p.id} className={`pap-kanban-card ${followupState(p)}`} onClick={() => onOpen(p.id)}>
                  <strong>{p.nama_usaha}</strong>
                  <small>{[p.kontak_nama, p.kota].filter(Boolean).join(' · ') || '—'}</small>
                  {p.kebutuhan && <span className="pap-clamp">{p.kebutuhan}</span>}
                  <em>{p.assigned_name ?? 'Belum dibagi'}{p.next_followup_at ? ` · FU ${formatDate(p.next_followup_at)}` : ''}</em>
                </button>
              ))}
              {!cards.length && <p className="pap-muted">Kosong</p>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ProspectForm({ user, initial, users, canSupervise, onClose, onSaved }: {
  user: UserProfile
  initial: Prospect | null
  users: MarketingUser[]
  sources: string[]
  canSupervise: boolean
  onClose: () => void
  onSaved: (message: string, id?: number) => void
}) {
  // Isian mengikuti tabel "Program Mkt Dev". Kolom lama (email, kota, sumber, estimasi) tidak ditampilkan tetapi tetap dikirim agar tidak terhapus.
  const [values, setValues] = useState({
    nama_usaha: initial?.nama_usaha ?? '',
    sektor: initial?.sektor ?? '',
    alamat: initial?.alamat ?? '',
    // Nama Kontak PIC = nama + jabatan dalam satu isian ("Ibu Surti - Purchasing")
    kontak_nama: [initial?.kontak_nama, initial?.kontak_jabatan].filter(Boolean).join(' - '),
    kontak_jabatan: '',
    telepon: initial?.telepon ?? '',
    email: initial?.email ?? '',
    kota: initial?.kota ?? '',
    sumber: initial?.sumber ?? '',
    estimasi_order: initial?.estimasi_order ?? '',
    payment: initial?.payment ?? '',
    kompetitor: initial?.kompetitor ?? '',
    catatan: initial?.catatan ?? '',
    assigned_to: String(initial?.assigned_to ?? ''),
    next_followup_at: initial ? toInputDateTime(initial.next_followup_at) : nowInput(1, 10),
  })
  const [products, setProducts] = useState<NeedItem[]>(() => (initial?.products?.length ? initial.products : splitNeeds(initial?.kebutuhan ?? '').map((label) => ({ product_id: null, label }))).map(withKey))
  const [duplicate, setDuplicate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Foto produk / lampiran saat tambah prospek: diunggah setelah prospek tersimpan (saat edit langsung lewat panel lampiran)
  const [attachments, setAttachments] = useState<PendingAttachments>(emptyAttachments)
  const set = (key: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }))
  const salesUsers = users.filter((u) => u.division_code !== 'marketing_digital')

  async function submit(e: React.FormEvent, force = false) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const list = products.filter((p) => p.label.trim()).map(({ _k, ...p }) => ({ ...p, label: p.label.trim() }))
      const payload = { ...values, products: list, assigned_to: canSupervise ? values.assigned_to || null : undefined, force }
      if (initial) {
        await api(`/api/prospects/${initial.id}`, { method: 'PATCH', json: payload })
        onSaved('Prospek diperbarui.')
      } else {
        const res = await api<{ id: number }>('/api/prospects', { method: 'POST', json: payload })
        const total = pendingCount(attachments)
        const failed = total ? await uploadPendingAttachments(`/api/prospects/${res.id}/attachments`, attachments) : []
        onSaved(failed.length ? `Prospek ditambahkan, tetapi ${failed.length} dari ${total} lampiran gagal diunggah: ${failed.join(' ')}` : `Prospek ditambahkan${total ? ` dengan ${total} lampiran` : ''}.`, res.id)
      }
    } catch (err) {
      const text = (err as Error).message
      if (text.includes('sudah terdaftar')) setDuplicate(text)
      else setError(text)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={initial ? 'Edit prospek' : 'Tambah prospek'}
      subtitle={initial?.nama_usaha}
      wide
      onClose={onClose}
      footer={<><span className="pap-spacer" /><button type="button" className="pap-btn" onClick={onClose}>Batal</button><button type="submit" form="prospect-form" className="pap-primary-button" disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</button></>}
    >
      <form id="prospect-form" className="pap-form-grid" onSubmit={submit}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        {duplicate && (
          <div className="full"><Notice onClose={() => setDuplicate('')}>{duplicate} <button type="button" className="pap-link-button" onClick={(e) => { setDuplicate(''); submit(e as unknown as React.FormEvent, true) }}>Tetap simpan</button></Notice></div>
        )}
        <Field label="Nama Customer"><input className="pap-input" required maxLength={200} value={values.nama_usaha} onChange={set('nama_usaha')} placeholder="Contoh: PT. Star Global Interpack" /></Field>
        <Field label="Bidang Usaha"><input className="pap-input" list="pap-sektor" maxLength={120} value={values.sektor} onChange={set('sektor')} placeholder="Plastik Cup, RPA, Briket, Garmen..." /></Field>
        <Field label="Alamat dll" full><input className="pap-input" maxLength={500} value={values.alamat} onChange={set('alamat')} placeholder="Alamat lengkap atau kota" /></Field>
        <Field label="Nama Kontak PIC"><input className="pap-input" maxLength={150} value={values.kontak_nama} onChange={set('kontak_nama')} placeholder="Contoh: Ibu Surti - Purchasing" /></Field>
        <Field label="Nomor WhatsApp" hint="Format 08xx / 62xx, dipakai untuk tombol WhatsApp."><input className="pap-input" inputMode="tel" maxLength={40} value={values.telepon} onChange={set('telepon')} /></Field>
        <Field label="Produk" full hint="Satu baris per produk: Jenis Product - Spec, Jenis Plastik, Qty Kebutuhan (Kg), Harga / satuan, Satuan Harga, GPF/sat. Bisa lebih dari satu produk.">
          <ProductTable value={products} onChange={setProducts} />
        </Field>
        <Field label="Payment"><input className="pap-input" list="pap-payment" maxLength={255} value={values.payment} onChange={set('payment')} placeholder="Contoh: TOP 30 Days, DP 50% Pelunasan COD" /></Field>
        {canSupervise ? (
          <Field label="Sales (Marketing Development)">
            <select className="pap-select" value={values.assigned_to} onChange={set('assigned_to')}>
              <option value="">Belum dibagikan</option>
              {salesUsers.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.division_name}</option>)}
            </select>
          </Field>
        ) : <div />}
        <Field label="Kompetitor" full>
          <textarea className="pap-input" rows={2} maxLength={2000} value={values.kompetitor} onChange={set('kompetitor')} placeholder="Supplier yang sekarang dipakai: nama, produk, harga, kelebihan / kekurangannya" />
        </Field>
        <Field label="Kendala" full>
          <textarea className="pap-input" rows={2} maxLength={5000} value={values.catatan} onChange={set('catatan')} placeholder="Threat / kendala / catatan lain, mis. harga kompetitor lebih murah, minimal order terlalu besar" />
        </Field>
        <Field label="Foto Produk / lampiran (file & link)" full hint={initial ? 'File dan link langsung tersimpan saat ditambahkan; bisa lebih dari satu.' : 'Bisa lebih dari satu file dan link; diunggah saat prospek disimpan.'}>
          {initial
            ? <AttachmentPanel title="Lampiran tersimpan" basePath={`/api/prospects/${initial.id}/attachments`} fileBase="/api/prospects/attachments" canAdd currentUserId={user.id} isAdmin={user.role.isAdmin} allowVideo />
            : <AttachmentInput value={attachments} onChange={setAttachments} allowVideo />}
        </Field>
        <datalist id="pap-sektor">{['Plastik Cup', 'RPA', 'Briket', 'Garmen Lokal', 'Apparel & Shoes', 'Snack', 'Laundry', 'F&B / Kuliner', 'Retail / Toko', 'Distributor', 'Pabrik'].map((x) => <option key={x} value={x} />)}</datalist>
        <datalist id="pap-payment">{['TOP 30 Days', 'TOP 60 Days', 'COD Full Quantity PO', 'DP 50% Pelunasan COD', 'DP 50% Pelunasan sblm kirim', 'DP 30% Pelunasan COD'].map((x) => <option key={x} value={x} />)}</datalist>
      </form>
    </Modal>
  )
}

// ---- Produk prospek (format tabel Program Mkt Dev): dari Data Produk atau teks bebas ----
type ProductOption = { id: number; nama: string; jenis: string | null; spesifikasi: string | null; bahan: string | null; customer_name: string | null }
const splitNeeds = (text: string) => text.split(/\s*;\s*/).map((t) => t.trim()).filter(Boolean)
export type NeedItem = {
  product_id: number | null; label: string; estimasi?: string | null
  jenis_plastik?: string | null; qty_kg?: number | string | null; harga?: number | string | null; satuan_harga?: string | null; gpf?: number | string | null
  jenis?: string | null; spesifikasi?: string | null; bahan?: string | null; _k?: number
}
let needKey = 0
const withKey = (n: NeedItem): NeedItem => ({ ...n, _k: ++needKey })
const PLASTIK = ['HD', 'PP', 'PE', 'PP KW', 'LDPE', 'LLDPE', 'OPP', 'CPP']
const plastikOf = (p: ProductOption) => PLASTIK.find((j) => j === (p.jenis ?? '').toUpperCase() || new RegExp(`\\b${j}\\b`, 'i').test(p.nama)) ?? null
const fmtNum = (v: number | string | null | undefined) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('id-ID', { maximumFractionDigits: 2 }))

function ProductTable({ value, onChange }: { value: NeedItem[]; onChange: (value: NeedItem[]) => void }) {
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<ProductOption[]>([])

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      api<{ items: ProductOption[] }>(`/api/products?status=aktif&q=${encodeURIComponent(term)}`)
        .then((res) => {
          // Produk sama dipesan banyak customer: tampilkan satu per nama
          const seen = new Set<string>()
          setOptions(res.items.filter((p) => !seen.has(p.nama.toLowerCase()) && seen.add(p.nama.toLowerCase())).slice(0, 15))
        })
        .catch(() => {})
    }, 250)
    return () => clearTimeout(timer)
  }, [term, open])

  const add = (text: string, product?: ProductOption) => {
    const clean = text.trim().replace(/;/g, ',')
    if (!clean || value.some((n) => n.label.trim().toLowerCase() === clean.toLowerCase())) return
    onChange([...value, withKey({ product_id: product?.id ?? null, label: clean, jenis_plastik: product ? plastikOf(product) : null, satuan_harga: 'Kg', jenis: product?.jenis, spesifikasi: product?.spesifikasi, bahan: product?.bahan })])
    setTerm('')
  }
  const blank = () => onChange([...value, withKey({ product_id: null, label: '', satuan_harga: 'Kg' })])
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i))
  const edit = (i: number, patch: Partial<NeedItem>) => onChange(value.map((n, idx) => (idx === i ? { ...n, ...patch, ...(patch.label !== undefined && patch.label !== n.label ? { product_id: null } : {}) } : n)))

  return (
    <div className="pap-need-picker">
      {value.length > 0 && (
        <ol className="pap-prod-rows">
          {value.map((n, i) => (
            <li key={n._k ?? i}>
              <div className="pap-prod-top">
                <span className="pap-need-no">{i + 1}</span>
                <label className="pap-prod-spec">
                  <span>Jenis Product - Spec{n.product_id ? <em> · <Package className="pap-inline-icon" /> Data Produk</em> : null}</span>
                  <input className="pap-input" maxLength={255} value={n.label} onChange={(e) => edit(i, { label: e.target.value })} placeholder="Contoh: PP Kantong Uk. 16x75x025 2W 22 OZ" />
                </label>
                <button type="button" className="pap-icon-button" aria-label={`Hapus produk ${i + 1}`} title="Hapus produk" onClick={() => remove(i)}><Trash2 /></button>
              </div>
              <div className="pap-prod-fields">
                <label><span>Jenis Plastik</span><input className="pap-input" list="pap-plastik" maxLength={40} value={n.jenis_plastik ?? ''} onChange={(e) => edit(i, { jenis_plastik: e.target.value })} placeholder="PP / HD / PE" /></label>
                <label><span>Qty Kebutuhan (Kg)</span><input className="pap-input" inputMode="decimal" value={n.qty_kg ?? ''} onChange={(e) => edit(i, { qty_kg: e.target.value })} placeholder="0" /></label>
                <label><span>Harga / satuan (Rp)</span><input className="pap-input" inputMode="decimal" value={n.harga ?? ''} onChange={(e) => edit(i, { harga: e.target.value })} placeholder="0" /></label>
                <label><span>Satuan Harga</span>
                  <select className="pap-select" value={n.satuan_harga ?? ''} onChange={(e) => edit(i, { satuan_harga: e.target.value })}>
                    <option value="">—</option>
                    {['Kg', 'Pcs', 'Lembar', 'Roll', 'Pack'].map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </label>
                <label><span>GPF/sat (Rp)</span><input className="pap-input" inputMode="decimal" value={n.gpf ?? ''} onChange={(e) => edit(i, { gpf: e.target.value })} placeholder="0" /></label>
              </div>
              {n.estimasi ? <small className="pap-muted">Estimasi (data lama): {n.estimasi}</small> : null}
            </li>
          ))}
        </ol>
      )}
      <div className="pap-prod-add">
        <button type="button" className="pap-btn" onClick={blank}><Plus /> Tambah produk</button>
        <div className="pap-combo">
          <input
            className="pap-input"
            value={term}
            placeholder="atau cari di Data Produk, tekan Enter untuk menambah..."
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(term) } }}
          />
          {open && (
            <ul className="pap-combo-list">
              {term.trim() && <li><button type="button" onMouseDown={(e) => { e.preventDefault(); add(term) }}><strong>Tambah "{term.trim()}"</strong><small>Ketik bebas (produk baru / custom)</small></button></li>}
              {options.filter((p) => !value.some((n) => n.label.trim().toLowerCase() === p.nama.toLowerCase())).map((p) => (
                <li key={p.id}><button type="button" onMouseDown={(e) => { e.preventDefault(); add(p.nama, p) }}><strong>{p.nama}</strong><small>{[p.jenis, p.spesifikasi, p.bahan].filter(Boolean).join(' · ') || 'Data Produk'}</small></button></li>
              ))}
              {!options.length && !term.trim() && <li className="pap-combo-empty">Ketik untuk mencari produk.</li>}
            </ul>
          )}
        </div>
      </div>
      <datalist id="pap-plastik">{PLASTIK.map((x) => <option key={x} value={x} />)}</datalist>
    </div>
  )
}

// Tabel produk di detail prospek
function ProductList({ items }: { items: NeedItem[] }) {
  return (
    <div className="pap-table-wrap">
      <table className="pap-prod-table">
        <thead><tr><th>No</th><th>Jenis Product - Spec</th><th>Jenis Plastik</th><th className="num">Qty (Kg)</th><th className="num">Harga / satuan</th><th className="num">GPF/sat</th></tr></thead>
        <tbody>
          {items.map((p, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>{p.product_id ? <Package className="pap-inline-icon" /> : null}{p.label}{p.estimasi ? <div className="pap-cell-sub">{p.estimasi}</div> : null}</td>
              <td>{p.jenis_plastik || '—'}</td>
              <td className="num">{fmtNum(p.qty_kg) || '0'}</td>
              <td className="num">Rp {fmtNum(p.harga) || '0'}{p.satuan_harga ? `/${p.satuan_harga.toLowerCase()}` : ''}</td>
              <td className="num">{fmtNum(p.gpf) || '0'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---- Detail prospek: data, aksi cepat, log follow-up, visit ----
function ProspectDetail({ id, autoEdit = false, user, users, onClose, onEdit, onChanged, onDeleted }: {
  id: number
  autoEdit?: boolean
  user: UserProfile
  users: MarketingUser[]
  onClose: () => void
  onEdit: (p: Prospect) => void
  onChanged: () => void
  onDeleted: () => void
}) {
  const [item, setItem] = useState<Prospect | null>(null)
  const [activities, setActivities] = useState<Activity[]>([])
  const [visits, setVisits] = useState<Visit[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [canFollowUp, setCanFollowUp] = useState(false)
  const [canSupervise, setCanSupervise] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [panel, setPanel] = useState<'' | 'visit' | 'handover' | 'customer' | 'sample' | 'desain' | 'quotation'>('')
  const [visitDetail, setVisitDetail] = useState<Visit | null>(null)
  const [checkin, setCheckin] = useState<Visit | null>(null)
  const [editVisit, setEditVisit] = useState<Visit | null>(null)
  const editOpened = useRef(false)

  const load = useCallback(async () => {
    try {
      const res = await api<{ item: Prospect; activities: Activity[]; visits: Visit[]; canEdit: boolean; canFollowUp?: boolean; canSupervise: boolean }>(`/api/prospects/${id}`)
      setItem(res.item)
      setActivities(res.activities)
      setVisits(res.visits)
      setCanEdit(res.canEdit)
      setCanFollowUp(res.canFollowUp ?? res.canEdit)
      setCanSupervise(res.canSupervise)
      // Dibuka dari tombol Ubah di daftar: langsung ke form bila boleh diubah
      if (autoEdit && !editOpened.current) {
        editOpened.current = true
        if (res.canEdit) onEdit(res.item)
        else setError('Anda tidak bisa mengubah prospek ini (hanya sales PIC / supervisor).')
      }
    } catch (e) {
      setError((e as Error).message)
    }
  }, [id])
  useEffect(() => { load() }, [load])

  const changed = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 4000)
    load()
    onChanged()
  }
  async function patch(json: Record<string, unknown>, text: string) {
    setError('')
    try {
      await api(`/api/prospects/${id}`, { method: 'PATCH', json })
      changed(text)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  async function setStatus(next: ProspectStatus) {
    if (!item || next === item.status) return
    let alasan = ''
    if (next === 'gagal') {
      alasan = (await askReason({ title: 'Prospek gagal', label: 'Alasan prospek gagal', placeholder: 'Mis. harga, sudah punya supplier, tidak butuh', confirmLabel: 'Tandai gagal' })) ?? ''
      if (!alasan.trim()) return
    }
    patch({ status: next, alasan_gagal: alasan }, `Status diubah ke ${PROSPECT_LABEL[next]}.`)
  }
  async function remove() {
    if (!item || !(await confirmDialog(`Hapus prospek ${item.nama_usaha} beserta riwayat follow-up & visit?`))) return
    try {
      await api(`/api/prospects/${id}`, { method: 'DELETE' })
      onDeleted()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (!item) return <Modal title="Prospek" onClose={onClose}>{error ? <Notice>{error}</Notice> : <p className="pap-muted">Memuat...</p>}</Modal>
  const salesUsers = users.filter((u) => u.division_code !== 'marketing_digital')
  const maintUsers = users.filter((u) => ['marketing_maintenance', 'marketing'].includes(u.division_code))
  const greeting = `Halo${item.kontak_nama ? ` ${item.kontak_nama}` : ''}, saya dari PT Pandawa Amerta Packindo (produsen kantong plastik HD/PP/PE custom).`

  return (
    <>
      <Modal
        title={item.nama_usaha}
        subtitle={[item.sektor, item.kota, item.sumber && `Sumber: ${item.sumber}`].filter(Boolean).join(' · ')}
        wide
        onClose={onClose}
        footer={<>
          {(canSupervise || item.created_by === user.id) && <button type="button" className="pap-btn danger" onClick={remove}><Trash2 /> Hapus</button>}
          <span className="pap-spacer" />
          {canEdit && <button type="button" className="pap-btn" onClick={() => onEdit(item)}><Pencil /> Edit data</button>}
        </>}
      >
        {error && <Notice onClose={() => setError('')}>{error}</Notice>}
        {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
        <div className="pap-detail-badges">
          <ProspectBadge value={item.status} />
          {followupState(item) === 'overdue' && <span className="pap-status danger">Follow-up terlambat</span>}
          {item.customer_name && <span className="pap-status success">Customer: {item.customer_name}{item.customer_no ? ` (${item.customer_no})` : ''}</span>}
        </div>

        {canEdit && (
          <div className="pap-stepper" role="group" aria-label="Ubah status">
            {PIPELINE.map((s, i) => (
              <button key={s} type="button" className={`${s === item.status ? 'current' : ''} ${PIPELINE.indexOf(item.status) > i ? 'done' : ''}`} onClick={() => setStatus(s)}>{PROSPECT_LABEL[s]}</button>
            ))}
            <button type="button" className={`fail ${item.status === 'gagal' ? 'current' : ''}`} onClick={() => setStatus('gagal')}>Gagal</button>
          </div>
        )}
        {item.status === 'gagal' && item.alasan_gagal && <Notice>Alasan gagal: {item.alasan_gagal}</Notice>}

        <dl className="pap-detail-grid">
          <div><dt>Kontak</dt><dd>{item.kontak_nama ?? '—'}{item.kontak_jabatan ? ` · ${item.kontak_jabatan}` : ''}</dd></div>
          <div><dt>Telepon / email</dt><dd>{item.telepon ? <a href={`tel:+${item.telepon}`}><Phone className="pap-inline-icon" /> +{item.telepon}</a> : '—'}{item.email && <><br /><a href={`mailto:${item.email}`}><Mail className="pap-inline-icon" /> {item.email}</a></>}</dd></div>
          <div><dt>Alamat</dt><dd>{[item.alamat, item.kota].filter(Boolean).join(', ') || '—'}</dd></div>
          <div><dt>Payment</dt><dd>{item.payment || '—'}{item.estimasi_order && <><br /><small className="pap-muted">Estimasi: {item.estimasi_order}</small></>}</dd></div>
          <div>
            <dt>Sales</dt>
            <dd>
              {canSupervise ? (
                <select className="pap-select" value={item.assigned_to ?? ''} onChange={(e) => patch({ assigned_to: e.target.value || null }, 'Sales prospek diperbarui.')}>
                  <option value="">Belum dibagikan</option>
                  {salesUsers.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.division_name}</option>)}
                </select>
              ) : item.assigned_name ?? '—'}
            </dd>
          </div>
          <div><dt>Marketing Maintenance</dt><dd>{item.maintenance_name ?? '—'}</dd></div>
          <div>
            <dt>Follow-up berikutnya</dt>
            <dd>{canEdit ? <input className="pap-input" type="datetime-local" defaultValue={toInputDateTime(item.next_followup_at)} key={item.next_followup_at ?? 'none'} onBlur={(e) => e.target.value !== toInputDateTime(item.next_followup_at) && patch({ next_followup_at: e.target.value }, 'Jadwal follow-up diperbarui.')} /> : formatDate(item.next_followup_at, true)}</dd>
          </div>
          <div><dt>Dibuat</dt><dd>{item.created_name} · {formatDate(item.created_at)}</dd></div>
          <div className="full"><dt>Produk</dt><dd>{item.products?.length ? <ProductList items={item.products} /> : item.kebutuhan ?? '—'}</dd></div>
          {item.kompetitor && <div className="full"><dt>Kompetitor</dt><dd className="pap-prewrap">{item.kompetitor}</dd></div>}
          {item.catatan && <div className="full"><dt>Kendala</dt><dd className="pap-prewrap">{item.catatan}</dd></div>}
        </dl>

        <div className="pap-inline-actions pap-wrap">
          <WaButton phone={item.telepon} text={greeting} />
          {canEdit && <button className="pap-btn" onClick={() => setPanel(panel === 'visit' ? '' : 'visit')}><CalendarPlus /> Jadwalkan visit</button>}
          {canEdit && user.menus.includes('quotation') && <button className="pap-btn" onClick={() => setPanel('quotation')}><FileText /> Buat penawaran</button>}
          {canEdit && user.menus.includes('sample') && <button className="pap-btn" onClick={() => setPanel('sample')}><FlaskConical /> Request sample</button>}
          {canEdit && user.menus.includes('desain') && <button className="pap-btn" onClick={() => setPanel('desain')}><Palette /> Request desain</button>}
          {canEdit && ['order_pertama', 'penawaran', 'handover', 'visit'].includes(item.status) && <button className="pap-btn" onClick={() => setPanel(panel === 'customer' ? '' : 'customer')}><Link2 /> {item.customer_id ? 'Ganti customer' : 'Jadikan customer'}</button>}
          {canEdit && (item.status === 'order_pertama' || item.status === 'handover') && <button className="pap-btn" onClick={() => setPanel(panel === 'handover' ? '' : 'handover')}><Send /> Handover ke Maintenance</button>}
        </div>

        {panel === 'customer' && <CustomerLinkPanel prospect={item} onDone={(text) => { setPanel(''); changed(text) }} onError={setError} />}
        {panel === 'handover' && (
          <HandoverPanel users={maintUsers} current={item.maintenance_to} onCancel={() => setPanel('')} onSubmit={(maintenanceTo, catatan) => { setPanel(''); patch({ maintenance_to: maintenanceTo, catatan_handover: catatan, status: 'handover' }, 'Prospek diserahkan ke Marketing Maintenance.') }} />
        )}

        {canFollowUp && <ActivityForm prospect={item} onSaved={(text) => changed(text)} />}

        <AttachmentPanel title="Foto Produk / lampiran" basePath={`/api/prospects/${item.id}/attachments`} fileBase="/api/prospects/attachments" canAdd={canEdit} currentUserId={user.id} isAdmin={user.role.isAdmin} allowVideo />

        {visits.length > 0 && (
          <section className="pap-detail-section">
            <h3>Visit ({visits.length})</h3>
            <ul className="pap-visit-mini">
              {visits.map((v) => (
                <li key={v.id}><button type="button" onClick={() => setVisitDetail(v)}><MapPin /><span><strong>{formatDate(v.jadwal, true)}</strong> · {v.sales_name}{v.hasil ? ` — ${v.hasil}` : v.tujuan ? ` — ${v.tujuan}` : ''}</span><VisitBadge value={v.status} /></button></li>
              ))}
            </ul>
          </section>
        )}

        <section className="pap-detail-section">
          <h3>Riwayat follow-up ({activities.length})</h3>
          <ol className="pap-note-list">
            {activities.map((a) => (
              <li key={a.id} className={`pap-note-item act-${a.jenis}`}>
                <div className="pap-note-head">
                  <span className="pap-note-progress">{ACTIVITY_LABEL[a.jenis] ?? a.jenis}</span>
                  {a.status_to && <span className="pap-note-meta">{a.status_from ? `${PROSPECT_LABEL[a.status_from] ?? a.status_from} → ` : ''}<strong>{PROSPECT_LABEL[a.status_to] ?? a.status_to}</strong></span>}
                  <span className="pap-note-meta"><strong>{a.user_name}</strong> · {formatDate(a.created_at, true)}</span>
                </div>
                {a.hasil && <p className="pap-prewrap">{a.hasil}</p>}
                <NoteFiles items={a.attachments} currentUserId={user.id} isAdmin={user.role.isAdmin} onChanged={load} />
              </li>
            ))}
          </ol>
          {!activities.length && <p className="pap-muted">Belum ada aktivitas.</p>}
        </section>
      </Modal>

      {panel === 'visit' && (
        <VisitForm
          prospect={item}
          users={users}
          canSupervise={canSupervise}
          currentUserId={user.id}
          onClose={() => setPanel('')}
          onSaved={(text) => { setPanel(''); changed(text) }}
        />
      )}
      {panel === 'quotation' && <QuotationForm prefill={{ prospect: item }} onClose={() => setPanel('')} onSaved={(text) => { setPanel(''); changed(`${text} Buka menu Quotation untuk mencetak & mengirim.`) }} />}
      {panel === 'sample' && <SampleForm prospect={item} onClose={() => setPanel('')} onSaved={(text) => { setPanel(''); changed(text) }} />}
      {panel === 'desain' && <DesignForm prospect={item} onClose={() => setPanel('')} onSaved={(text) => { setPanel(''); changed(text) }} />}
      {visitDetail && !checkin && !editVisit && (
        <VisitDetail
          visit={visitDetail}
          currentUserId={user.id}
          canSupervise={canSupervise}
          isAdmin={user.role.isAdmin}
          onClose={() => setVisitDetail(null)}
          onCheckin={() => setCheckin(visitDetail)}
          onEdit={() => setEditVisit(visitDetail)}
          onChanged={(text) => { setVisitDetail(null); changed(text) }}
        />
      )}
      {checkin && <CheckinForm visit={checkin} onClose={() => setCheckin(null)} onSaved={(text) => { setCheckin(null); setVisitDetail(null); changed(text) }} />}
      {editVisit && <VisitForm initial={editVisit} users={users} canSupervise={canSupervise} currentUserId={user.id} onClose={() => setEditVisit(null)} onSaved={(text) => { setEditVisit(null); setVisitDetail(null); changed(text) }} />}
    </>
  )
}

// Log follow-up: jenis kontak, hasil, status baru (opsional), follow-up berikutnya
function ActivityForm({ prospect, onSaved }: { prospect: Prospect; onSaved: (message: string) => void }) {
  const [values, setValues] = useState({ jenis: 'whatsapp', hasil: '', status: '', next_followup_at: nowInput(3, 10), alasan_gagal: '' })
  const [attachments, setAttachments] = useState<PendingAttachments>(emptyAttachments)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (key: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }))
  // Kontak pertama: status "Lead baru" otomatis disarankan menjadi "Dihubungi"
  useEffect(() => setValues((v) => ({ ...v, status: prospect.status === 'baru' ? 'dihubungi' : '' })), [prospect.status])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const res = await api<{ id: number }>(`/api/prospects/${prospect.id}/activities`, { method: 'POST', json: { ...values, lampiran: pendingCount(attachments) } })
      const failed = await uploadNoteAttachments('activity', res.id, attachments)
      setValues((v) => ({ ...v, hasil: '', alasan_gagal: '' }))
      setAttachments(emptyAttachments())
      onSaved(failed.length ? `Follow-up dicatat. Sebagian lampiran gagal: ${failed.join(' ')}` : 'Follow-up dicatat.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <section className="pap-detail-section">
      <h3>Catat follow-up</h3>
      <form className="pap-activity-form" onSubmit={submit}>
        {error && <Notice onClose={() => setError('')}>{error}</Notice>}
        <div className="pap-activity-row">
          <select className="pap-select" value={values.jenis} onChange={set('jenis')} aria-label="Jenis follow-up">
            <option value="whatsapp">WhatsApp</option>
            <option value="telepon">Telepon</option>
            <option value="email">Email</option>
            <option value="meeting">Meeting</option>
            <option value="catatan">Catatan</option>
          </select>
          <select className="pap-select" value={values.status} onChange={set('status')} aria-label="Status setelah follow-up">
            <option value="">Status tetap ({PROSPECT_LABEL[prospect.status]})</option>
            {PIPELINE.filter((s) => s !== prospect.status).map((s) => <option key={s} value={s}>→ {PROSPECT_LABEL[s]}</option>)}
            {prospect.status !== 'gagal' && <option value="gagal">→ Gagal</option>}
          </select>
          <label className="pap-activity-date"><span>Follow-up berikutnya</span><input className="pap-input" type="datetime-local" value={values.next_followup_at} onChange={set('next_followup_at')} /></label>
        </div>
        <textarea className="pap-input" rows={2} maxLength={5000} value={values.hasil} onChange={set('hasil')} placeholder="Hasil follow-up (opsional bila ada lampiran): respon, kebutuhan, harga yang diminta, minta sampel, dll." />
        <div className="pap-note-attach"><AttachmentInput value={attachments} onChange={setAttachments} /></div>
        {values.status === 'gagal' && <input className="pap-input" required maxLength={500} value={values.alasan_gagal} onChange={set('alasan_gagal')} placeholder="Alasan gagal" />}
        <div className="pap-inline-actions"><span className="pap-spacer" /><button type="submit" className="pap-primary-button" disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan follow-up'}</button></div>
      </form>
    </section>
  )
}

function HandoverPanel({ users, current, onCancel, onSubmit }: { users: MarketingUser[]; current: number | null; onCancel: () => void; onSubmit: (userId: number, catatan: string) => void }) {
  const [userId, setUserId] = useState(String(current ?? users.find((u) => u.division_code === 'marketing_maintenance')?.id ?? ''))
  const [catatan, setCatatan] = useState('')
  return (
    <div className="pap-inline-panel">
      <strong>Handover ke Marketing Maintenance</strong>
      <p className="pap-muted">Customer baru yang sudah order pertama diserahkan untuk dijaga repeat order-nya.</p>
      <select className="pap-select" value={userId} onChange={(e) => setUserId(e.target.value)}>
        <option value="">Pilih user Marketing Maintenance</option>
        {users.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.division_name}</option>)}
      </select>
      <textarea className="pap-input" rows={2} maxLength={1000} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Catatan handover: produk yang dipesan, harga deal, preferensi customer..." />
      <div className="pap-inline-actions"><span className="pap-spacer" /><button className="pap-btn" onClick={onCancel}>Batal</button><button className="pap-primary-button" disabled={!userId} onClick={() => onSubmit(Number(userId), catatan)}>Serahkan</button></div>
    </div>
  )
}

function CustomerLinkPanel({ prospect, onDone, onError }: { prospect: Prospect; onDone: (message: string) => void; onError: (message: string) => void }) {
  const [customer, setCustomer] = useState<CustomerOption | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(json: Record<string, unknown>, text: string) {
    setBusy(true)
    try {
      await api(`/api/prospects/${prospect.id}/customer`, { method: 'POST', json })
      onDone(text)
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="pap-inline-panel">
      <strong>Jadikan customer</strong>
      <p className="pap-muted">Hubungkan ke customer yang sudah ada di Accurate, atau buat customer baru di Accurate dari data prospek ini.</p>
      <CustomerSelect value={customer} onChange={setCustomer} />
      <div className="pap-inline-actions pap-wrap">
        <button className="pap-btn" disabled={busy} onClick={async () => (await confirmDialog(`Buat customer baru "${prospect.nama_usaha}" di Accurate?`)) && submit({ create: true }, 'Customer baru dibuat di Accurate dan dihubungkan.')}>Buat customer baru di Accurate</button>
        <span className="pap-spacer" />
        <button className="pap-primary-button" disabled={busy || !customer} onClick={() => submit({ customerId: customer!.id }, 'Prospek dihubungkan ke customer.')}>Hubungkan</button>
      </div>
    </div>
  )
}

// ---- Impor Excel / CSV: kolom sama dengan tabel "Program Mkt Dev" ----
const CSV_COLUMNS: [string, string][] = [
  ['nama_usaha', 'Nama Customer'], ['sektor', 'Bidang Usaha'], ['alamat', 'Alamat dll'], ['kontak_nama', 'Nama Kontak PIC'], ['telepon', 'Nomor WhatsApp'],
  ['kebutuhan', 'Jenis Product - Spec'], ['jenis_plastik', 'Jenis Plastik'], ['qty_kg', 'Qty Kebutuhan (Kg)'], ['harga', 'Harga / satuan'], ['satuan_harga', 'Satuan Harga'],
  ['gpf', 'GPF/sat'], ['payment', 'Payment'], ['kompetitor', 'Kompetitor'], ['catatan', 'Kendala'],
]
const PRODUCT_KEYS = ['jenis_plastik', 'qty_kg', 'harga', 'satuan_harga', 'gpf'] as const
type ImportProduct = { label: string; jenis_plastik?: string; qty_kg?: string; harga?: string; satuan_harga?: string; gpf?: string; estimasi?: string }
type ImportRow = Record<string, string> & { products?: ImportProduct[] }
type ImportBatch = { batch: string; waktu: string; jumlah: number; oleh: string; contoh: string; aktivitas: number }
// Judul kolom lain yang tetap dikenali (template lama, file sendiri)
const HEADER_ALIASES: Record<string, string> = {
  no: '_no', nama: 'nama_usaha', 'nama usaha': 'nama_usaha', usaha: 'nama_usaha', perusahaan: 'nama_usaha', toko: 'nama_usaha', customer: 'nama_usaha', 'nama cust': 'nama_usaha', 'nama pelanggan': 'nama_usaha',
  kontak: 'kontak_nama', 'nama kontak': 'kontak_nama', pic: 'kontak_nama', jabatan: 'kontak_jabatan', 'jabatan kontak': 'kontak_jabatan',
  wa: 'telepon', 'no wa': 'telepon', 'nomor wa': 'telepon', 'no whatsapp': 'telepon', 'no. wa': 'telepon', 'no. whatsapp': 'telepon', 'nomor hp': 'telepon', 'no telp': 'telepon', whatsapp: 'telepon', hp: 'telepon', telepon: 'telepon', phone: 'telepon', 'no hp': 'telepon',
  email: 'email', sektor: 'sektor', 'sektor usaha': 'sektor', alamat: 'alamat', kota: 'kota', sumber: 'sumber',
  kebutuhan: 'kebutuhan', produk: 'kebutuhan', 'produk diminati': 'kebutuhan', 'jenis product': 'kebutuhan', 'jenis produk - spec': 'kebutuhan', 'jenis produk': 'kebutuhan',
  qty: 'qty_kg', 'qty (kg)': 'qty_kg', 'qty kebutuhan': 'qty_kg', harga: 'harga', 'harga/satuan': 'harga', satuan: 'satuan_harga', gpf: 'gpf', 'gpf / sat': 'gpf',
  'estimasi order': 'estimasi_order', estimasi: 'estimasi_order', catatan: 'catatan', keterangan: 'catatan', 'catatan threat/ kendala/ lainnya': 'catatan', threat: 'catatan', kendala: 'catatan',
  supplier: 'kompetitor', 'supplier lain': 'kompetitor', 'kompetitor / supplier lain': 'kompetitor', 'kompetitor supplier lain': 'kompetitor', pembayaran: 'payment',
}
const productOf = (r: Record<string, string>): ImportProduct => ({
  label: r.kebutuhan, ...Object.fromEntries(PRODUCT_KEYS.filter((k) => r[k]).map((k) => [k, r[k]])),
})
const addLine = (text: string | undefined, line: string) => [text, line].filter(Boolean).join('\n')

// Baris file -> prospek. Baris tanpa Nama Customer di bawah prospek = produk tambahan / kontak lain prospek itu.
function groupImportRows(parsed: Record<string, string>[]) {
  const data: ImportRow[] = []
  for (const raw of parsed) {
    const r = { ...raw }
    // Nama tertulis di kolom No ("12 Ciomas Adi Satwa")
    if (!r.nama_usaha && /^\d+\s+\D/.test(r._no ?? '')) r.nama_usaha = r._no.replace(/^\d+\s+/, '')
    delete r._no
    if (r.nama_usaha) {
      const row: ImportRow = { ...r }
      if (r.kebutuhan) row.products = r.kebutuhan.includes(';') && !PRODUCT_KEYS.some((k) => r[k]) ? r.kebutuhan.split(/\s*;\s*/).filter(Boolean).map((label) => ({ label })) : [productOf(r)]
      if (row.products?.length === 1 && r.estimasi_order) row.products[0].estimasi = r.estimasi_order
      // Kolom "Alamat dll" yang hanya berisi kota -> juga jadi Kota (untuk filter & jadwal visit)
      if (!row.kota && row.alamat && row.alamat.length <= 40 && !/\d/.test(row.alamat)) row.kota = row.alamat
      data.push(row)
      continue
    }
    const prev = data.at(-1)
    if (!prev) continue
    if (r.kebutuhan && !prev.products?.some((p) => p.label.toLowerCase() === r.kebutuhan.toLowerCase())) (prev.products ??= []).push(productOf(r))
    if (r.payment && !prev.payment) prev.payment = r.payment
    const kontak = [r.kontak_nama, r.kontak_jabatan, r.telepon].filter(Boolean).join(' · ')
    if (kontak) prev.catatan = addLine(prev.catatan, `Kontak lain: ${kontak}`)
    if (r.catatan) prev.catatan = addLine(prev.catatan, r.catatan)
    if (r.kompetitor) prev.kompetitor = addLine(prev.kompetitor, r.kompetitor)
  }
  for (const r of data) if (r.products?.length) r.kebutuhan = r.products.map((p) => p.label).join('; ')
  return data
}

// Parser CSV sederhana (koma atau titik koma, mendukung tanda kutip)
function parseCsv(text: string) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === sep) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((c) => c.trim())) rows.push(row)
      row = []
    } else cell += ch
  }
  row.push(cell)
  if (row.some((c) => c.trim())) rows.push(row)
  return rows
}

function ImportModal({ users, canSupervise, onClose, onDone }: { users: MarketingUser[]; canSupervise: boolean; onClose: () => void; onDone: (message: string) => void }) {
  const [rows, setRows] = useState<ImportRow[]>([])
  const [fileName, setFileName] = useState('')
  const [assigned, setAssigned] = useState('')
  const [saving, setSaving] = useState(false)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const [batches, setBatches] = useState<ImportBatch[]>([])
  const [undoing, setUndoing] = useState('')
  const salesUsers = users.filter((u) => u.division_code !== 'marketing_digital')
  const template = useMemo(() => `data:text/csv;charset=utf-8,${encodeURIComponent(`${CSV_COLUMNS.map(([, l]) => l).join(',')}\nPT. Contoh Plastik Jaya,Plastik Cup,Sukoharjo,Ibu Surti - Purchasing,081234567890,PP Kantong Uk. 16x75x025 2W 22 OZ,PP,2000,Rp 50.000/kg,Kg,11500,TOP 30 Days,,\n,,,,,PP Kantong Uk. 16x61x03 2W 14 OZ,PP,1000,Rp 50.000/kg,Kg,11500,,,\n`)}`, [])
  const loadBatches = useCallback(() => { api<{ items: ImportBatch[] }>('/api/prospects/import').then((r) => setBatches(r.items)).catch(() => {}) }, [])
  useEffect(loadBatches, [loadBatches])

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    setRows([])
    setFileName(file.name)
    let table: string[][]
    if (/\.(xlsx|xlsm)$/i.test(file.name)) {
      // Excel dibaca di server (sheet pertama berisi data), pemetaan kolom sama dengan CSV
      setReading(true)
      try {
        const body = new FormData()
        body.append('file', file)
        table = (await api<{ rows: string[][] }>('/api/prospects/import/excel', { method: 'POST', body })).rows
      } catch (err) {
        return setError((err as Error).message)
      } finally {
        setReading(false)
      }
    } else if (/\.xls$/i.test(file.name)) {
      return setError('File Excel 97-2003 (.xls) belum didukung. Buka di Excel lalu Simpan Sebagai "Excel Workbook (.xlsx)".')
    } else table = parseCsv(await file.text())
    if (table.length < 2) return setError('File kosong atau hanya berisi judul kolom.')
    // Baris judul = baris pertama yang memuat kolom Nama Cust (judul laporan di atas tabel dilewati)
    const keyOf = (h: string) => {
      const key = String(h ?? '').trim().toLowerCase().replace(/[_*]/g, ' ').replace(/\s+/g, ' ')
      return CSV_COLUMNS.find(([k, l]) => k === key.replace(/ /g, '_') || l.toLowerCase() === key)?.[0] ?? HEADER_ALIASES[key] ?? null
    }
    const headIdx = table.slice(0, 10).findIndex((r) => r.map(keyOf).includes('nama_usaha'))
    if (headIdx < 0) return setError('Kolom "Nama Customer" tidak ditemukan. Gunakan template Excel atau CSV.')
    const keys = table[headIdx].map(keyOf)
    const parsed = table.slice(headIdx + 1).map((cells) => Object.fromEntries(keys.map((k, i) => [k, String(cells[i] ?? '').trim()]).filter(([k]) => k)) as Record<string, string>)
    const data = groupImportRows(parsed)
    if (!data.length) return setError('Tidak ada baris dengan Nama Customer yang terisi.')
    if (data.length > 500) return setError(`Maksimal 500 prospek per impor (file berisi ${data.length}). Bagi menjadi beberapa file.`)
    setRows(data)
  }
  async function submit() {
    setSaving(true)
    setError('')
    try {
      const res = await api<{ imported: number; skipped: number }>('/api/prospects/import', { method: 'POST', json: { rows, assigned_to: assigned || null } })
      onDone(`${res.imported} prospek diimpor${res.skipped ? `, ${res.skipped} dilewati karena nomor WA sudah terdaftar` : ''}.`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  async function undo(b: ImportBatch) {
    const warn = b.aktivitas ? ` ${b.aktivitas} follow-up / visit yang sudah dicatat pada prospek ini ikut terhapus.` : ''
    if (!(await confirmDialog(`Batalkan impor ${formatDate(b.waktu, true)} (${b.jumlah} prospek)? Prospek dipindah ke Data Terhapus dan masih bisa dipulihkan.${warn}`))) return
    setUndoing(b.batch)
    setError('')
    try {
      const res = await api<{ deleted: number }>(`/api/prospects/import?batch=${encodeURIComponent(b.batch)}`, { method: 'DELETE' })
      onDone(`Impor dibatalkan: ${res.deleted} prospek dipindah ke Data Terhapus.`)
    } catch (e) {
      setError((e as Error).message)
      loadBatches()
    } finally {
      setUndoing('')
    }
  }
  const productCount = rows.reduce((n, r) => n + (r.products?.length ?? 0), 0)
  return (
    <Modal
      title="Impor prospek dari Excel / CSV"
      subtitle='Format kolom sama dengan tabel "Program Mkt Dev": satu prospek bisa beberapa baris produk'
      wide
      onClose={onClose}
      footer={<><a className="pap-btn" href="/api/prospects/import/excel" download><Download /> Template Excel</a><a className="pap-btn" href={template} download="template-prospek.csv">Template CSV</a><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" disabled={saving || reading || !rows.length} onClick={submit}>{saving ? 'Mengimpor...' : `Impor ${rows.length || ''} prospek`}</button></>}
    >
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-form-grid">
        <Field label="File Excel (.xlsx) atau CSV" full hint="Kolom: Nama Customer, Bidang Usaha, Alamat dll, Nama Kontak PIC, Nomor WhatsApp, Jenis Product - Spec, Jenis Plastik, Qty Kebutuhan (Kg), Harga / satuan, Satuan Harga, GPF/sat, Payment, Kompetitor, Kendala. Produk berikutnya ditulis di baris bawahnya dengan Nama Customer dikosongkan. Nomor WA yang sudah terdaftar dilewati.">
          <input className="pap-input" type="file" accept=".xlsx,.xlsm,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFile} disabled={reading} />
        </Field>
        {reading && <p className="pap-muted full">Membaca file Excel...</p>}
        {canSupervise && (
          <Field label="Bagikan ke sales" full>
            <select className="pap-select" value={assigned} onChange={(e) => setAssigned(e.target.value)}>
              <option value="">Belum dibagikan</option>
              {salesUsers.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.division_name}</option>)}
            </select>
          </Field>
        )}
      </div>
      {rows.length > 0 && (
        <div className="pap-table-wrap pap-import-preview">
          <p className="pap-muted">{fileName}: {rows.length} prospek, {productCount} produk. Pratinjau 10 prospek pertama:</p>
          <table>
            <thead><tr><th>Nama Customer</th><th>Bidang Usaha</th><th>Nama Kontak PIC</th><th>Nomor WhatsApp</th><th>Payment</th><th>Produk</th></tr></thead>
            <tbody>{rows.slice(0, 10).map((r, i) => (
              <tr key={i}>
                <td>{r.nama_usaha}</td><td>{r.sektor || '—'}</td><td>{r.kontak_nama || '—'}</td><td>{r.telepon || '—'}</td><td>{r.payment || '—'}</td>
                <td>{r.products?.length ? <><strong>{r.products.length} produk</strong><div className="pap-cell-sub">{r.products.map((p) => [p.label, p.qty_kg && `${p.qty_kg} kg`, p.harga].filter(Boolean).join(' · ')).join('; ')}</div></> : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {batches.length > 0 && (
        <section className="pap-detail-section">
          <h3>Riwayat impor (30 hari)</h3>
          <p className="pap-muted">Salah impor? Batalkan lalu impor ulang file yang benar. Prospek yang dibatalkan masuk Data Terhapus.</p>
          <ul className="pap-file-list">
            {batches.map((b) => (
              <li key={b.batch}>
                <Upload />
                <div>
                  <strong>{formatDate(b.waktu, true)} · {b.jumlah} prospek</strong>
                  <span>{b.oleh} · {b.contoh}{b.jumlah > 3 ? ', ...' : ''}{b.aktivitas ? ` · ${b.aktivitas} follow-up/visit` : ''}</span>
                </div>
                <button type="button" className="pap-btn danger" disabled={!!undoing} onClick={() => undo(b)}>{undoing === b.batch ? 'Membatalkan...' : 'Batalkan impor'}</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Modal>
  )
}
