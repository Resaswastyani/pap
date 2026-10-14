'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarClock, CalendarDays, CheckCircle2, ChevronRight, ClipboardList, ExternalLink, MapPin, Pencil, Plus, Search, Trash2, Users, Video } from 'lucide-react'
import { MEETING_STATUS, PERMISSIONS, type MeetingStatus, type PlanningStatus } from '@/lib/permissions'
import type { UserProfile } from '@/lib/users'
import { PlanningForm } from './planning-page'
import { api, Field, formatDate, Modal, Notice, Progress, StatusBadge, UserPicker, type UserOption } from './ui'

type Abilities = { edit: boolean; delete: boolean; result: boolean }
type Meeting = {
  id: number
  nomor: string
  planning_id: number | null
  planning_nomor: string | null
  planning_judul: string | null
  division_id: number
  division_name: string
  judul: string
  waktu: string
  deskripsi: string | null
  tempat: string | null
  status: MeetingStatus
  hasil_meeting: string | null
  created_by: number
  created_by_name: string
  participant_count: number
  is_participant: boolean
  can: Abilities
}
type Participant = { id: number; name: string; division_name: string }
type LinkedPlanning = { id: number; nomor: string; judul: string; status: PlanningStatus; progress: number; division_name: string }
type PlanningOption = { id: number; nomor: string; judul: string; division_name: string; status: string }
type Division = { id: number; name: string }
type Summary = { total: number; hari_ini: number; terjadwal: number; selesai: number }

const STATUS_TONE: Record<MeetingStatus, string> = { terjadwal: 'info', berlangsung: 'warning', selesai: 'success', dibatalkan: 'danger' }
const MeetingStatusBadge = ({ value }: { value: MeetingStatus }) => <span className={`pap-status ${STATUS_TONE[value]}`}>{MEETING_STATUS[value]}</span>
const has = (user: UserProfile, permission: string) => user.role.isSuperAdmin || user.permissions.includes(permission as never)
const isUrl = (value: string | null) => !!value && /^https?:\/\/\S+$/i.test(value)

function Place({ value }: { value: string | null }) {
  if (!value) return <span className="pap-muted">—</span>
  if (isUrl(value)) {
    let label = value
    try {
      label = new URL(value).hostname.replace(/^www\./, '')
    } catch {}
    return <a className="pap-meeting-link" href={value} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}><Video className="pap-inline-icon" /> {label} <ExternalLink className="pap-inline-icon" /></a>
  }
  return <span><MapPin className="pap-inline-icon" /> {value}</span>
}

