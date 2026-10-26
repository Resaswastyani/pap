'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarClock, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, List, ExternalLink, MapPin, Pencil, Plus, Search, Trash2, Users, Video } from 'lucide-react'
import { MEETING_STATUS, PERMISSIONS, type MeetingStatus, type PlanningStatus } from '@/lib/permissions'
import type { UserProfile } from '@/lib/users'
import { AttachmentPicker, FileItems, PendingItems, PlanningForm, type PendingAttachment, type PlanningFile } from './planning-page'
import { api, Field, formatDate, Modal, Notice, Pager, Progress, StatusBadge, usePaged, type UserOption, UserPicker, RowActions, useQuickAction } from './ui'

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
  const [newAt, setNewAt] = useState<string | null>(null) // tanggal dari kalender untuk meeting baru
  useQuickAction('tambah-meeting', () => { setNewAt(null); setForm('new') })
  const [detailId, setDetailId] = useState<number | null>(focusId ?? null)
  const [view, setView] = useState<'list' | 'calendar'>('list')
  const [calendarKey, setCalendarKey] = useState(0)

  useEffect(() => {
    try {
      if (localStorage.getItem('pap-meeting-view') === 'calendar') setView('calendar')
    } catch {}
  }, [])
  const changeView = (next: 'list' | 'calendar') => {
    setView(next)
    try {
      localStorage.setItem('pap-meeting-view', next)
    } catch {}
  }
  const canCreate = has(user, PERMISSIONS.meetingCreate)
  const filters = useMemo(() => ({ q, status, scope, division }), [q, status, scope, division])

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
  const reloadAll = () => {
    load()
    setCalendarKey((k) => k + 1)
  }

  const stats: [string, number, string, typeof CalendarDays, string][] = [
    ['Total meeting', summary.total, viewAll ? 'Semua divisi' : `${user.division.name} & yang Anda ikuti`, CalendarDays, 'stat-1'],
    ['Hari ini', summary.hari_ini, 'Jadwal meeting hari ini', CalendarClock, 'stat-2'],
    ['Terjadwal', summary.terjadwal, 'Belum berlangsung', Users, 'stat-0'],
    ['Selesai', summary.selesai, 'Sudah ada hasil', CheckCircle2, 'stat-0'],
  ]

  const paged = usePaged(items, items.length)
  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">KOLABORASI</p>
          <h1>Meeting</h1>
          <span>Jadwal rapat, peserta, dan hasil meeting. Bisa terhubung ke planning atau berdiri sendiri.</span>
        </div>
        {canCreate && <button className="pap-primary-button" onClick={() => { setNewAt(null); setForm('new') }}><Plus /> Tambah meeting</button>}
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
        <div className="pap-card-head">
          <div><h2>{view === 'calendar' ? 'Kalender meeting' : 'Daftar meeting'}</h2><p>{view === 'calendar' ? 'Klik tanggal untuk melihat agenda hari itu' : 'Meeting terdekat ditampilkan paling atas'}</p></div>
          <div className="pap-segmented" role="tablist" aria-label="Tampilan meeting">
            <button role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'active' : ''} onClick={() => changeView('list')}><List /> Daftar</button>
            <button role="tab" aria-selected={view === 'calendar'} className={view === 'calendar' ? 'active' : ''} onClick={() => changeView('calendar')}><CalendarDays /> Kalender</button>
          </div>
        </div>
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
        {view === 'calendar' ? (
          <MeetingCalendar
            key={calendarKey}
            filters={filters}
            canCreate={canCreate}
            onOpen={setDetailId}
            onCreateAt={(date) => { setNewAt(date); setForm('new') }}
          />
        ) : (
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Judul / Nomor</th><th>Waktu</th><th>Tempat / Link</th><th>Peserta</th><th>Status</th><th className="pap-actions-col">Aksi</th></tr></thead>
            <tbody>
              {paged.items.map((item) => (
                <tr key={item.id} className="pap-row-link" onClick={() => setDetailId(item.id)}>
                  <td>
                    <div className="pap-cell-title">{item.judul}</div>
                    <div className="pap-cell-sub">{item.nomor} · {item.planning_nomor ? `Planning ${item.planning_nomor}` : 'Meeting dadakan'}{viewAll ? ` · ${item.division_name}` : ''}</div>
                  </td>
                  <td className="pap-nowrap">{formatDate(item.waktu, true)}</td>
                  <td className="pap-meeting-place"><Place value={item.tempat} /></td>
                  <td className="pap-nowrap"><Users className="pap-inline-icon" /> {item.participant_count}{item.is_participant && <span className="pap-chip">Anda</span>}</td>
                  <td><MeetingStatusBadge value={item.status} /></td>
                  <td className="pap-actions-cell"><RowActions label={item.judul} onView={() => setDetailId(item.id)} onEdit={item.can.edit ? () => setForm(item) : undefined} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !items.length && <div className="pap-empty">Belum ada meeting{q || status || scope ? ' yang cocok dengan filter' : ''}.</div>}
          {loading && !items.length && <div className="pap-empty">Memuat meeting...</div>}
          <Pager {...paged.pager} noun="meeting" />
        </div>
        )}
      </div>

      {form && (
        <MeetingForm
          user={user}
          initial={form === 'new' ? null : form}
          defaultDate={form === 'new' ? newAt : null}
          onClose={() => setForm(null)}
          onSaved={(text, id) => { setForm(null); flash(text); reloadAll(); if (id) setDetailId(id) }}
        />
      )}
      {detailId && (
        <MeetingDetail
          user={user}
          id={detailId}
          onOpenPlanning={onOpenPlanning}
          onClose={() => setDetailId(null)}
          onChanged={reloadAll}
          onEdit={(item) => { setDetailId(null); setForm(item) }}
          onDeleted={() => { setDetailId(null); flash('Meeting dihapus.'); reloadAll() }}
        />
      )}
    </>
  )
}

