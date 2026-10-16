'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, CheckCircle2, Crosshair, Download, ExternalLink, FileText, Link2, MapPin, MessageCircle, Paperclip, Pencil, Plus, Trash2, X, XCircle } from 'lucide-react'
import { CustomerSelect, type CustomerOption } from './product-page'
import { api, Field, formatDate, formatSize, Modal, Notice } from './ui'

// ---- Konstanta bersama halaman Prospek & Jadwal Visit ----
export type ProspectStatus = 'baru' | 'dihubungi' | 'janji_temu' | 'visit' | 'penawaran' | 'order_pertama' | 'handover' | 'gagal'
export const PROSPECT_LABEL: Record<ProspectStatus, string> = {
  baru: 'Lead baru',
  dihubungi: 'Dihubungi',
  janji_temu: 'Janji temu',
  visit: 'Sudah visit',
  penawaran: 'Penawaran',
  order_pertama: 'Order pertama',
  handover: 'Handover',
  gagal: 'Gagal',
}
export const PROSPECT_TONE: Record<ProspectStatus, string> = { baru: 'neutral', dihubungi: 'info', janji_temu: 'info', visit: 'info', penawaran: 'warning', order_pertama: 'success', handover: 'success', gagal: 'danger' }
export const PIPELINE: ProspectStatus[] = ['baru', 'dihubungi', 'janji_temu', 'visit', 'penawaran', 'order_pertama', 'handover']
export const ProspectBadge = ({ value }: { value: ProspectStatus }) => <span className={`pap-status ${PROSPECT_TONE[value]}`}>{PROSPECT_LABEL[value]}</span>

export type VisitStatus = 'terjadwal' | 'selesai' | 'tidak_bertemu' | 'batal'
export const VISIT_LABEL: Record<VisitStatus, string> = { terjadwal: 'Terjadwal', selesai: 'Selesai', tidak_bertemu: 'Tidak bertemu', batal: 'Batal' }
export const VISIT_TONE: Record<VisitStatus, string> = { terjadwal: 'info', selesai: 'success', tidak_bertemu: 'warning', batal: 'neutral' }
export const VISIT_TYPE_LABEL = { visit: 'Visit lokasi', janji_temu: 'Janji temu di kantor', online: 'Meeting online' } as const
export type VisitType = keyof typeof VISIT_TYPE_LABEL
export const VisitBadge = ({ value }: { value: VisitStatus }) => <span className={`pap-status ${VISIT_TONE[value]}`}>{VISIT_LABEL[value]}</span>

export type MarketingUser = { id: number; name: string; division_code: string; division_name: string }

export type Visit = {
  id: number
  prospect_id: number | null
  customer_id: number | null
  sales_id: number
  jenis: VisitType
  jadwal: string
  tujuan: string | null
  alamat: string | null
  status: VisitStatus
  checkin_at: string | null
  checkin_lat: number | null
  checkin_lng: number | null
  checkin_accuracy: number | null
  has_foto: boolean
  hasil: string | null
  next_followup_at: string | null
  created_by: number
  sales_name: string
  sales_ids: number[]
  created_name: string
  target_name: string | null
  target_phone: string | null
  kontak_nama: string | null
  prospect_status: ProspectStatus | null
  customer_no: string | null
}

