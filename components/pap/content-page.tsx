'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Download, ExternalLink, FileSpreadsheet, RefreshCw, Eye, Image as ImageIcon, LayoutList, Megaphone, Palette, Plus, Search, Trash2, Users } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { formatRupiah } from './accurate'
import { toInputDateTime } from './marketing'
import { DesignForm } from './request-page'
import { api, Field, formatDate, Modal, Notice, Pager, usePaged, confirmDialog } from './ui'

const PLATFORMS: Record<string, string> = { sosmed: 'Semua sosmed (IG/FB/TikTok)', instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', website: 'Website / blog', whatsapp: 'WhatsApp blast', marketplace: 'Marketplace', google: 'Google (Maps / Ads)', lainnya: 'Lainnya' }
const TYPES: Record<string, string> = { feed: 'Feed / post', reels: 'Reels / video pendek', story: 'Story', video: 'Video', artikel: 'Artikel', iklan: 'Iklan berbayar', blasting: 'Blasting pesan', lainnya: 'Lainnya' }
type Status = 'ide' | 'produksi' | 'siap' | 'tayang' | 'batal'
const STATUS: Record<Status, string> = { ide: 'Ide', produksi: 'Produksi desain', siap: 'Siap tayang', tayang: 'Sudah tayang', batal: 'Batal' }
const TONE: Record<Status, string> = { ide: 'neutral', produksi: 'warning', siap: 'info', tayang: 'success', batal: 'neutral' }

type Content = {
  id: number; judul: string; platform: string; jenis: string; jadwal_tayang: string; status: Status; tujuan: string | null; target_sektor: string | null
  caption: string | null; anggaran: number | null; link_hasil: string | null; reach: number | null; engagement: number | null; leads: number | null
  catatan: string | null; pic_id: number | null; pic_name: string | null; created_name: string; design_request_id: number | null; design_nomor: string | null
  design_status: string | null; final_file_id: number | null
}
type Summary = { total: number; tayang: number; disiapkan: number; reach: number; engagement: number; leads: number; anggaran: number }
type BankItem = { id: number; name: string; mime: string; size: number; design_id: number; nomor: string; judul: string; jenis_konten: string | null; approved_at: string; content_id: number | null; platform: string | null }

const DAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const pad = (n: number) => String(n).padStart(2, '0')
const shiftMonth = (ym: string, d: number) => {
  const x = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + d, 1)
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}`
}

export function ContentPage({ user }: { user: UserProfile }) {
  const [tab, setTab] = useState<'kalender' | 'daftar' | 'bank'>('kalender')
  const [bulan, setBulan] = useState('')
  const [items, setItems] = useState<Content[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [users, setUsers] = useState<{ id: number; name: string; division_name: string }[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState<Content | { jadwal: string } | null>(null)
  const [requestFor, setRequestFor] = useState<Content | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await api<{ bulan: string; items: Content[]; summary: Summary; users: typeof users; canEdit: boolean }>(`/api/content${bulan ? `?bulan=${bulan}` : ''}`)
      setBulan(res.bulan)
      setItems(res.items)
      setSummary(res.summary)
      setUsers(res.users)
      setCanEdit(res.canEdit)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [bulan])
  useEffect(() => { load() }, [load])
  const [warning, setWarning] = useState('')
  const flash = (t: string, w?: string | null) => { setMessage(t); setWarning(w ?? ''); setTimeout(() => setMessage(''), 5000); load() }

  // Grid kalender Senin-Minggu
  const cells = useMemo(() => {
    if (!bulan) return []
    const first = new Date(Number(bulan.slice(0, 4)), Number(bulan.slice(5, 7)) - 1, 1)
    const start = new Date(first)
    start.setDate(1 - ((first.getDay() + 6) % 7))
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      return { key, day: d.getDate(), inMonth: key.startsWith(bulan), list: items.filter((c) => c.jadwal_tayang.startsWith(key)) }
    })
  }, [bulan, items])
  const todayKey = (() => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` })()

  const pagedList = usePaged(items, items.length)
  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">MARKETING DIGITAL · TIM DESAIN</p>
          <h1>Kalender Konten</h1>
          <span>Rencana posting sosial media, iklan, dan blasting; request desain/video ke Tim Desain; hasil (reach, engagement, lead); dan bank konten.</span>
        </div>
        <div className="pap-inline-actions">
          <button className="pap-btn" onClick={() => setSheetOpen(true)}><FileSpreadsheet /> Google Sheet</button>
          {canEdit && <button className="pap-primary-button" onClick={() => setForm({ jadwal: `${todayKey}T10:00` })}><Plus /> Rencana konten</button>}
        </div>
      </div>
      {sheetOpen && <SheetSync onClose={() => setSheetOpen(false)} onImported={(t) => { setSheetOpen(false); flash(t) }} />}
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {warning && <Notice onClose={() => setWarning('')}>{warning}</Notice>}
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {summary && (
        <div className="pap-stat-grid four">
          <div className="pap-stat-card"><div><span>Konten bulan ini</span><strong>{summary.total}</strong><small className="neutral">{summary.tayang} tayang · {summary.disiapkan} disiapkan</small></div><div className="pap-stat-icon stat-1"><CalendarDays /></div></div>
          <div className="pap-stat-card"><div><span>Reach</span><strong>{summary.reach.toLocaleString('id-ID')}</strong><small className="neutral">{summary.engagement.toLocaleString('id-ID')} engagement</small></div><div className="pap-stat-icon stat-1"><Eye /></div></div>
          <div className="pap-stat-card"><div><span>Lead dari konten</span><strong>{summary.leads}</strong><small className="neutral">Dicatat manual per konten</small></div><div className="pap-stat-icon stat-0"><Users /></div></div>
          <div className="pap-stat-card"><div><span>Anggaran</span><strong>{formatRupiah(summary.anggaran)}</strong><small className="neutral">{summary.leads && summary.anggaran ? `${formatRupiah(summary.anggaran / summary.leads)} per lead` : 'Iklan & blasting'}</small></div><div className="pap-stat-icon stat-2"><Megaphone /></div></div>
        </div>
      )}
      <div className="pap-table-card">
        <div className="pap-calendar-bar pap-visit-bar">
          <div className="pap-calendar-nav">
            <button className="pap-icon-button" aria-label="Bulan sebelumnya" onClick={() => setBulan(shiftMonth(bulan, -1))} disabled={!bulan}><ChevronLeft /></button>
            <button className="pap-icon-button" aria-label="Bulan berikutnya" onClick={() => setBulan(shiftMonth(bulan, 1))} disabled={!bulan}><ChevronRight /></button>
            <h3>{bulan ? `${MONTHS[Number(bulan.slice(5, 7)) - 1]} ${bulan.slice(0, 4)}` : '...'}</h3>
          </div>
          <div className="pap-segmented" role="tablist">
            <button className={tab === 'kalender' ? 'active' : ''} onClick={() => setTab('kalender')}><CalendarDays /> Kalender</button>
            <button className={tab === 'daftar' ? 'active' : ''} onClick={() => setTab('daftar')}><LayoutList /> Daftar & hasil</button>
            <button className={tab === 'bank' ? 'active' : ''} onClick={() => setTab('bank')}><ImageIcon /> Bank konten</button>
          </div>
        </div>
        {tab === 'kalender' && (
          <div className="pap-content-cal">
            {DAYS.map((d) => <div key={d} className="pap-calendar-dayname">{d}</div>)}
            {cells.map((c) => (
              <div key={c.key} className={`pap-content-cell ${c.inMonth ? '' : 'outside'} ${c.key === todayKey ? 'today' : ''}`} onDoubleClick={() => canEdit && setForm({ jadwal: `${c.key}T10:00` })}>
                <span className="pap-calendar-date">{c.day}</span>
                {c.list.map((x) => (
                  <button key={x.id} className={`pap-content-chip ${x.status}`} onClick={() => setForm(x)} title={`${PLATFORMS[x.platform]} · ${STATUS[x.status]}`}>
                    <b>{x.jadwal_tayang.slice(11, 16)}</b> {x.judul}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
        {tab === 'daftar' && (
          <div className="pap-table-wrap">
            <table>
              <thead><tr><th>Jadwal</th><th>Konten</th><th>PIC</th><th>Desain</th><th className="pap-num">Reach</th><th className="pap-num">Eng.</th><th className="pap-num">Lead</th><th>Status</th></tr></thead>
              <tbody>
                {pagedList.items.map((x) => (
                  <tr key={x.id} className="pap-row-link" onClick={() => setForm(x)}>
                    <td>{formatDate(x.jadwal_tayang, true)}</td>
                    <td><div className="pap-cell-title">{x.judul}</div><div className="pap-cell-sub">{PLATFORMS[x.platform]} · {TYPES[x.jenis]}{x.target_sektor ? ` · ${x.target_sektor}` : ''}</div></td>
                    <td>{x.pic_name ?? '—'}</td>
                    <td>{x.design_nomor ? `${x.design_nomor} (${x.design_status})` : '—'}</td>
                    <td className="pap-num">{x.reach?.toLocaleString('id-ID') ?? '—'}</td>
                    <td className="pap-num">{x.engagement?.toLocaleString('id-ID') ?? '—'}</td>
                    <td className="pap-num">{x.leads ?? '—'}</td>
                    <td><span className={`pap-status ${TONE[x.status]}`}>{STATUS[x.status]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!items.length && <div className="pap-empty">Belum ada rencana konten bulan ini.</div>}
            <Pager {...pagedList.pager} noun="konten" />
          </div>
        )}
        {tab === 'bank' && <ContentBank />}
        {tab === 'kalender' && canEdit && <p className="pap-hint pap-content-hint">Klik dua kali tanggal untuk menambah rencana konten.</p>}
      </div>
      {form && (
        <ContentForm
          initial={'id' in form ? form : null}
          jadwal={'jadwal' in form ? form.jadwal : undefined}
          users={users}
          canEdit={canEdit}
          currentUserId={user.id}
          onClose={() => setForm(null)}
          onSaved={(t, w) => { setForm(null); flash(t, w) }}
          onRequestDesign={(c) => { setForm(null); setRequestFor(c) }}
        />
      )}
      {requestFor && (
        <DesignForm
          preset={{ judul: requestFor.judul, brief: [requestFor.caption && `Caption: ${requestFor.caption}`, requestFor.tujuan && `Tujuan: ${requestFor.tujuan}`, requestFor.target_sektor && `Target: ${requestFor.target_sektor}`, `Platform: ${PLATFORMS[requestFor.platform]} (${TYPES[requestFor.jenis]})`].filter(Boolean).join('\n'), deadline: requestFor.jadwal_tayang.slice(0, 10), jenis_konten: ['reels', 'video'].includes(requestFor.jenis) ? 'video' : 'gambar', content_plan_id: requestFor.id }}
          onClose={() => setRequestFor(null)}
          onSaved={(t) => { setRequestFor(null); flash(`${t} Rencana konten menjadi "Produksi desain".`) }}
        />
      )}
    </>
  )
}

function ContentForm({ initial, jadwal, users, canEdit, currentUserId, onClose, onSaved, onRequestDesign }: {
  initial: Content | null; jadwal?: string; users: { id: number; name: string; division_name: string }[]; canEdit: boolean; currentUserId: number
  onClose: () => void; onSaved: (m: string, warning?: string | null) => void; onRequestDesign: (c: Content) => void
}) {
  const [v, setV] = useState({
    judul: initial?.judul ?? '', platform: initial?.platform ?? 'instagram', jenis: initial?.jenis ?? 'feed', status: initial?.status ?? 'ide',
    jadwal_tayang: initial ? toInputDateTime(initial.jadwal_tayang) : jadwal ?? '', tujuan: initial?.tujuan ?? '', target_sektor: initial?.target_sektor ?? '',
    caption: initial?.caption ?? '', anggaran: initial?.anggaran?.toString() ?? '', link_hasil: initial?.link_hasil ?? '',
    reach: initial?.reach?.toString() ?? '', engagement: initial?.engagement?.toString() ?? '', leads: initial?.leads?.toString() ?? '',
    catatan: initial?.catatan ?? '', pic_id: String(initial?.pic_id ?? currentUserId),
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }))
  const dis = !canEdit
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const res = initial
        ? await api<{ warning?: string | null }>(`/api/content/${initial.id}`, { method: 'PATCH', json: v })
        : await api<{ warning?: string | null }>('/api/content', { method: 'POST', json: v })
      onSaved(initial ? 'Rencana konten diperbarui (juga di Google Sheet).' : 'Rencana konten ditambahkan (juga di Google Sheet).', res.warning)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }
  async function remove() {
    if (!initial || !(await confirmDialog(`Hapus rencana "${initial.judul}"?`))) return
    try {
      const res = await api<{ warning?: string | null }>(`/api/content/${initial.id}`, { method: 'DELETE' })
      onSaved('Rencana konten dihapus.', res.warning)
    } catch (err) {
      setError((err as Error).message)
    }
  }
  return (
    <Modal title={initial ? initial.judul : 'Rencana konten'} subtitle={initial ? `${PLATFORMS[initial.platform]} · ${STATUS[initial.status]} · dibuat ${initial.created_name}` : undefined} wide onClose={onClose}
      footer={<>
        {initial && canEdit && <button type="button" className="pap-btn danger" onClick={remove}><Trash2 /> Hapus</button>}
        <span className="pap-spacer" />
        {initial && canEdit && !initial.design_request_id && <button type="button" className="pap-btn" onClick={() => onRequestDesign(initial)}><Palette /> Request desain ke Tim Desain</button>}
        <button type="button" className="pap-btn" onClick={onClose}>Tutup</button>
        {canEdit && <button type="submit" form="content-form" className="pap-primary-button" disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</button>}
      </>}
    >
      <form id="content-form" className="pap-form-grid" onSubmit={submit}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        {initial?.design_nomor && <div className="full"><Notice kind="success">Desain {initial.design_nomor}: {initial.design_status}. {initial.final_file_id ? <a href={`/api/designs/files/${initial.final_file_id}`} target="_blank" rel="noreferrer">Lihat file final <ExternalLink className="pap-inline-icon" /></a> : 'Pantau di menu Request Desain.'}</Notice></div>}
        <Field label="Judul / ide konten" full><input className="pap-input" required disabled={dis} maxLength={255} value={v.judul} onChange={set('judul')} placeholder="Contoh: Tips memilih kantong laundry yang awet" /></Field>
        <Field label="Platform"><select className="pap-select" disabled={dis} value={v.platform} onChange={set('platform')}>{Object.entries(PLATFORMS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Jenis"><select className="pap-select" disabled={dis} value={v.jenis} onChange={set('jenis')}>{Object.entries(TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Jadwal tayang"><input className="pap-input" type="datetime-local" required disabled={dis} value={v.jadwal_tayang} onChange={set('jadwal_tayang')} /></Field>
        <Field label="Status"><select className="pap-select" disabled={dis} value={v.status} onChange={set('status')}>{Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Tujuan"><input className="pap-input" disabled={dis} maxLength={255} value={v.tujuan} onChange={set('tujuan')} placeholder="Awareness, edukasi, promo, cari lead" /></Field>
        <Field label="Target sektor"><input className="pap-input" disabled={dis} maxLength={255} value={v.target_sektor} onChange={set('target_sektor')} placeholder="Laundry, beras, F&B..." /></Field>
        <Field label="PIC"><select className="pap-select" disabled={dis} value={v.pic_id} onChange={set('pic_id')}>{users.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.division_name}</option>)}</select></Field>
        <Field label="Anggaran (Rp, opsional)"><input className="pap-input" inputMode="numeric" disabled={dis} value={v.anggaran} onChange={set('anggaran')} placeholder="Iklan / blasting" /></Field>
        <Field label="Caption / naskah" full><textarea className="pap-input" rows={4} disabled={dis} maxLength={10000} value={v.caption} onChange={set('caption')} /></Field>
        <div className="pap-field full pap-content-result">
          <span>Hasil setelah tayang</span>
          <div className="pap-calc-grid">
            <label><span>Link postingan</span><input className="pap-input" disabled={dis} maxLength={1000} value={v.link_hasil} onChange={set('link_hasil')} placeholder="https://instagram.com/p/..." /></label>
            <label><span>Reach</span><input className="pap-input" inputMode="numeric" disabled={dis} value={v.reach} onChange={set('reach')} /></label>
            <label><span>Engagement</span><input className="pap-input" inputMode="numeric" disabled={dis} value={v.engagement} onChange={set('engagement')} /></label>
            <label><span>Lead didapat</span><input className="pap-input" inputMode="numeric" disabled={dis} value={v.leads} onChange={set('leads')} /></label>
          </div>
          {v.link_hasil && /^https?:\/\//.test(v.link_hasil) && <a className="pap-link-button" href={v.link_hasil} target="_blank" rel="noreferrer">Buka postingan <ExternalLink className="pap-inline-icon" /></a>}
        </div>
        <Field label="Catatan" full><textarea className="pap-input" rows={2} disabled={dis} maxLength={5000} value={v.catatan} onChange={set('catatan')} /></Field>
      </form>
    </Modal>
  )
}

function ContentBank() {
  const [items, setItems] = useState<BankItem[] | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => api<{ items: BankItem[] }>(`/api/content/bank${q ? `?q=${encodeURIComponent(q)}` : ''}`).then((r) => setItems(r.items)).catch(() => setItems([])), q ? 300 : 0)
    return () => clearTimeout(t)
  }, [q])
  return (
    <div className="pap-content-bank">
      <div className="pap-filters"><label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari judul / nama file..." /></label></div>
      <div className="pap-design-grid">
        {(items ?? []).map((f) => (
          <a key={f.id} className="pap-design-card" href={`/api/designs/files/${f.id}`} target="_blank" rel="noreferrer">
            <div className="pap-design-thumb">
              {f.mime.startsWith('image/') ? <img src={`/api/designs/files/${f.id}`} alt={f.name} loading="lazy" /> : <div className="pap-design-noprev"><ImageIcon /><b>{f.name.split('.').pop()?.toUpperCase()}</b></div>}
            </div>
            <div className="pap-design-info">
              <strong>{f.judul}</strong>
              <small>{f.nomor} · {f.jenis_konten ?? 'konten'} · {formatDate(f.approved_at)}</small>
              <small><Download className="pap-inline-icon" /> {f.name}</small>
            </div>
          </a>
        ))}
      </div>
      {items && !items.length && <div className="pap-empty">Belum ada konten final. Konten masuk ke sini setelah request konten disetujui.</div>}
      {!items && <div className="pap-empty">Memuat...</div>}
    </div>
  )
}

// ---------------- Sinkron dari Google Sheet "konten planning" ----------------
type SheetPreview = {
  url: string; account: string | null; canEdit: boolean
  tabs: { title: string; header: string[] | null; mapped: Record<string, string>; rows: number; skipped: number }[]
  plans: { key: string; ref: string; jadwal_tayang: string; judul: string; platform: string; jenis: string; status: Status; baru: boolean }[]
}
const FIELD_LABEL: Record<string, string> = {
  tanggal: 'Tanggal', jam: 'Jam', judul: 'Judul / topik', platform: 'Platform', jenis: 'Jenis', caption: 'Caption', status: 'Status',
  tujuan: 'Tujuan', target_sektor: 'Target sektor', link_hasil: 'Link', pic: 'PIC', catatan: 'Catatan',
}

function SheetSync({ onClose, onImported }: { onClose: () => void; onImported: (message: string) => void }) {
  const [data, setData] = useState<SheetPreview | null>(null)
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const preview = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api<SheetPreview>('/api/content/sheet')
      setData(res)
      setUrl(res.url)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { preview() }, [preview])

  async function saveUrl() {
    setBusy(true)
    setError('')
    try {
      await api('/api/content/sheet', { method: 'PUT', json: { url } })
      await preview()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function importAll() {
    setBusy(true)
    setError('')
    try {
      const res = await api<{ created: number; updated: number }>('/api/content/sheet', { method: 'POST' })
      onImported(`Sinkron Google Sheet selesai: ${res.created} konten baru, ${res.updated} diperbarui.`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const baru = data?.plans.filter((p) => p.baru).length ?? 0
  const canEdit = data?.canEdit ?? false

  return (
    <Modal
      title="Sinkron dari Google Sheet"
      subtitle={data?.account ? `Dibaca dengan akun Google ${data.account} (sama dengan Master Data > Logo & Desain)` : 'Memakai akun Google yang terhubung di Master Data > Logo & Desain'}
      wide
      onClose={onClose}
      footer={<><button className="pap-btn" disabled={loading || busy} onClick={preview}><RefreshCw /> Muat ulang</button><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Tutup</button>{canEdit && <button className="pap-primary-button" disabled={busy || loading || !data?.plans.length} onClick={importAll}>{busy ? 'Menyinkron...' : `Impor ${data?.plans.length ?? 0} konten`}</button>}</>}
    >
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <Field label="Link Google Sheet konten planning">
        <div className="pap-inline-actions">
          <input className="pap-input" value={url} disabled={!canEdit} onChange={(e) => setUrl(e.target.value)} />
          {url && <a className="pap-icon-button" href={url} target="_blank" rel="noreferrer" aria-label="Buka Google Sheet"><ExternalLink /></a>}
          {canEdit && data && url !== data.url && <button className="pap-btn" disabled={busy} onClick={saveUrl}>Simpan link</button>}
        </div>
      </Field>
      <p className="pap-muted">Spreadsheet harus bisa dibuka akun Google tersebut (bagikan sebagai Viewer). Baris dengan tanggal &amp; judul diimpor; sinkron ulang memperbarui konten yang sama (tanggal + judul + platform), hasil reach/lead yang dicatat di aplikasi tidak tertimpa.</p>
      {loading ? <p className="pap-muted">Membaca Google Sheet...</p> : data && (
        <>
          {data.tabs.map((t) => (
            <div key={t.title} className="pap-inline-panel">
              <strong>Tab “{t.title}”: {t.header ? `${t.rows} baris konten${t.skipped ? `, ${t.skipped} dilewati (tanpa tanggal / judul)` : ''}` : 'tidak ada kolom tanggal & judul, dilewati'}</strong>
              {t.header && <p className="pap-muted">{Object.entries(t.mapped).map(([f, h]) => `${FIELD_LABEL[f] ?? f} ← “${h}”`).join(' · ')}</p>}
            </div>
          ))}
          {data.plans.length > 0 && (
            <div className="pap-table-wrap">
              <table>
                <thead><tr><th>Jadwal</th><th>Konten</th><th>Platform</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {data.plans.slice(0, 300).map((p) => (
                    <tr key={p.key}>
                      <td>{formatDate(p.jadwal_tayang, true)}</td>
                      <td><div className="pap-cell-title">{p.judul}</div><div className="pap-cell-sub">{TYPES[p.jenis] ?? p.jenis} · {p.ref}</div></td>
                      <td>{PLATFORMS[p.platform] ?? p.platform}</td>
                      <td>{STATUS[p.status]}</td>
                      <td><span className={`pap-status ${p.baru ? 'info' : 'neutral'}`}>{p.baru ? 'Baru' : 'Diperbarui'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.plans.length > 300 && <p className="pap-muted">… dan {data.plans.length - 300} konten lainnya.</p>}
            </div>
          )}
          {!data.plans.length && <div className="pap-empty">Belum ada baris yang dikenali sebagai konten.</div>}
          {data.plans.length > 0 && <p className="pap-muted">{baru} konten baru, {data.plans.length - baru} sudah ada dan akan diperbarui.</p>}
        </>
      )}
    </Modal>
  )
}