// ---------- Kalender meeting ----------
const DAY_NAMES = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']
const MONTH_NAMES = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
// Hari ini menurut WIB (meeting disimpan dalam jam WIB)
const todayWib = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)

type CalendarFilters = { q: string; status: string; scope: string; division: string }

function MeetingCalendar({ filters, canCreate, onOpen, onCreateAt }: { filters: CalendarFilters; canCreate: boolean; onOpen: (id: number) => void; onCreateAt: (date: string) => void }) {
  const today = todayWib()
  const [month, setMonth] = useState(() => today.slice(0, 7)) // "YYYY-MM"
  const [selected, setSelected] = useState(today)
  const [items, setItems] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Grid 6 minggu mulai Senin sebelum/tepat tanggal 1
  const days = useMemo(() => {
    const [y, m] = month.split('-').map(Number)
    const first = new Date(y, m - 1, 1)
    const start = new Date(y, m - 1, 1 - ((first.getDay() + 6) % 7))
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
  }, [month])

  useEffect(() => {
    const last = days[41]
    const params = new URLSearchParams({ from: ymd(days[0]), to: ymd(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1)) })
    if (filters.q.trim()) params.set('q', filters.q.trim())
    if (filters.status) params.set('status', filters.status)
    if (filters.scope) params.set('mine', '1')
    if (filters.division) params.set('division', filters.division)
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(() => {
      api<{ items: Meeting[] }>(`/api/meetings?${params}`)
        .then((res) => {
          if (cancelled) return
          setItems(res.items)
          setError('')
        })
        .catch((e) => !cancelled && setError(e.message))
        .finally(() => !cancelled && setLoading(false))
    }, filters.q ? 300 : 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [days, filters])

  const byDay = useMemo(() => {
    const map = new Map<string, Meeting[]>()
    for (const item of [...items].sort((a, b) => a.waktu.localeCompare(b.waktu))) {
      const key = item.waktu.slice(0, 10)
      map.set(key, [...(map.get(key) ?? []), item])
    }
    return map
  }, [items])

  const shift = (delta: number) => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setMonth(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`)
  }
  const goToday = () => {
    setMonth(today.slice(0, 7))
    setSelected(today)
  }
  const [year, monthNo] = month.split('-').map(Number)
  const agenda = byDay.get(selected) ?? []

  return (
    <div className="pap-calendar">
      <div className="pap-calendar-bar">
        <div className="pap-calendar-nav">
          <button className="pap-icon-button" aria-label="Bulan sebelumnya" onClick={() => shift(-1)}><ChevronLeft /></button>
          <button className="pap-icon-button" aria-label="Bulan berikutnya" onClick={() => shift(1)}><ChevronRight /></button>
          <h3>{MONTH_NAMES[monthNo - 1]} {year}</h3>
        </div>
        <button className="pap-btn" onClick={goToday}>Hari ini</button>
      </div>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className={`pap-calendar-grid${loading ? ' loading' : ''}`}>
        {DAY_NAMES.map((name) => <div key={name} className="pap-calendar-dayname">{name}</div>)}
        {days.map((day) => {
          const key = ymd(day)
          const list = byDay.get(key) ?? []
          const outside = day.getMonth() !== monthNo - 1
          return (
            <div
              key={key}
              role="button"
              tabIndex={0}
              aria-label={`${day.getDate()} ${MONTH_NAMES[day.getMonth()]}, ${list.length} meeting`}
              className={`pap-calendar-cell${outside ? ' outside' : ''}${key === today ? ' today' : ''}${key === selected ? ' selected' : ''}`}
              onClick={() => setSelected(key)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setSelected(key)
                }
              }}
            >
              <span className="pap-calendar-date">{day.getDate()}</span>
              <div className="pap-calendar-events">
                {list.slice(0, 3).map((item) => (
                  <button key={item.id} className={`pap-calendar-event ${item.status}`} title={`${item.waktu.slice(11, 16)} ${item.judul}`} onClick={(e) => { e.stopPropagation(); onOpen(item.id) }}>
                    <b>{item.waktu.slice(11, 16)}</b> {item.judul}
                  </button>
                ))}
                {list.length > 3 && <span className="pap-calendar-more">+{list.length - 3} lagi</span>}
              </div>
              {list.length > 0 && <span className="pap-calendar-dots" aria-hidden="true">{list.slice(0, 4).map((item) => <i key={item.id} className={item.status} />)}</span>}
            </div>
          )
        })}
      </div>
      <div className="pap-calendar-agenda">
        <div className="pap-section-head">
          <h3>{formatDate(selected)}{selected === today ? ' · Hari ini' : ''}</h3>
          {canCreate && selected >= today && <button className="pap-btn" onClick={() => onCreateAt(selected)}><Plus /> Meeting di tanggal ini</button>}
        </div>
        {agenda.length > 0 ? (
          <ul className="pap-linked-list">
            {agenda.map((item) => (
              <li key={item.id}>
                <button onClick={() => onOpen(item.id)}>
                  <span className="pap-agenda-time">{item.waktu.slice(11, 16)}</span>
                  <span className="pap-linked-main"><strong>{item.judul}</strong><small>{item.nomor}{item.tempat ? ` · ${item.tempat}` : ''} · {item.participant_count} peserta</small></span>
                  <MeetingStatusBadge value={item.status} />
                  <ChevronRight />
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="pap-muted">{loading ? 'Memuat...' : 'Tidak ada meeting di tanggal ini.'}</p>}
      </div>
    </div>
  )
}

function toInputDateTime(value: string) {
  return value.slice(0, 16).replace(' ', 'T')
}

function MeetingForm({ user, initial, defaultDate, onClose, onSaved }: { user: UserProfile; initial: Meeting | null; defaultDate?: string | null; onClose: () => void; onSaved: (message: string, id?: number) => void }) {
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
    waktu: initial ? toInputDateTime(initial.waktu) : defaultDate ? `${defaultDate}T09:00` : defaultTime,
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

type MeetingResponse = { item: Meeting; participants: Participant[]; plannings?: LinkedPlanning[]; files?: PlanningFile[] }

// Upload satu lampiran hasil meeting (file atau link)
async function uploadMeetingFile(meetingId: number, item: PendingAttachment) {
  if (item.kind === 'link') return api(`/api/meetings/${meetingId}/files`, { method: 'POST', json: { name: item.name, url: item.url } })
  const form = new FormData()
  form.append('file', item.file)
  return api(`/api/meetings/${meetingId}/files`, { method: 'POST', body: form })
}

function MeetingDetail({ user, id, onOpenPlanning, onClose, onChanged, onEdit, onDeleted }: { user: UserProfile; id: number; onOpenPlanning: (id: number) => void; onClose: () => void; onChanged: () => void; onEdit: (item: Meeting) => void; onDeleted: () => void }) {
  const [item, setItem] = useState<Meeting | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [plannings, setPlannings] = useState<LinkedPlanning[]>([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<MeetingStatus>('terjadwal')
  const [hasil, setHasil] = useState('')
  const [files, setFiles] = useState<PlanningFile[]>([])
  const [pending, setPending] = useState<PendingAttachment[]>([])
  const [planningForm, setPlanningForm] = useState(false)
  const canCreatePlanning = has(user, PERMISSIONS.planningCreate)

  const apply = (res: MeetingResponse) => {
    setItem(res.item)
    setParticipants(res.participants)
    if (res.plannings) setPlannings(res.plannings)
    if (res.files) setFiles(res.files)
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
      if (resultChanged) apply(await api(`/api/meetings/${item.id}`, { method: 'PATCH', json: { status, hasil_meeting: hasil } }))
      const failed: string[] = []
      for (const attachment of pending) {
        try {
          await uploadMeetingFile(item.id, attachment)
        } catch (err) {
          failed.push((err as Error).message)
        }
      }
      setPending([])
      await reload()
      if (failed.length) setError(`Sebagian lampiran gagal: ${failed.join(' ')}`)
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
            <label className="pap-field">
              <span>Catatan hasil meeting (opsional)</span>
              <textarea className="pap-input" rows={5} maxLength={10000} value={hasil} onChange={(e) => setHasil(e.target.value)} placeholder="Keputusan, tindak lanjut, dan PIC..." />
            </label>
            {files.length > 0 && (
              <FileItems
                files={files}
                basePath="/api/meetings/files"
                busy={busy}
                canDelete={(file) => item.can.edit || file.uploaded_by === user.id}
                onDelete={async (file) => {
                  setBusy(true)
                  try {
                    await api(`/api/meetings/files/${file.id}`, { method: 'DELETE' })
                    await reload()
                  } catch (e) {
                    setError((e as Error).message)
                  } finally {
                    setBusy(false)
                  }
                }}
              />
            )}
            <AttachmentPicker label="Lampiran hasil meeting (opsional)" busy={busy} onError={setError} onAdd={(attachment) => setPending((list) => [...list, attachment])} />
            <PendingItems items={pending} onRemove={(index) => setPending((list) => list.filter((_, i) => i !== index))} />
            <div className="pap-inline-actions">
              <select className="pap-select" value={status} onChange={(e) => setStatus(e.target.value as MeetingStatus)} aria-label="Status meeting">
                {Object.entries(MEETING_STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
              <button className="pap-primary-button" disabled={busy || (!resultChanged && !pending.length)} onClick={saveResult}>{busy ? 'Menyimpan...' : 'Simpan hasil'}</button>
            </div>
          </div>
        ) : (
          <>
            <p className="pap-prewrap">{item.hasil_meeting || (!files.length && <span className="pap-muted">Belum ada hasil meeting.</span>)}</p>
            {files.length > 0 && <FileItems files={files} basePath="/api/meetings/files" busy={false} canDelete={false} onDelete={() => {}} />}
          </>
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