// "2026-10-15 09:30:00" <-> nilai <input type="datetime-local">
export const toInputDateTime = (value: string | null | undefined) => (value ? value.slice(0, 16).replace(' ', 'T') : '')
export const nowInput = (addDays = 0, hour?: number) => {
  const d = new Date(Date.now() + addDays * 864e5)
  if (hour !== undefined) d.setHours(hour, 0, 0, 0)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
export const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Tautan WhatsApp (nomor sudah dinormalisasi 62xxx di server)
export const waLink = (phone: string | null | undefined, text = '') => (phone ? `https://wa.me/${phone.replace(/\D/g, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}` : null)
export const mapsLink = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`
export const mapsSearch = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`

export function WaButton({ phone, text, label = 'WhatsApp' }: { phone: string | null | undefined; text?: string; label?: string }) {
  const href = waLink(phone, text)
  if (!href) return null
  return <a className="pap-btn pap-wa" href={href} target="_blank" rel="noreferrer"><MessageCircle /> {label}</a>
}

// ---- Pilih prospek (pencarian) ----
export type ProspectOption = { id: number; nama_usaha: string; kota: string | null; kontak_nama: string | null; alamat: string | null; status: ProspectStatus }
export function ProspectSelect({ value, onChange }: { value: ProspectOption | null; onChange: (p: ProspectOption) => void }) {
  const [term, setTerm] = useState('')
  const [options, setOptions] = useState<ProspectOption[]>([])
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      api<{ items: ProspectOption[] }>(`/api/prospects?status=aktif&q=${encodeURIComponent(term)}`).then((res) => setOptions(res.items)).catch(() => {})
    }, 250)
    return () => clearTimeout(timer)
  }, [term, open])
  return (
    <div className="pap-combo">
      <input
        className="pap-input"
        value={open ? term : value ? value.nama_usaha : ''}
        placeholder="Ketik nama usaha prospek..."
        onFocus={() => { setOpen(true); setTerm('') }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => setTerm(e.target.value)}
        required={!value}
      />
      {open && (
        <ul className="pap-combo-list">
          {options.map((p) => (
            <li key={p.id}><button type="button" onMouseDown={() => { onChange(p); setOpen(false) }}><strong>{p.nama_usaha}</strong><small>{[p.kontak_nama, p.kota, PROSPECT_LABEL[p.status]].filter(Boolean).join(' · ')}</small></button></li>
          ))}
          {!options.length && <li className="pap-combo-empty">Prospek aktif tidak ditemukan.</li>}
        </ul>
      )}
    </div>
  )
}

// Pilih beberapa sales (chip). lockedId = user login yang wajib ikut (staff).
function SalesPicker({ users, selected, lockedId, onChange }: { users: MarketingUser[]; selected: number[]; lockedId: number | null; onChange: (ids: number[]) => void }) {
  const [adding, setAdding] = useState('')
  const name = (id: number) => users.find((u) => u.id === id)?.name ?? `User #${id}`
  const ids = lockedId && !selected.includes(lockedId) ? [lockedId, ...selected] : selected
  return (
    <div className="pap-sales-picker">
      <div className="pap-need-chips">
        {ids.map((id, i) => (
          <span key={id} className="pap-need-chip">{i === 0 ? '★ ' : ''}{name(id)}{id !== lockedId && <button type="button" aria-label={`Hapus ${name(id)}`} onClick={() => onChange(ids.filter((x) => x !== id))}>×</button>}</span>
        ))}
        {!ids.length && <span className="pap-muted">Belum ada sales dipilih.</span>}
      </div>
      <select className="pap-select" value={adding} onChange={(e) => { const id = Number(e.target.value); if (id && !ids.includes(id)) onChange([...ids, id]); setAdding('') }} aria-label="Tambah sales">
        <option value="">+ Tambah sales...</option>
        {users.filter((u) => !ids.includes(u.id)).map((u) => <option key={u.id} value={u.id}>{u.name} · {u.division_name}</option>)}
      </select>
    </div>
  )
}