// focusId: buka detail meeting ini saat halaman dibuka (dari notifikasi atau planning)
export function MeetingPage({ user, focusId, onOpenPlanning }: { user: UserProfile; focusId?: number | null; onOpenPlanning: (id: number) => void }) {
  const viewAll = has(user, PERMISSIONS.meetingViewAll)
  const [items, setItems] = useState<Meeting[]>([])
  const [summary, setSummary] = useState<Summary>({ total: 0, hari_ini: 0, terjadwal: 0, selesai: 0 })
  const [divisions, setDivisions] = useState<Division[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [scope, setScope] = useState('')
  const [division, setDivision] = useState('')
  const [form, setForm] = useState<Meeting | 'new' | null>(null)
  const [detailId, setDetailId] = useState<number | null>(focusId ?? null)

  useEffect(() => {
    if (focusId) setDetailId(focusId)
  }, [focusId])

  useEffect(() => {
    if (viewAll) api<{ items: Division[] }>('/api/divisions').then((res) => setDivisions(res.items)).catch(() => {})
  }, [viewAll])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (q.trim()) params.set('q', q.trim())
      if (status) params.set('status', status)
      if (scope) params.set('mine', '1')
      if (division) params.set('division', division)
      const res = await api<{ items: Meeting[]; summary: Summary }>(`/api/meetings?${params}`)
      setItems(res.items)
      setSummary(res.summary)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [q, status, scope, division])

  useEffect(() => {
    const timer = setTimeout(load, q ? 300 : 0)
    return () => clearTimeout(timer)
  }, [load, q])

  const flash = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 4000)
  }

  const stats: [string, number, string, typeof CalendarDays, string][] = [
    ['Total meeting', summary.total, viewAll ? 'Semua divisi' : `${user.division.name} & yang Anda ikuti`, CalendarDays, 'stat-1'],
    ['Hari ini', summary.hari_ini, 'Jadwal meeting hari ini', CalendarClock, 'stat-2'],
    ['Terjadwal', summary.terjadwal, 'Belum berlangsung', Users, 'stat-0'],
    ['Selesai', summary.selesai, 'Sudah ada hasil', CheckCircle2, 'stat-0'],
  ]

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">KOLABORASI</p>
          <h1>Meeting</h1>
          <span>Jadwal rapat, peserta, dan hasil meeting. Bisa terhubung ke planning atau berdiri sendiri.</span>
        </div>
        {has(user, PERMISSIONS.meetingCreate) && <button className="pap-primary-button" onClick={() => setForm('new')}><Plus /> Tambah meeting</button>}
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      <div className="pap-stat-grid four">
        {stats.map(([label, value, note, Icon, tone]) => (
          <div className="pap-stat-card" key={label}>
            <div><span>{label}</span><strong>{value}</strong><small className="neutral">{note}</small></div>
            <div className={`pap-stat-icon ${tone}`}><Icon /></div>
          </div>
        ))}
      </div>
      <div className="pap-table-card">
        <div className="pap-card-head"><div><h2>Daftar meeting</h2><p>Meeting terdekat ditampilkan paling atas</p></div></div>
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari judul, nomor, tempat..." /></label>
          <select className="pap-select" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Filter meeting">
            <option value="">Semua meeting</option>
            <option value="mine">Meeting saya</option>
          </select>
          {viewAll && (
            <select className="pap-select" value={division} onChange={(e) => setDivision(e.target.value)} aria-label="Filter divisi">
              <option value="">Semua divisi</option>
              {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
          <select className="pap-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter status">
            <option value="">Semua status</option>
            {Object.entries(MEETING_STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>
        {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Judul / Nomor</th><th>Waktu</th><th>Tempat / Link</th><th>Peserta</th><th>Status</th><th aria-label="Aksi" /></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="pap-row-link" onClick={() => setDetailId(item.id)}>
                  <td>
                    <div className="pap-cell-title">{item.judul}</div>
                    <div className="pap-cell-sub">{item.nomor} · {item.planning_nomor ? `Planning ${item.planning_nomor}` : 'Meeting dadakan'}{viewAll ? ` · ${item.division_name}` : ''}</div>
                  </td>
                  <td className="pap-nowrap">{formatDate(item.waktu, true)}</td>
                  <td className="pap-meeting-place"><Place value={item.tempat} /></td>
                  <td className="pap-nowrap"><Users className="pap-inline-icon" /> {item.participant_count}{item.is_participant && <span className="pap-chip">Anda</span>}</td>
                  <td><MeetingStatusBadge value={item.status} /></td>
                  <td><button className="pap-link-button" onClick={(e) => { e.stopPropagation(); setDetailId(item.id) }}>Detail</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !items.length && <div className="pap-empty">Belum ada meeting{q || status || scope ? ' yang cocok dengan filter' : ''}.</div>}
          {loading && !items.length && <div className="pap-empty">Memuat meeting...</div>}
        </div>
      </div>

      {form && (
        <MeetingForm
          user={user}
          initial={form === 'new' ? null : form}
          onClose={() => setForm(null)}
          onSaved={(text, id) => { setForm(null); flash(text); load(); if (id) setDetailId(id) }}
        />
      )}
      {detailId && (
        <MeetingDetail
          user={user}
          id={detailId}
          onOpenPlanning={onOpenPlanning}
          onClose={() => setDetailId(null)}
          onChanged={load}
          onEdit={(item) => { setDetailId(null); setForm(item) }}
          onDeleted={() => { setDetailId(null); flash('Meeting dihapus.'); load() }}
        />
      )}
    </>
  )
}

function toInputDateTime(value: string) {
  return value.slice(0, 16).replace(' ', 'T')
}

function MeetingForm({ user, initial, onClose, onSaved }: { user: UserProfile; initial: Meeting | null; onClose: () => void; onSaved: (message: string, id?: number) => void }) {
  const [plannings, setPlannings] = useState<PlanningOption[]>([])
  const [users, setUsers] = useState<UserOption[]>([])
  const creatorId = initial?.created_by ?? user.id
  const [selected, setSelected] = useState<Set<number>>(new Set([creatorId]))
  const defaultTime = useMemo(() => {
    const d = new Date(Date.now() + 7 * 3600e3 + 3600e3)
    return `${d.toISOString().slice(0, 11)}${String(d.getUTCHours()).padStart(2, '0')}:00`
  }, [])
  const [values, setValues] = useState({
    planning_id: String(initial?.planning_id ?? ''),
    waktu: initial ? toInputDateTime(initial.waktu) : defaultTime,
    tempat: initial?.tempat ?? '',
    judul: initial?.judul ?? '',
    deskripsi: initial?.deskripsi ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (key: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }))

  useEffect(() => {
    api<{ items: PlanningOption[] }>('/api/planning').then((res) => setPlannings(res.items.filter((p) => p.status !== 'dibatalkan' || p.id === initial?.planning_id))).catch(() => {})
    api<{ items: UserOption[] }>('/api/users/options').then((res) => setUsers(res.items)).catch((e) => setError(e.message))
    if (initial) api<{ participants: Participant[] }>(`/api/meetings/${initial.id}`).then((res) => setSelected(new Set(res.participants.map((p) => p.id)))).catch(() => {})
  }, [initial])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const payload = { ...values, planning_id: values.planning_id ? Number(values.planning_id) : null, participant_ids: [...selected] }
      if (initial) {
        await api(`/api/meetings/${initial.id}`, { method: 'PATCH', json: payload })
        onSaved('Meeting diperbarui.')
      } else {
        const res = await api<{ item: Meeting }>('/api/meetings', { method: 'POST', json: payload })
        onSaved('Meeting ditambahkan.', res.item.id)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      wide
      title={initial ? 'Edit meeting' : 'Tambah meeting'}
      subtitle={initial?.nomor ?? 'Pilih planning bila meeting ini bagian dari rencana kerja'}
      onClose={onClose}
      footer={<><button type="button" className="pap-btn" onClick={onClose}>Batal</button><button type="submit" form="meeting-form" className="pap-primary-button" disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan meeting'}</button></>}
    >
      <form id="meeting-form" className="pap-form-grid" onSubmit={submit}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Judul meeting" full><input className="pap-input" required maxLength={200} value={values.judul} onChange={set('judul')} placeholder="Contoh: Review jadwal produksi minggu depan" /></Field>
        <Field label="Planning (opsional)" hint="Kosongkan untuk meeting dadakan." full>
          <select className="pap-select" value={values.planning_id} onChange={set('planning_id')}>
            <option value="">— Tanpa planning (meeting dadakan) —</option>
            {plannings.map((p) => <option key={p.id} value={p.id}>{p.nomor} · {p.judul}{plannings.some((x) => x.division_name !== p.division_name) ? ` (${p.division_name})` : ''}</option>)}
          </select>
        </Field>
        <Field label="Waktu"><input className="pap-input" type="datetime-local" required value={values.waktu} onChange={set('waktu')} /></Field>
        <Field label="Tempat / link meeting" hint="Nama ruangan, atau link Zoom/Google Meet."><input className="pap-input" maxLength={500} value={values.tempat} onChange={set('tempat')} placeholder="Ruang Meeting A / https://meet.google.com/..." /></Field>
        <Field label="Deskripsi (opsional)" full>
          <textarea className="pap-input" rows={4} maxLength={5000} value={values.deskripsi} onChange={set('deskripsi')} placeholder="Agenda dan hal yang perlu disiapkan peserta" />
        </Field>
        <div className="full">
          <span className="pap-field-label">Peserta</span>
          <UserPicker users={users} selected={selected} lockedId={creatorId} lockedLabel="pembuat" noun="peserta" onChange={setSelected} />
        </div>
      </form>
    </Modal>
  )
}

type MeetingResponse = { item: Meeting; participants: Participant[]; plannings?: LinkedPlanning[] }

function MeetingDetail({ user, id, onOpenPlanning, onClose, onChanged, onEdit, onDeleted }: { user: UserProfile; id: number; onOpenPlanning: (id: number) => void; onClose: () => void; onChanged: () => void; onEdit: (item: Meeting) => void; onDeleted: () => void }) {
  const [item, setItem] = useState<Meeting | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [plannings, setPlannings] = useState<LinkedPlanning[]>([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<MeetingStatus>('terjadwal')
  const [hasil, setHasil] = useState('')
  const [planningForm, setPlanningForm] = useState(false)
  const canCreatePlanning = has(user, PERMISSIONS.planningCreate)

  const apply = (res: MeetingResponse) => {
    setItem(res.item)
    setParticipants(res.participants)
    if (res.plannings) setPlannings(res.plannings)
    setStatus(res.item.status)
    setHasil(res.item.hasil_meeting ?? '')
  }
  const reload = useCallback(() => api<MeetingResponse>(`/api/meetings/${id}`).then(apply).catch((e) => setError(e.message)), [id])
  useEffect(() => {
    reload()
  }, [reload])

  async function saveResult() {
    if (!item) return
    setBusy(true)
    setError('')
    try {
      apply(await api(`/api/meetings/${item.id}`, { method: 'PATCH', json: { status, hasil_meeting: hasil } }))
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!item || !window.confirm(`Hapus meeting ${item.nomor}?`)) return
    setBusy(true)
    try {
      await api(`/api/meetings/${item.id}`, { method: 'DELETE' })
      onDeleted()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  if (!item) return <Modal title="Detail meeting" onClose={onClose}>{error ? <Notice>{error}</Notice> : <p className="pap-muted">Memuat...</p>}</Modal>
  const resultChanged = status !== item.status || hasil !== (item.hasil_meeting ?? '')

  return (
    <Modal
      wide
      title={item.judul}
      subtitle={`${item.nomor} · ${item.division_name}`}
      onClose={onClose}
      footer={item.can.edit ? (
        <>
          <button className="pap-btn danger" disabled={busy} onClick={remove}><Trash2 /> Hapus</button>
          <span className="pap-spacer" />
          <button className="pap-btn" onClick={() => onEdit(item)}><Pencil /> Edit meeting</button>
        </>
      ) : undefined}
    >
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-detail-badges"><MeetingStatusBadge value={item.status} />{item.is_participant && <span className="pap-status info">Anda peserta</span>}</div>
      <dl className="pap-detail-grid">
        <div><dt>Waktu</dt><dd>{formatDate(item.waktu, true)}</dd></div>
        <div><dt>Tempat / link</dt><dd><Place value={item.tempat} /></dd></div>
        <div><dt>Planning</dt><dd>{item.planning_nomor ? `${item.planning_nomor} · ${item.planning_judul}` : 'Tanpa planning (meeting dadakan)'}</dd></div>
        <div><dt>Dibuat oleh</dt><dd>{item.created_by_name}</dd></div>
      </dl>
      <section className="pap-detail-section">
        <h3>Deskripsi</h3>
        <p className="pap-prewrap">{item.deskripsi || <span className="pap-muted">Tidak ada deskripsi.</span>}</p>
      </section>
      <section className="pap-detail-section">
        <h3>Peserta ({participants.length})</h3>
        <div className="pap-participants">
          {participants.map((p) => <span key={p.id} className="pap-participant"><strong>{p.name}</strong><small>{p.division_name}</small></span>)}
        </div>
      </section>
      <section className="pap-detail-section">
        <h3>Hasil meeting</h3>
        {item.can.result ? (
          <div className="pap-result-editor">
            <textarea className="pap-input" rows={5} maxLength={10000} value={hasil} onChange={(e) => setHasil(e.target.value)} placeholder="Keputusan, tindak lanjut, dan PIC..." />
            <div className="pap-inline-actions">
              <select className="pap-select" value={status} onChange={(e) => setStatus(e.target.value as MeetingStatus)} aria-label="Status meeting">
                {Object.entries(MEETING_STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
              <button className="pap-primary-button" disabled={busy || !resultChanged} onClick={saveResult}>Simpan hasil</button>
            </div>
          </div>
        ) : (
          <p className="pap-prewrap">{item.hasil_meeting || <span className="pap-muted">Belum ada hasil meeting.</span>}</p>
        )}
      </section>
      <section className="pap-detail-section">
        <div className="pap-section-head">
          <h3>Planning dari meeting ini ({plannings.length})</h3>
          {canCreatePlanning && <button className="pap-btn" onClick={() => setPlanningForm(true)}><Plus /> Buat planning</button>}
        </div>
        {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
        {plannings.length > 0 ? (
          <ul className="pap-linked-list">
            {plannings.map((p) => (
              <li key={p.id}>
                <button onClick={() => onOpenPlanning(p.id)}>
                  <ClipboardList />
                  <span className="pap-linked-main"><strong>{p.judul}</strong><small>{p.nomor} · {p.division_name}</small></span>
                  <Progress value={p.progress} />
                  <StatusBadge value={p.status} />
                  <ChevronRight />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pap-muted">{canCreatePlanning ? 'Belum ada planning. Buat planning untuk menindaklanjuti hasil meeting ini.' : 'Belum ada planning dari meeting ini.'}</p>
        )}
      </section>
      {planningForm && (
        <PlanningForm
          user={user}
          meeting={{ id: item.id, nomor: item.nomor, judul: item.judul, hasil: item.hasil_meeting, participantIds: participants.map((p) => p.id) }}
          onClose={() => setPlanningForm(false)}
          onSaved={(text) => {
            setPlanningForm(false)
            setMessage(`${text} Planning juga tampil di menu Planning.`)
            reload()
          }}
        />
      )}
    </Modal>
  )
}