// ---- Form jadwal visit (baru / jadwal ulang) ----
export function VisitForm({ initial, prospect, users, canSupervise, currentUserId, onClose, onSaved }: {
  initial?: Visit | null
  prospect?: { id: number; nama_usaha: string; alamat: string | null; kota: string | null; assigned_to?: number | null } | null
  users: MarketingUser[]
  canSupervise: boolean
  currentUserId: number
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [target, setTarget] = useState<'prospek' | 'customer'>(initial?.customer_id ? 'customer' : 'prospek')
  const [pickedProspect, setPickedProspect] = useState<ProspectOption | null>(prospect ? { id: prospect.id, nama_usaha: prospect.nama_usaha, kota: prospect.kota, alamat: prospect.alamat, kontak_nama: null, status: 'baru' } : null)
  const [pickedCustomer, setPickedCustomer] = useState<CustomerOption | null>(null)
  const [values, setValues] = useState({
    jenis: initial?.jenis ?? 'visit',
    jadwal: initial ? toInputDateTime(initial.jadwal) : nowInput(1, 10),
    tujuan: initial?.tujuan ?? '',
    alamat: initial?.alamat ?? (prospect ? [prospect.alamat, prospect.kota].filter(Boolean).join(', ') : ''),
    // Default: sales prospek, lalu user yang login bila ia termasuk daftar sales; selain itu wajib dipilih
  })
  // Sales yang ikut (bisa lebih dari satu). Default: sales visit lama / sales prospek / user login bila ia sales
  const [salesIds, setSalesIds] = useState<number[]>(() => {
    if (initial) return initial.sales_ids
    const first = prospect?.assigned_to ?? (users.some((u) => u.id === currentUserId) ? currentUserId : null)
    return first ? [first] : []
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (key: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (!salesIds.length) throw new Error('Pilih minimal satu sales.')
      if (initial) {
        await api(`/api/visits/${initial.id}`, { method: 'PATCH', json: { ...values, sales_ids: salesIds } })
        onSaved('Jadwal visit diperbarui.')
      } else {
        if (target === 'prospek' && !pickedProspect) throw new Error('Pilih prospek yang dikunjungi.')
        if (target === 'customer' && !pickedCustomer) throw new Error('Pilih customer yang dikunjungi.')
        await api('/api/visits', { method: 'POST', json: { ...values, sales_ids: salesIds, prospect_id: target === 'prospek' ? pickedProspect!.id : null, customer_id: target === 'customer' ? pickedCustomer!.id : null } })
        onSaved('Visit dijadwalkan.')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={initial ? 'Jadwal ulang visit' : 'Jadwalkan visit'}
      subtitle={initial?.target_name ?? prospect?.nama_usaha}
      onClose={onClose}
      footer={<><span className="pap-spacer" /><button type="button" className="pap-btn" onClick={onClose}>Batal</button><button type="submit" form="visit-form" className="pap-primary-button" disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</button></>}
    >
      <form id="visit-form" className="pap-form-grid" onSubmit={submit}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        {!initial && !prospect && (
          <>
            <Field label="Yang dikunjungi" full>
              <div className="pap-segmented">
                <button type="button" className={target === 'prospek' ? 'active' : ''} onClick={() => setTarget('prospek')}>Prospek</button>
                <button type="button" className={target === 'customer' ? 'active' : ''} onClick={() => setTarget('customer')}>Customer (maintenance)</button>
              </div>
            </Field>
            <Field label={target === 'prospek' ? 'Prospek' : 'Customer'} full>
              {target === 'prospek'
                ? <ProspectSelect value={pickedProspect} onChange={(p) => { setPickedProspect(p); setValues((v) => ({ ...v, alamat: v.alamat || [p.alamat, p.kota].filter(Boolean).join(', ') })) }} />
                : <CustomerSelect value={pickedCustomer} onChange={(c) => { setPickedCustomer(c); setValues((v) => ({ ...v, alamat: v.alamat || c.bill_city || '' })) }} />}
            </Field>
          </>
        )}
        <Field label="Jenis">
          <select className="pap-select" value={values.jenis} onChange={set('jenis')}>{Object.entries(VISIT_TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </Field>
        <Field label="Jadwal"><input className="pap-input" type="datetime-local" required value={values.jadwal} onChange={set('jadwal')} /></Field>
        <div className="pap-field full">
          <span>Sales yang ikut visit</span>
          <SalesPicker users={users} selected={salesIds} lockedId={canSupervise ? null : currentUserId} onChange={setSalesIds} />
          <small>Bisa lebih dari satu. Sales pertama menjadi PIC utama; semua sales mendapat pengingat dan bisa check-in.</small>
        </div>
        <Field label="Alamat / lokasi" full hint="Dipakai untuk membuka Google Maps menuju lokasi."><input className="pap-input" maxLength={500} value={values.alamat} onChange={set('alamat')} /></Field>
        <Field label="Tujuan visit" full><textarea className="pap-input" rows={2} maxLength={500} value={values.tujuan} onChange={set('tujuan')} placeholder="Contoh: presentasi produk & bawa sampel kantong HD" /></Field>
      </form>
    </Modal>
  )
}

// Kompres foto kamera di browser: sisi terpanjang 1280px, JPEG kualitas 0,7 (±150–400 KB)
async function compressPhoto(file: File) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Foto tidak dapat dibaca. Coba ambil ulang.'))
      el.src = url
    })
    const scale = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * scale)
    canvas.height = Math.round(img.naturalHeight * scale)
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.7)
  } finally {
    URL.revokeObjectURL(url)
  }
}

// ---- Lampiran laporan visit: link & file ----
export const VISIT_FILE_ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx'
type PendingLink = { url: string; name: string }
type VisitAttachment = { id: number; kind: 'file' | 'link'; name: string; url: string | null; mime: string | null; size: number | null; uploaded_by: number; created_at: string; uploaded_by_name: string }

const normalizeUrl = (value: string) => (/^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`)

// Isian link + file yang belum dikirim (dipakai di form check-in)
function AttachmentEditor({ links, files, onLinks, onFiles }: { links: PendingLink[]; files: File[]; onLinks: (l: PendingLink[]) => void; onFiles: (f: File[]) => void }) {
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const addLink = () => {
    if (!url.trim()) return
    onLinks([...links, { url: normalizeUrl(url), name: name.trim() }])
    setUrl('')
    setName('')
  }
  return (
    <div className="pap-attach-editor">
      <div className="pap-attach-row">
        <input className="pap-input" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Tempel link (Google Drive, katalog, foto, dll.)" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLink() } }} />
        <input className="pap-input" value={name} maxLength={255} onChange={(e) => setName(e.target.value)} placeholder="Judul link (opsional)" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLink() } }} />
        <button type="button" className="pap-btn" disabled={!url.trim()} onClick={addLink}><Link2 /> Tambah link</button>
      </div>
      <div className="pap-attach-row">
        <button type="button" className="pap-btn" onClick={() => fileRef.current?.click()}><Paperclip /> Tambah file</button>
        <small className="pap-muted">PDF, gambar, Word, Excel, PowerPoint. Maks 4 MB per file.</small>
        <input ref={fileRef} type="file" multiple hidden accept={VISIT_FILE_ACCEPT} onChange={(e) => { onFiles([...files, ...(e.target.files ?? [])]); e.target.value = '' }} />
      </div>
      {(links.length > 0 || files.length > 0) && (
        <ul className="pap-attach-pending">
          {links.map((l, i) => <li key={`l${i}`}><Link2 /><span>{l.name || l.url}</span><button type="button" aria-label="Hapus link" onClick={() => onLinks(links.filter((_, j) => j !== i))}><X /></button></li>)}
          {files.map((f, i) => <li key={`f${i}`} className={f.size > 4 * 1024 * 1024 ? 'too-big' : ''}><FileText /><span>{f.name} · {formatSize(f.size)}{f.size > 4 * 1024 * 1024 ? ' · terlalu besar' : ''}</span><button type="button" aria-label="Hapus file" onClick={() => onFiles(files.filter((_, j) => j !== i))}><X /></button></li>)}
        </ul>
      )}
    </div>
  )
}

async function uploadVisitFile(visitId: number, file: File) {
  const form = new FormData()
  form.append('file', file)
  await api(`/api/visits/${visitId}/attachments`, { method: 'POST', body: form })
}

// Daftar lampiran di detail visit + tambah link/file setelah check-in
function VisitAttachments({ visitId, canAdd, currentUserId, isAdmin }: { visitId: number; canAdd: boolean; currentUserId: number; isAdmin: boolean }) {
  const [items, setItems] = useState<VisitAttachment[]>([])
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [url, setUrl] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const load = useCallback(() => {
    api<{ items: VisitAttachment[] }>(`/api/visits/${visitId}/attachments`).then((r) => setItems(r.items)).catch((e) => setError(e.message))
  }, [visitId])
  useEffect(load, [load])
  async function run(task: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    try {
      await task()
      load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const addLink = () => run(async () => {
    const form = new FormData()
    form.append('url', normalizeUrl(url))
    form.append('log', '1')
    await api(`/api/visits/${visitId}/attachments`, { method: 'POST', body: form })
    setUrl('')
    setAdding(false)
  })
  if (!items.length && !canAdd) return null
  return (
    <section className="pap-detail-section">
      <div className="pap-section-head">
        <h3>Lampiran laporan ({items.length})</h3>
        {canAdd && (
          <div className="pap-inline-actions">
            <button className="pap-btn" disabled={busy} onClick={() => setAdding((v) => !v)}><Plus /> Link</button>
            <button className="pap-btn" disabled={busy} onClick={() => fileRef.current?.click()}><Paperclip /> File</button>
            <input ref={fileRef} type="file" multiple hidden accept={VISIT_FILE_ACCEPT} onChange={(e) => { const list = [...(e.target.files ?? [])]; e.target.value = ''; run(async () => { for (const f of list) await uploadVisitFile(visitId, f) }) }} />
          </div>
        )}
      </div>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {adding && (
        <div className="pap-attach-row">
          <input className="pap-input" inputMode="url" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Tempel link" onKeyDown={(e) => { if (e.key === 'Enter' && url.trim()) addLink() }} />
          <button className="pap-primary-button" disabled={busy || !url.trim()} onClick={addLink}>Simpan link</button>
        </div>
      )}
      <ul className="pap-file-list">
        {items.map((a) => (
          <li key={a.id}>
            {a.kind === 'link' ? <Link2 /> : <FileText />}
            <div>
              <a href={a.kind === 'link' ? a.url! : `/api/visits/attachments/${a.id}`} target="_blank" rel="noreferrer">{a.name}</a>
              <span>{a.kind === 'link' ? a.url : formatSize(a.size)} · {a.uploaded_by_name} · {formatDate(a.created_at, true)}</span>
            </div>
            {a.kind === 'file' && <a className="pap-icon-button" href={`/api/visits/attachments/${a.id}?download=1`} aria-label={`Unduh ${a.name}`}><Download /></a>}
            {(a.uploaded_by === currentUserId || isAdmin) && <button className="pap-icon-button" aria-label={`Hapus ${a.name}`} onClick={() => window.confirm(`Hapus lampiran ${a.name}?`) && run(() => api(`/api/visits/attachments/${a.id}`, { method: 'DELETE' }))}><Trash2 /></button>}
          </li>
        ))}
      </ul>
      {!items.length && <p className="pap-muted">Belum ada lampiran.</p>}
    </section>
  )
}

type GeoState = { status: 'idle' | 'loading' | 'ok' | 'error'; lat?: number; lng?: number; accuracy?: number; message?: string }

// ---- Check-in di lokasi: GPS + foto + laporan hasil ----
export function CheckinForm({ visit, onClose, onSaved }: { visit: Visit; onClose: () => void; onSaved: (message: string) => void }) {
  const needsProof = visit.jenis === 'visit'
  const [geo, setGeo] = useState<GeoState>({ status: 'idle' })
  const [photo, setPhoto] = useState('')
  const [values, setValues] = useState({ status: 'selesai', hasil: '', prospect_status: '', next_followup_at: nowInput(3, 10) })
  const [links, setLinks] = useState<PendingLink[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const set = (key: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }))

  function locate() {
    if (!navigator.geolocation) return setGeo({ status: 'error', message: 'Browser tidak mendukung lokasi GPS.' })
    setGeo({ status: 'loading' })
    navigator.geolocation.getCurrentPosition(
      (pos) => setGeo({ status: 'ok', lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => setGeo({ status: 'error', message: err.code === err.PERMISSION_DENIED ? 'Akses lokasi ditolak. Izinkan lokasi untuk situs ini di pengaturan browser, lalu coba lagi.' : 'Lokasi tidak didapat. Pastikan GPS aktif lalu coba lagi.' }),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    )
  }
  useEffect(() => { if (needsProof) locate() }, [needsProof])

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      setPhoto(await compressPhoto(file))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (!values.hasil.trim() && !links.length && !files.length) throw new Error('Isi laporan hasil kunjungan: catatan, link, atau file.')
      const tooBig = files.find((f) => f.size > 4 * 1024 * 1024)
      if (tooBig) throw new Error(`${tooBig.name} lebih dari 4 MB. Kompres dulu atau kirim sebagai link Google Drive.`)
      await api(`/api/visits/${visit.id}/checkin`, { method: 'POST', json: { ...values, lat: geo.lat, lng: geo.lng, accuracy: geo.accuracy, foto: photo || undefined, links, file_count: files.length } })
      // File diunggah satu per satu setelah check-in tersimpan (batas ukuran request)
      const failed: string[] = []
      for (const file of files) await uploadVisitFile(visit.id, file).catch((err: Error) => failed.push(err.message))
      onSaved(failed.length ? `Check-in tersimpan, tetapi ${failed.length} file gagal diunggah (${failed.join('; ')}). Tambahkan lagi dari detail visit.` : 'Check-in & laporan visit tersimpan.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="Check-in & laporan visit"
      subtitle={`${visit.target_name ?? ''} · ${formatDate(visit.jadwal, true)}`}
      onClose={onClose}
      footer={<><span className="pap-spacer" /><button type="button" className="pap-btn" onClick={onClose}>Batal</button><button type="submit" form="checkin-form" className="pap-primary-button" disabled={saving || (needsProof && (geo.status !== 'ok' || !photo))}>{saving ? 'Menyimpan...' : 'Simpan check-in'}</button></>}
    >
      <form id="checkin-form" className="pap-form-grid" onSubmit={submit}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <div className="full pap-checkin-proof">
          <div className={`pap-checkin-box ${geo.status}`}>
            <Crosshair />
            <div>
              <strong>Lokasi GPS{needsProof ? '' : ' (opsional)'}</strong>
              {geo.status === 'ok' && <span>{geo.lat!.toFixed(6)}, {geo.lng!.toFixed(6)} · akurasi ±{Math.round(geo.accuracy!)} m · <a href={mapsLink(geo.lat!, geo.lng!)} target="_blank" rel="noreferrer">lihat peta</a></span>}
              {geo.status === 'loading' && <span>Mencari lokasi...</span>}
              {geo.status === 'error' && <span className="pap-text-danger">{geo.message}</span>}
              {geo.status === 'idle' && <span>Belum diambil.</span>}
            </div>
            <button type="button" className="pap-btn" onClick={locate} disabled={geo.status === 'loading'}>{geo.status === 'ok' ? 'Perbarui' : 'Ambil lokasi'}</button>
          </div>
          <div className={`pap-checkin-box ${photo ? 'ok' : ''}`}>
            <Camera />
            <div>
              <strong>Foto bukti kunjungan{needsProof ? '' : ' (opsional)'}</strong>
              <span>{photo ? 'Foto siap dikirim.' : 'Foto di lokasi (tampak depan / bersama PIC).'}</span>
            </div>
            <button type="button" className="pap-btn" onClick={() => fileRef.current?.click()}>{photo ? 'Ambil ulang' : 'Ambil foto'}</button>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />
          </div>
          {photo && <img className="pap-checkin-photo" src={photo} alt="Pratinjau foto visit" />}
        </div>
        <Field label="Hasil">
          <select className="pap-select" value={values.status} onChange={set('status')}>
            <option value="selesai">Bertemu / selesai</option>
            <option value="tidak_bertemu">Tidak bertemu</option>
          </select>
        </Field>
        {visit.prospect_id ? (
          <Field label="Status prospek setelah visit">
            <select className="pap-select" value={values.prospect_status} onChange={set('prospect_status')}>
              <option value="">Otomatis (Sudah visit)</option>
              {PIPELINE.map((s) => <option key={s} value={s}>{PROSPECT_LABEL[s]}</option>)}
            </select>
          </Field>
        ) : <span />}
        <Field label="Catatan hasil kunjungan" full hint="Isi catatan, link, atau file — minimal salah satu."><textarea className="pap-input" rows={3} maxLength={5000} value={values.hasil} onChange={set('hasil')} placeholder="Siapa yang ditemui, kebutuhan, respon, sampel yang diberikan, rencana selanjutnya..." /></Field>
        <div className="pap-field full">
          <span>Lampiran laporan (link / file)</span>
          <AttachmentEditor links={links} files={files} onLinks={setLinks} onFiles={setFiles} />
        </div>
        <Field label="Follow-up berikutnya (opsional)" full><input className="pap-input" type="datetime-local" value={values.next_followup_at} onChange={set('next_followup_at')} /></Field>
      </form>
    </Modal>
  )
}

// ---- Detail visit ----
export function VisitDetail({ visit, currentUserId, canSupervise, isAdmin, onClose, onCheckin, onEdit, onChanged, onOpenProspect }: {
  visit: Visit
  currentUserId: number
  canSupervise: boolean
  isAdmin: boolean
  onClose: () => void
  onCheckin: () => void
  onEdit: () => void
  onChanged: (message: string) => void
  onOpenProspect?: (id: number) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const isSales = visit.sales_ids.includes(currentUserId)
  const canCheckin = visit.status === 'terjadwal' && (isSales || isAdmin)
  const canChange = visit.status === 'terjadwal' && (canSupervise || isSales || visit.created_by === currentUserId)

  async function cancel() {
    const alasan = window.prompt('Alasan pembatalan visit (opsional):')
    if (alasan === null) return
    setBusy(true)
    try {
      await api(`/api/visits/${visit.id}`, { method: 'PATCH', json: { status: 'batal', alasan } })
      onChanged('Visit dibatalkan.')
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }
  async function remove() {
    if (!window.confirm('Hapus jadwal visit ini?')) return
    setBusy(true)
    try {
      await api(`/api/visits/${visit.id}`, { method: 'DELETE' })
      onChanged('Jadwal visit dihapus.')
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal
      title={visit.target_name ?? 'Visit'}
      subtitle={`${VISIT_TYPE_LABEL[visit.jenis]} · ${formatDate(visit.jadwal, true)}`}
      onClose={onClose}
      footer={<>
        {canChange && <button type="button" className="pap-btn danger" disabled={busy} onClick={cancel}><XCircle /> Batalkan</button>}
        {!visit.checkin_at && (canSupervise || visit.created_by === currentUserId) && <button type="button" className="pap-btn danger" disabled={busy} onClick={remove}><Trash2 /> Hapus</button>}
        <span className="pap-spacer" />
        {canChange && <button type="button" className="pap-btn" onClick={onEdit}><Pencil /> Jadwal ulang</button>}
        {canCheckin && <button type="button" className="pap-primary-button" onClick={onCheckin}><CheckCircle2 /> Check-in</button>}
      </>}
    >
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-detail-badges"><VisitBadge value={visit.status} />{visit.prospect_status && <ProspectBadge value={visit.prospect_status} />}{visit.customer_no && <span className="pap-status neutral">Customer {visit.customer_no}</span>}</div>
      <dl className="pap-detail-grid">
        <div><dt>Sales</dt><dd>{visit.sales_name}</dd></div>
        <div><dt>Kontak</dt><dd>{visit.kontak_nama ?? '—'}</dd></div>
        <div><dt>Alamat</dt><dd>{visit.alamat ? <a href={mapsSearch(visit.alamat)} target="_blank" rel="noreferrer">{visit.alamat} <ExternalLink className="pap-inline-icon" /></a> : '—'}</dd></div>
        <div><dt>Dijadwalkan oleh</dt><dd>{visit.created_name}</dd></div>
        {visit.tujuan && <div className="full"><dt>Tujuan</dt><dd className="pap-prewrap">{visit.tujuan}</dd></div>}
      </dl>
      <div className="pap-inline-actions">
        <WaButton phone={visit.target_phone} text={`Halo${visit.kontak_nama ? ` ${visit.kontak_nama}` : ''}, saya dari PT Pandawa Amerta Packindo ingin konfirmasi jadwal kunjungan ${formatDate(visit.jadwal, true)}.`} label="Konfirmasi via WA" />
        {visit.prospect_id && onOpenProspect && <button className="pap-btn" onClick={() => onOpenProspect(visit.prospect_id!)}>Buka prospek</button>}
      </div>
      {visit.checkin_at && (
        <section className="pap-detail-section">
          <h3>Laporan check-in</h3>
          <dl className="pap-detail-grid">
            <div><dt>Waktu check-in</dt><dd>{formatDate(visit.checkin_at, true)}</dd></div>
            <div><dt>Lokasi</dt><dd>{visit.checkin_lat !== null ? <a href={mapsLink(visit.checkin_lat, visit.checkin_lng!)} target="_blank" rel="noreferrer"><MapPin className="pap-inline-icon" /> {visit.checkin_lat.toFixed(5)}, {visit.checkin_lng!.toFixed(5)}{visit.checkin_accuracy ? ` (±${visit.checkin_accuracy} m)` : ''}</a> : '—'}</dd></div>
            {visit.next_followup_at && <div><dt>Follow-up berikutnya</dt><dd>{formatDate(visit.next_followup_at, true)}</dd></div>}
          </dl>
          {visit.hasil && <p className="pap-prewrap pap-note">{visit.hasil}</p>}
          {visit.has_foto && <a href={`/api/visits/${visit.id}/photo`} target="_blank" rel="noreferrer"><img className="pap-checkin-photo" src={`/api/visits/${visit.id}/photo`} alt="Foto bukti visit" /></a>}
        </section>
      )}
      {!visit.checkin_at && visit.hasil && <section className="pap-detail-section"><h3>Catatan</h3><p className="pap-prewrap">{visit.hasil}</p></section>}
      <VisitAttachments visitId={visit.id} canAdd={visit.status !== 'batal' && (isSales || visit.created_by === currentUserId || canSupervise)} currentUserId={currentUserId} isAdmin={isAdmin} />
    </Modal>
  )
}
