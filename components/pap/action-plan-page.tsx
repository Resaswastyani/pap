'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, Ban, CalendarRange, CheckCircle2, ClipboardList, ExternalLink, FileSpreadsheet, Flag, Gauge, ListChecks, Pencil, Plus, RefreshCw, RotateCcw, Search, Settings, Target, Trash2, TrendingUp, Upload, Users } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { api, askReason, confirmDialog, Field, FreshBadge, formatDate, Modal, Notice, Pager, Progress, RowActions, usePaged, UserPicker, type UserOption } from './ui'

// ===== Action Plan (Corporate Plan) =====
// Program Kerja, Timeline (Gantt), Progress Report, Issue Log, KPI — sinkron dua arah dengan Google Sheet.

type Person = { user_id: number; name: string; peran: 'pic' | 'support'; division: string | null }
type Program = {
  id: number; kode: string; nama: string; jenis: string | null; divisi: string | null; tujuan: string | null; target: string | null
  pic_text: string | null; support_text: string | null; start_date: string | null; end_date: string | null; start_text: string | null; end_text: string | null
  priority: string | null; status: string; progress: number; catatan: string | null; prev_status: string | null; cancel_reason: string | null
  cancelled_at: string | null; cancelled_name: string | null; overdue: boolean; hari_lewat: number; last_update: string | null; open_issues: number
  created_at: string; updated_at: string; people: Person[]
}
type Summary = {
  total: number; done: number; on_progress: number; pending: number; not_started: number; cancelled: number; overdue: number; avg_progress: number
  byStatus: { status: string; n: number }[]; byPriority: { priority: string; n: number; done: number; overdue: number }[]
  byDivisi: { divisi: string; n: number; done: number; overdue: number; avg_progress: number }[]
}
type Kpi = { id: number; nama: string; definisi: string | null; target: string | null; realisasi: string | null; status: string | null; frekuensi: string | null; pic_text: string | null; catatan: string | null; auto: boolean }
type Options = { status: string[]; picStatus: string[]; priority: string[]; jenis: string[]; divisi: string[]; severity: string[]; issueStatus: string[] }
type ListRes = { programs: Program[]; summary: Summary; kpis: Kpi[]; users: UserOption[]; sheet: { url: string; syncedAt: string | null } | null; options: Options; can: { manage: boolean; viewAll: boolean } }
type LogItem = {
  id: number; program_id: number | null; program_kode: string | null; program_nama?: string | null; tanggal: string; task: string; divisi: string | null; pic_text: string | null
  status: string | null; progress_before: number | null; progress_after: number | null; kendala: string | null; next_action: string | null; next_deadline: string | null
  evidence: string | null; jenis: 'update' | 'batal' | 'aktif' | 'sheet'; user_name: string | null; created_at: string
}
type Issue = {
  id: number; program_id: number | null; program_kode: string | null; program_nama?: string | null; tanggal: string; issue: string; dampak: string | null; severity: string | null
  pic_text: string | null; target_date: string | null; status: string; akar_masalah: string | null; mitigasi: string | null; catatan: string | null; created_at: string; updated_at: string
}

const TONE: Record<string, string> = { Done: 'success', 'On Progress': 'info', Pending: 'warning', 'Waiting Approval': 'warning', Overdue: 'danger', 'Not Started': 'neutral', Cancelled: 'neutral' }
const PRIORITY_TONE: Record<string, string> = { High: 'danger', Medium: 'warning', Low: 'neutral' }
const Badge = ({ value, tone }: { value: string | null; tone?: string }) => (value ? <span className={`pap-status ${tone ?? TONE[value] ?? 'neutral'}`}>{value}</span> : <span className="pap-muted">—</span>)
const statusOf = (p: Program) => (p.overdue ? 'Overdue' : p.status)
const periodText = (p: Program) => {
  const s = p.start_date ? formatDate(p.start_date) : p.start_text
  const e = p.end_date ? formatDate(p.end_date) : p.end_text
  return s || e ? `${s ?? '…'} – ${e ?? '…'}` : 'Belum dijadwalkan'
}
const picNames = (p: Program, peran: 'pic' | 'support') => {
  const acc = p.people.filter((x) => x.peran === peran).map((x) => x.name)
  return acc.length ? acc.join(', ') : (peran === 'pic' ? p.pic_text : p.support_text) ?? ''
}
const isLink = (s: string | null) => !!s && /^https?:\/\//i.test(s.trim())
// Teks dengan link (mis. catatan berisi URL Google Drive) tampil bisa diklik
function Linkify({ text }: { text: string | null }) {
  if (!text) return <>—</>
  const parts = text.split(/(https?:\/\/\S+)/g)
  return <>{parts.map((p, i) => (/^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer" className="pap-ap-link">{p.length > 48 ? `${p.slice(0, 45)}…` : p}</a> : <span key={i}>{p}</span>))}</>
}

type Tab = 'ringkasan' | 'program' | 'timeline' | 'progress' | 'issue' | 'kpi'
const TABS: [Tab, string, ReactNode][] = [
  ['ringkasan', 'Ringkasan', <Gauge key="g" />], ['program', 'Program Kerja', <ListChecks key="l" />], ['timeline', 'Timeline', <CalendarRange key="c" />],
  ['progress', 'Progress Report', <TrendingUp key="t" />], ['issue', 'Issue Log', <AlertTriangle key="a" />], ['kpi', 'KPI', <Target key="k" />],
]

export function ActionPlanPage({ user, focusId }: { user: UserProfile; focusId?: number | null }) {
  const [data, setData] = useState<ListRes | null>(null)
  const [tab, setTab] = useState<Tab>('ringkasan')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [warning, setWarning] = useState('')
  const [detailId, setDetailId] = useState<number | null>(focusId ?? null)
  const [form, setForm] = useState<Program | 'new' | null>(null)
  const [settings, setSettings] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [filter, setFilter] = useState('aktif')

  const load = useCallback(() => {
    api<ListRes>('/api/action-plan').then((r) => { setData(r); setError('') }).catch((e) => setError(e.message))
  }, [])
  useEffect(load, [load])
  const done = (text: string, warn?: string | null) => {
    setMessage(text)
    setWarning(warn ?? '')
    setTimeout(() => setMessage(''), 6000)
    load()
  }
  const manage = !!data?.can.manage
  const s = data?.summary

  async function sync() {
    setSyncing(true)
    try {
      const r = await api<{ programBaru: number; programUbah: number; progress: number; issueBaru: number; issueUbah: number; kpi: number; tanpaId: number; warning: string | null }>('/api/action-plan/sheet', { method: 'POST' })
      done(`Sinkron selesai: ${r.programBaru} program baru, ${r.programUbah} diperbarui, ${r.progress} catatan progress, ${r.issueBaru + r.issueUbah} issue, ${r.kpi} KPI${r.tanpaId ? `; ${r.tanpaId} baris tanpa ID diberi ID baru` : ''}.`, r.warning)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSyncing(false)
    }
  }
  const openFilter = (f: string) => { setFilter(f); setTab('program') }

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">RINGKASAN · CORPORATE PLAN</p>
          <h1>Action Plan</h1>
          <span>Program kerja perusahaan beserta PIC, timeline, progress, issue, dan KPI. {manage ? 'Admin menyusun & mengubah program; PIC meng-update progress.' : 'PIC / support meng-update progress program masing-masing.'}</span>
        </div>
        {manage && (
          <div className="pap-inline-actions pap-wrap">
            {data?.sheet?.url && <button className="pap-btn" disabled={syncing} onClick={sync}><RefreshCw className={syncing ? 'pap-spin' : undefined} /> {syncing ? 'Menyinkronkan…' : 'Sinkron Google Sheet'}</button>}
            <button className="pap-btn" onClick={() => setSettings(true)}><Settings /> Sheet & impor</button>
            <button className="pap-primary-button" onClick={() => setForm('new')}><Plus /> Tambah program</button>
          </div>
        )}
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {warning && <Notice onClose={() => setWarning('')}>{warning}</Notice>}
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}

      <div className="pap-stat-grid pap-ap-stats">
        <StatCard label="Program aktif" value={s?.total ?? '—'} note={`${s?.cancelled ?? 0} dibatalkan`} icon={<ClipboardList />} tone="stat-1" onClick={() => openFilter('aktif')} />
        <StatCard label="Done" value={s?.done ?? '—'} note={s?.total ? `${Math.round(((s.done ?? 0) / s.total) * 100)}% selesai` : 'Selesai'} icon={<CheckCircle2 />} tone="stat-0" onClick={() => openFilter('Done')} />
        <StatCard label="On Progress" value={s?.on_progress ?? '—'} note={`${s?.not_started ?? 0} belum mulai`} icon={<TrendingUp />} tone="stat-1" onClick={() => openFilter('On Progress')} />
        <StatCard label="Pending / Approval" value={s?.pending ?? '—'} note="Menunggu keputusan" icon={<Flag />} tone="stat-1" onClick={() => openFilter('pending')} />
        <StatCard label="Overdue" value={s?.overdue ?? '—'} note="Lewat End Date" icon={<AlertTriangle />} tone="stat-2" danger={!!s?.overdue} onClick={() => openFilter('overdue')} />
        <StatCard label="Rata-rata progress" value={s ? `${s.avg_progress}%` : '—'} note="Program aktif" icon={<Gauge />} tone="stat-1" />
      </div>

      <div className="pap-segmented pap-page-tabs pap-ap-tabs" role="tablist" aria-label="Bagian Action Plan">
        {TABS.map(([key, label, icon]) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{icon}<span>{label}</span></button>)}
      </div>

      {!data && !error && <div className="pap-table-card"><div className="pap-empty">Memuat Action Plan…</div></div>}
      {data && tab === 'ringkasan' && <Overview data={data} onOpen={setDetailId} onFilter={openFilter} />}
      {data && tab === 'program' && <ProgramList data={data} user={user} filter={filter} setFilter={setFilter} onOpen={setDetailId} onEdit={(p) => setForm(p)} />}
      {data && tab === 'timeline' && <Timeline programs={data.programs} onOpen={setDetailId} />}
      {data && tab === 'progress' && <ProgressLog onOpen={setDetailId} />}
      {data && tab === 'issue' && <IssueLog data={data} onOpen={setDetailId} onChanged={done} />}
      {data && tab === 'kpi' && <KpiTable data={data} onChanged={done} />}

      {form && data && (
        <ProgramForm
          initial={form === 'new' ? null : form}
          data={data}
          onClose={() => setForm(null)}
          onSaved={(text, warn, id) => { setForm(null); done(text, warn); if (id) setDetailId(id) }}
        />
      )}
      {detailId && data && (
        <ProgramDetail
          id={detailId}
          data={data}
          onClose={() => setDetailId(null)}
          onEdit={(p) => { setDetailId(null); setForm(p) }}
          onChanged={(text, warn) => done(text, warn)}
          onDeleted={(text, warn) => { setDetailId(null); done(text, warn) }}
        />
      )}
      {settings && data?.sheet && <SheetSettings sheet={data.sheet} onClose={() => setSettings(false)} onChanged={(text, warn) => { done(text, warn) }} />}
    </>
  )
}

function StatCard({ label, value, note, icon, tone, danger, onClick }: { label: string; value: ReactNode; note: string; icon: ReactNode; tone: string; danger?: boolean; onClick?: () => void }) {
  const body = (
    <>
      <div><span>{label}</span><strong className={danger ? 'pap-ap-danger' : undefined}>{value}</strong><small className="neutral">{note}</small></div>
      <div className={`pap-stat-icon ${tone}`}>{icon}</div>
    </>
  )
  return onClick ? <button className="pap-stat-card pap-stat-button" onClick={onClick}>{body}</button> : <div className="pap-stat-card">{body}</div>
}

// ---------- Ringkasan: resume overdue, status, prioritas, divisi ----------
function Overview({ data, onOpen, onFilter }: { data: ListRes; onOpen: (id: number) => void; onFilter: (f: string) => void }) {
  const overdue = data.programs.filter((p) => p.overdue).sort((a, b) => b.hari_lewat - a.hari_lewat)
  const byPic = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of overdue) for (const name of (picNames(p, 'pic') || 'Tanpa PIC').split(/\s*[,&]\s*|\s+dan\s+/i).filter(Boolean)) map.set(name.trim(), (map.get(name.trim()) ?? 0) + 1)
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [overdue])
  const s = data.summary
  const statusTotal = Math.max(1, s.byStatus.reduce((n, x) => n + x.n, 0))
  const order = ['Done', 'On Progress', 'Pending', 'Waiting Approval', 'Not Started', 'Overdue', 'Cancelled']
  return (
    <div className="pap-ap-overview">
      <section className="pap-table-card pap-ap-overdue">
        <div className="pap-card-head">
          <div><h2><AlertTriangle className="pap-inline-icon pap-ap-danger" /> Resume overdue</h2><p>{overdue.length ? `${overdue.length} program lewat End Date dan belum Done. Urut dari yang paling lama terlambat.` : 'Tidak ada program yang terlambat.'}</p></div>
          {overdue.length > 0 && <button className="pap-btn" onClick={() => onFilter('overdue')}>Lihat di daftar</button>}
        </div>
        {overdue.length > 0 && (
          <>
            {byPic.length > 0 && <div className="pap-ap-chips">{byPic.map(([name, n]) => <span key={name} className="pap-chip"><Users className="pap-inline-icon" /> {name} · {n}</span>)}</div>}
            <ul className="pap-ap-overdue-list">
              {overdue.slice(0, 12).map((p) => (
                <li key={p.id}>
                  <button onClick={() => onOpen(p.id)}>
                    <span className="pap-ap-late">{p.hari_lewat > 0 ? `${p.hari_lewat} hari` : 'Overdue'}</span>
                    <span className="pap-ap-overdue-main"><b>{p.kode} · {p.nama}</b><small>{picNames(p, 'pic') || 'Tanpa PIC'} · End {p.end_date ? formatDate(p.end_date) : p.end_text ?? '—'} · {p.status}</small></span>
                    <Progress value={p.progress} />
                  </button>
                </li>
              ))}
            </ul>
            {overdue.length > 12 && <p className="pap-muted pap-ap-pad">+{overdue.length - 12} program lain, buka "Lihat di daftar".</p>}
          </>
        )}
      </section>
      <div className="pap-ap-grid">
        <section className="pap-table-card">
          <div className="pap-card-head"><div><h2>Status</h2><p>Semua program termasuk yang dibatalkan</p></div></div>
          <ul className="pap-ap-bars">
            {order.map((st) => {
              const n = s.byStatus.find((x) => x.status === st)?.n ?? 0
              return (
                <li key={st}>
                  <button onClick={() => onFilter(st === 'Overdue' ? 'overdue' : st === 'Cancelled' ? 'cancelled' : st)}>
                    <span>{st}</span><span className="pap-ap-bar-track"><span className={`pap-ap-bar-fill ${TONE[st]}`} style={{ width: `${(n / statusTotal) * 100}%` }} /></span><b>{n}</b>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
        <section className="pap-table-card">
          <div className="pap-card-head"><div><h2>Prioritas</h2><p>Program aktif per prioritas</p></div></div>
          <div className="pap-table-wrap">
            <table>
              <thead><tr><th>Priority</th><th>Jumlah</th><th>Done</th><th>Overdue</th></tr></thead>
              <tbody>{s.byPriority.map((r) => <tr key={r.priority}><td><Badge value={r.priority} tone={PRIORITY_TONE[r.priority]} /></td><td>{r.n}</td><td>{r.done}</td><td className={r.overdue ? 'pap-ap-danger' : ''}>{r.overdue}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
        <section className="pap-table-card pap-ap-span">
          <div className="pap-card-head"><div><h2>Per divisi / area</h2><p>Jumlah program, selesai, terlambat, dan rata-rata progress</p></div></div>
          <div className="pap-table-wrap">
            <table>
              <thead><tr><th>Divisi / Area</th><th>Program</th><th>Done</th><th>Overdue</th><th>Rata-rata progress</th></tr></thead>
              <tbody>{s.byDivisi.map((r) => <tr key={r.divisi}><td><b>{r.divisi}</b></td><td>{r.n}</td><td>{r.done}</td><td className={r.overdue ? 'pap-ap-danger' : ''}>{r.overdue}</td><td><Progress value={r.avg_progress} /></td></tr>)}</tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}

// ---------- Daftar program ----------
function ProgramList({ data, user, filter, setFilter, onOpen, onEdit }: { data: ListRes; user: UserProfile; filter: string; setFilter: (f: string) => void; onOpen: (id: number) => void; onEdit: (p: Program) => void }) {
  const [q, setQ] = useState('')
  const [divisi, setDivisi] = useState('')
  const [priority, setPriority] = useState('')
  const divisions = useMemo(() => [...new Set(data.programs.map((p) => p.divisi).filter(Boolean) as string[])].sort(), [data.programs])
  const items = useMemo(() => {
    const t = q.trim().toLowerCase()
    return data.programs.filter((p) => {
      if (filter === 'aktif' && p.status === 'Cancelled') return false
      if (filter === 'cancelled' && p.status !== 'Cancelled') return false
      if (filter === 'overdue' && !p.overdue) return false
      if (filter === 'pending' && !['Pending', 'Waiting Approval'].includes(p.status)) return false
      if (filter === 'mine' && !p.people.some((x) => x.user_id === user.id)) return false
      if (!['aktif', 'semua', 'cancelled', 'overdue', 'pending', 'mine'].includes(filter) && p.status !== filter) return false
      if (divisi && p.divisi !== divisi) return false
      if (priority && p.priority !== priority) return false
      return !t || `${p.kode} ${p.nama} ${p.pic_text ?? ''} ${p.support_text ?? ''} ${p.divisi ?? ''} ${p.tujuan ?? ''} ${p.people.map((x) => x.name).join(' ')}`.toLowerCase().includes(t)
    })
  }, [data.programs, filter, q, divisi, priority, user.id])
  const paged = usePaged(items, `${filter}-${q}-${divisi}-${priority}`, 50)
  return (
    <div className="pap-table-card">
      <div className="pap-card-head"><div><h2>Program kerja</h2><p>{items.length} program. Klik baris untuk detail, riwayat progress, dan update progress.</p></div></div>
      <div className="pap-filters">
        <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari ID, program, PIC, divisi..." /></label>
        <select className="pap-select" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter status">
          <option value="aktif">Semua aktif</option>
          <option value="mine">Program saya</option>
          <option value="overdue">Overdue</option>
          <option value="pending">Pending / Approval</option>
          {data.options.status.filter((x) => !['Overdue', 'Cancelled'].includes(x)).map((x) => <option key={x} value={x}>{x}</option>)}
          <option value="cancelled">Dibatalkan</option>
          <option value="semua">Semua termasuk dibatalkan</option>
        </select>
        <select className="pap-select" value={divisi} onChange={(e) => setDivisi(e.target.value)} aria-label="Filter divisi">
          <option value="">Semua divisi / area</option>
          {divisions.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className="pap-select" value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Filter prioritas">
          <option value="">Semua prioritas</option>
          {data.options.priority.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </div>
      <div className="pap-table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Program</th><th>PIC</th><th>Periode</th><th>Priority</th><th>Status</th><th>Progress</th><th className="pap-actions-col">Aksi</th></tr></thead>
          <tbody>
            {paged.items.map((p) => (
              <tr key={p.id} className={`pap-row-link ${p.status === 'Cancelled' ? 'pap-ap-cancelled' : ''}`} onClick={() => onOpen(p.id)}>
                <td className="pap-nowrap"><b>{p.kode}</b></td>
                <td><div className="pap-cell-title">{p.nama}<FreshBadge item={p} /></div><div className="pap-cell-sub">{[p.jenis, p.divisi].filter(Boolean).join(' · ') || '—'}{p.open_issues ? ` · ${p.open_issues} issue` : ''}</div></td>
                <td>{picNames(p, 'pic') || <span className="pap-muted">Tanpa PIC</span>}{picNames(p, 'support') && <div className="pap-cell-sub">Support: {picNames(p, 'support')}</div>}</td>
                <td className={p.overdue ? 'pap-followup overdue' : ''}>{periodText(p)}{p.overdue && p.hari_lewat > 0 && <div className="pap-cell-sub pap-ap-danger">Lewat {p.hari_lewat} hari</div>}</td>
                <td><Badge value={p.priority} tone={p.priority ? PRIORITY_TONE[p.priority] : undefined} /></td>
                <td><Badge value={statusOf(p)} />{p.overdue && p.status !== 'Overdue' && <div className="pap-cell-sub">{p.status}</div>}</td>
                <td><Progress value={p.progress} /></td>
                <td className="pap-actions-cell"><RowActions label={`${p.kode} ${p.nama}`} onView={() => onOpen(p.id)} onEdit={data.can.manage ? () => onEdit(p) : undefined} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <div className="pap-empty">{data.programs.length ? 'Tidak ada program yang cocok dengan filter.' : data.can.manage ? 'Belum ada program. Tambah program, atau impor dari Excel / Google Sheet lewat "Sheet & impor".' : 'Belum ada program yang melibatkan Anda.'}</div>}
      </div>
      <Pager {...paged.pager} noun="program" />
    </div>
  )
}

// ---------- Timeline (Gantt per minggu / bulan) ----------
const DAY = 86400e3
const toDay = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
function Timeline({ programs, onOpen }: { programs: Program[]; onOpen: (id: number) => void }) {
  const [showCancelled, setShowCancelled] = useState(false)
  const [q, setQ] = useState('')
  const list = programs.filter((p) => (showCancelled || p.status !== 'Cancelled') && (!q.trim() || `${p.kode} ${p.nama} ${p.pic_text ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())))
  const dated = list.filter((p) => p.start_date || p.end_date)
  const undated = list.filter((p) => !p.start_date && !p.end_date)
  const now = new Date()
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY
  const days = dated.flatMap((p) => [p.start_date, p.end_date].filter(Boolean).map((d) => toDay(d!)))
  // Rentang: awal bulan tanggal paling awal s/d akhir bulan tanggal paling akhir (hari ini ikut terlihat)
  const min = days.length ? Math.min(...days, today) : today
  const max = days.length ? Math.max(...days, today) : today + 60
  const startD = new Date(min * DAY)
  const endD = new Date(max * DAY)
  const start = Date.UTC(startD.getUTCFullYear(), startD.getUTCMonth(), 1) / DAY
  const end = Date.UTC(endD.getUTCFullYear(), endD.getUTCMonth() + 1, 1) / DAY
  const span = Math.max(1, end - start)
  const months: { label: string; left: number; width: number }[] = []
  for (let d = new Date(start * DAY); d.getTime() / DAY < end; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    const a = d.getTime() / DAY
    const b = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / DAY
    months.push({ label: `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`, left: ((a - start) / span) * 100, width: ((b - a) / span) * 100 })
  }
  const weeks: number[] = []
  for (let d = start + ((8 - new Date(start * DAY).getUTCDay()) % 7); d < end; d += 7) weeks.push(((d - start) / span) * 100)
  const pct = (d: number) => ((d - start) / span) * 100
  const minWidth = Math.max(720, months.length * 110)
  return (
    <div className="pap-table-card">
      <div className="pap-card-head">
        <div><h2>Timeline program</h2><p>Bar = Start s/d End Date; isi bar = progress. Garis tegak = hari ini. Geser ke samping untuk bulan lain.</p></div>
        <label className="pap-check"><input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /><span>Tampilkan dibatalkan</span></label>
      </div>
      <div className="pap-filters"><label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari ID, program, PIC..." /></label></div>
      <div className="pap-viz-legend pap-ap-legend">
        {['Done', 'On Progress', 'Pending', 'Not Started', 'Overdue', 'Cancelled'].map((st) => <span key={st}><i className={`pap-ap-swatch ${TONE[st]}`} />{st}</span>)}
      </div>
      <div className="pap-ap-gantt-scroll">
        <div className="pap-ap-gantt" style={{ minWidth }}>
          <div className="pap-ap-gantt-head">
            <div className="pap-ap-gantt-label">Program</div>
            <div className="pap-ap-gantt-track">
              {months.map((m) => <span key={m.label} className="pap-ap-month" style={{ left: `${m.left}%`, width: `${m.width}%` }}>{m.label}</span>)}
            </div>
          </div>
          {dated.map((p) => {
            const s0 = p.start_date ? toDay(p.start_date) : toDay(p.end_date!) - 6
            const e0 = (p.end_date ? toDay(p.end_date) : s0 + 6) + 1
            const left = pct(s0)
            const width = Math.max(0.8, pct(e0) - left)
            const st = statusOf(p)
            return (
              <div key={p.id} className={`pap-ap-gantt-row ${p.status === 'Cancelled' ? 'pap-ap-cancelled' : ''}`}>
                <button className="pap-ap-gantt-label" onClick={() => onOpen(p.id)} title={`${p.kode} · ${p.nama}`}>
                  <strong>{p.overdue && <AlertTriangle className="pap-ap-flag" />}{p.kode} · {p.nama}</strong>
                  <small>{picNames(p, 'pic') || 'Tanpa PIC'} · {p.progress}%</small>
                </button>
                <div className="pap-ap-gantt-track">
                  {weeks.map((w) => <span key={w} className="pap-ap-week" style={{ left: `${w}%` }} />)}
                  <button className={`pap-ap-bar ${TONE[st]} ${st === 'Cancelled' ? 'cancelled' : ''}`} style={{ left: `${left}%`, width: `${width}%` }} onClick={() => onOpen(p.id)} title={`${p.kode} · ${p.nama}\n${periodText(p)}\n${st} · ${p.progress}%`}>
                    <span className="fill" style={{ width: `${p.progress}%` }} />
                    <em>{p.progress}%</em>
                  </button>
                </div>
              </div>
            )
          })}
          {!dated.length && <div className="pap-empty">Belum ada program yang punya Start / End Date.</div>}
          {today >= start && today <= end && <div className={`pap-ap-today ${pct(today) > 88 ? 'flip' : ''}`} style={{ left: `calc(var(--ap-label) + (100% - var(--ap-label)) * ${pct(today + 0.5) / 100})` }}><span>Hari ini</span></div>}
        </div>
      </div>
      {undated.length > 0 && (
        <div className="pap-ap-undated">
          <b>Belum dijadwalkan ({undated.length})</b>
          <div className="pap-ap-chips">{undated.map((p) => <button key={p.id} className="pap-chip" onClick={() => onOpen(p.id)}>{p.kode} · {p.nama}</button>)}</div>
        </div>
      )}
    </div>
  )
}

// ---------- Progress Report ----------
function ProgressLog({ onOpen }: { onOpen: (id: number) => void }) {
  const [items, setItems] = useState<LogItem[] | null>(null)
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { api<{ items: LogItem[] }>('/api/action-plan/progress').then((r) => setItems(r.items)).catch((e) => setError(e.message)) }, [])
  const list = (items ?? []).filter((g) => !q.trim() || `${g.program_kode} ${g.program_nama ?? ''} ${g.task} ${g.pic_text ?? ''} ${g.kendala ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))
  const paged = usePaged(list, q, 50)
  return (
    <div className="pap-table-card">
      <div className="pap-card-head"><div><h2>Progress report</h2><p>Riwayat update dari PIC (SIMPAP) dan dari sheet, termasuk pembatalan dan aktif kembali.</p></div></div>
      {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
      <div className="pap-filters"><label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari program, update, PIC, kendala..." /></label></div>
      <div className="pap-table-wrap">
        <table>
          <thead><tr><th>Tanggal</th><th>Program</th><th>Update / task</th><th>PIC</th><th>Status</th><th>Progress</th><th>Evidence</th></tr></thead>
          <tbody>
            {paged.items.map((g) => (
              <tr key={g.id} className={g.program_id ? 'pap-row-link' : ''} onClick={() => g.program_id && onOpen(g.program_id)}>
                <td className="pap-nowrap">{formatDate(g.tanggal)}</td>
                <td><b>{g.program_kode}</b>{g.program_nama && <div className="pap-cell-sub">{g.program_nama}</div>}</td>
                <td><div className="pap-cell-title">{g.jenis === 'batal' ? <Ban className="pap-inline-icon" /> : g.jenis === 'aktif' ? <RotateCcw className="pap-inline-icon" /> : null}{g.task}</div>
                  {g.kendala && <div className="pap-cell-sub">Kendala: {g.kendala}</div>}
                  {g.next_action && <div className="pap-cell-sub">Next: {g.next_action}{g.next_deadline ? ` (${formatDate(g.next_deadline)})` : ''}</div>}</td>
                <td>{g.user_name ?? g.pic_text ?? '—'}{g.jenis === 'sheet' && <div className="pap-cell-sub">dari sheet</div>}</td>
                <td><Badge value={g.status} /></td>
                <td className="pap-nowrap">{g.progress_before ?? '—'}% → <b>{g.progress_after ?? '—'}%</b></td>
                <td onClick={(e) => e.stopPropagation()}>{isLink(g.evidence) ? <a href={g.evidence!} target="_blank" rel="noreferrer" className="pap-ap-link"><ExternalLink className="pap-inline-icon" /> Buka</a> : g.evidence || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {items && !list.length && <div className="pap-empty">Belum ada progress report.</div>}
        {!items && !error && <div className="pap-empty">Memuat…</div>}
      </div>
      <Pager {...paged.pager} noun="catatan" />
    </div>
  )
}

// ---------- Issue Log ----------
function IssueLog({ data, onOpen, onChanged }: { data: ListRes; onOpen: (id: number) => void; onChanged: (text: string, warn?: string | null) => void }) {
  const [items, setItems] = useState<Issue[] | null>(null)
  const [error, setError] = useState('')
  const [form, setForm] = useState<Issue | 'new' | null>(null)
  const [q, setQ] = useState('')
  const load = useCallback(() => { api<{ items: Issue[] }>('/api/action-plan/issues').then((r) => setItems(r.items)).catch((e) => setError(e.message)) }, [])
  useEffect(load, [load])
  const list = (items ?? []).filter((i) => !q.trim() || `${i.program_kode ?? ''} ${i.program_nama ?? ''} ${i.issue} ${i.pic_text ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))
  const paged = usePaged(list, q, 50)
  async function remove(i: Issue) {
    if (!(await confirmDialog({ title: 'Hapus issue?', message: `Issue "${i.issue.slice(0, 80)}" dihapus dari SIMPAP (masuk Data Terhapus) dan barisnya dikosongkan di sheet.`, confirmLabel: 'Hapus', tone: 'danger' }))) return
    try {
      const r = await api<{ warning: string | null }>(`/api/action-plan/issues/${i.id}`, { method: 'DELETE' })
      onChanged('Issue dihapus.', r.warning)
      load()
    } catch (e) { setError((e as Error).message) }
  }
  const overdueIssue = (i: Issue) => !!i.target_date && !['Done', 'Cancelled'].includes(i.status) && i.target_date < new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
  return (
    <div className="pap-table-card">
      <div className="pap-card-head">
        <div><h2>Issue log & bottleneck</h2><p>Issue severity High wajib dieskalasi maksimal 24 jam.</p></div>
        {data.can.manage && <button className="pap-primary-button" onClick={() => setForm('new')}><Plus /> Tambah issue</button>}
      </div>
      {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
      <div className="pap-filters"><label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari program, issue, PIC..." /></label></div>
      <div className="pap-table-wrap">
        <table>
          <thead><tr><th>Tanggal</th><th>Program</th><th>Issue</th><th>Severity</th><th>PIC penyelesaian</th><th>Target</th><th>Status</th>{data.can.manage && <th className="pap-actions-col">Aksi</th>}</tr></thead>
          <tbody>
            {paged.items.map((i) => (
              <tr key={i.id} className={i.program_id ? 'pap-row-link' : ''} onClick={() => i.program_id && onOpen(i.program_id)}>
                <td className="pap-nowrap">{formatDate(i.tanggal)}</td>
                <td><b>{i.program_kode ?? '—'}</b>{i.program_nama && <div className="pap-cell-sub">{i.program_nama}</div>}</td>
                <td><div className="pap-cell-title">{i.issue}<FreshBadge item={i} /></div>{i.dampak && <div className="pap-cell-sub">Dampak: {i.dampak}</div>}{i.mitigasi && <div className="pap-cell-sub">Mitigasi: {i.mitigasi}</div>}</td>
                <td><Badge value={i.severity} tone={i.severity ? PRIORITY_TONE[i.severity] : undefined} /></td>
                <td>{i.pic_text ?? '—'}</td>
                <td className={overdueIssue(i) ? 'pap-followup overdue' : ''}>{formatDate(i.target_date)}</td>
                <td><Badge value={i.status} /></td>
                {data.can.manage && <td className="pap-actions-cell"><RowActions label={i.issue} onEdit={() => setForm(i)} onDelete={() => remove(i)} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
        {items && !list.length && <div className="pap-empty">Belum ada issue.</div>}
        {!items && !error && <div className="pap-empty">Memuat…</div>}
      </div>
      <Pager {...paged.pager} noun="issue" />
      {form && <IssueForm initial={form === 'new' ? null : form} data={data} onClose={() => setForm(null)} onSaved={(text, warn) => { setForm(null); onChanged(text, warn); load() }} />}
    </div>
  )
}

function IssueForm({ initial, data, programKode, onClose, onSaved }: { initial: Issue | null; data: ListRes; programKode?: string; onClose: () => void; onSaved: (text: string, warn: string | null) => void }) {
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
  const [v, setV] = useState({
    program_kode: initial?.program_kode ?? programKode ?? '', tanggal: initial?.tanggal?.slice(0, 10) ?? today, issue: initial?.issue ?? '', dampak: initial?.dampak ?? '',
    severity: initial?.severity ?? 'Medium', pic_text: initial?.pic_text ?? '', target_date: initial?.target_date?.slice(0, 10) ?? '', status: initial?.status ?? 'On Progress',
    akar_masalah: initial?.akar_masalah ?? '', mitigasi: initial?.mitigasi ?? '', catatan: initial?.catatan ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }))
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const r = await api<{ warning: string | null }>(initial ? `/api/action-plan/issues/${initial.id}` : '/api/action-plan/issues', { method: initial ? 'PATCH' : 'POST', json: v })
      onSaved(initial ? 'Issue diperbarui.' : 'Issue ditambahkan.', r.warning)
    } catch (err) { setError((err as Error).message) } finally { setSaving(false) }
  }
  return (
    <Modal title={initial ? 'Ubah issue' : 'Tambah issue'} wide onClose={onClose}
      footer={<><span className="pap-spacer" /><button type="button" className="pap-btn" onClick={onClose}>Batal</button><button type="submit" form="ap-issue-form" className="pap-primary-button" disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan'}</button></>}>
      <form id="ap-issue-form" className="pap-form-grid" onSubmit={submit}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Program">
          <select className="pap-select" value={v.program_kode} onChange={set('program_kode')}>
            <option value="">— Umum (tanpa program) —</option>
            {data.programs.map((p) => <option key={p.id} value={p.kode}>{p.kode} · {p.nama}</option>)}
          </select>
        </Field>
        <Field label="Tanggal"><input className="pap-input" type="date" value={v.tanggal} onChange={set('tanggal')} required /></Field>
        <Field label="Issue / kendala" full><textarea className="pap-input" rows={2} required maxLength={5000} value={v.issue} onChange={set('issue')} /></Field>
        <Field label="Dampak" full><textarea className="pap-input" rows={2} maxLength={5000} value={v.dampak} onChange={set('dampak')} /></Field>
        <Field label="Severity"><select className="pap-select" value={v.severity} onChange={set('severity')}>{data.options.severity.map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Status"><select className="pap-select" value={v.status} onChange={set('status')}>{data.options.issueStatus.map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="PIC penyelesaian"><input className="pap-input" maxLength={255} value={v.pic_text} onChange={set('pic_text')} /></Field>
        <Field label="Target selesai"><input className="pap-input" type="date" value={v.target_date} onChange={set('target_date')} /></Field>
        <Field label="Akar masalah" full><textarea className="pap-input" rows={2} maxLength={5000} value={v.akar_masalah} onChange={set('akar_masalah')} /></Field>
        <Field label="Mitigasi / solusi" full><textarea className="pap-input" rows={2} maxLength={5000} value={v.mitigasi} onChange={set('mitigasi')} /></Field>
        <Field label="Catatan" full><textarea className="pap-input" rows={2} maxLength={5000} value={v.catatan} onChange={set('catatan')} /></Field>
      </form>
    </Modal>
  )
}

// ---------- KPI ----------
function KpiTable({ data, onChanged }: { data: ListRes; onChanged: (text: string, warn?: string | null) => void }) {
  const [edit, setEdit] = useState<Kpi | null>(null)
  return (
    <div className="pap-table-card">
      <div className="pap-card-head"><div><h2>KPI plan monitoring</h2><p>KPI bertanda "otomatis" dihitung dari data program; lainnya diisi admin.</p></div></div>
      <div className="pap-table-wrap">
        <table>
          <thead><tr><th>KPI</th><th>Target</th><th>Realisasi</th><th>Status</th><th>Frekuensi</th><th>PIC</th>{data.can.manage && <th className="pap-actions-col">Aksi</th>}</tr></thead>
          <tbody>
            {data.kpis.map((k) => (
              <tr key={k.id}>
                <td><div className="pap-cell-title">{k.nama}{k.auto && <span className="pap-chip">otomatis</span>}</div>{k.definisi && <div className="pap-cell-sub">{k.definisi}</div>}{k.catatan && <div className="pap-cell-sub">Catatan: {k.catatan}</div>}</td>
                <td className="pap-nowrap">{k.target ?? '—'}</td>
                <td className="pap-nowrap"><b>{k.realisasi ?? '—'}</b></td>
                <td>{k.status ? <span className={`pap-status ${/belum|tidak/i.test(k.status) ? 'danger' : /tercapai|ok|on track/i.test(k.status) ? 'success' : 'neutral'}`}>{k.status}</span> : '—'}</td>
                <td>{k.frekuensi ?? '—'}</td>
                <td>{k.pic_text ?? '—'}</td>
                {data.can.manage && <td className="pap-actions-cell"><RowActions label={k.nama} onEdit={() => setEdit(k)} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <KpiForm kpi={edit} onClose={() => setEdit(null)} onSaved={(warn) => { setEdit(null); onChanged('KPI diperbarui.', warn) }} />}
    </div>
  )
}

function KpiForm({ kpi, onClose, onSaved }: { kpi: Kpi; onClose: () => void; onSaved: (warn: string | null) => void }) {
  const [v, setV] = useState({ definisi: kpi.definisi ?? '', target: kpi.target ?? '', realisasi: kpi.realisasi ?? '', status: kpi.status ?? '', frekuensi: kpi.frekuensi ?? '', pic_text: kpi.pic_text ?? '', catatan: kpi.catatan ?? '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }))
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try { const r = await api<{ warning: string | null }>('/api/action-plan/kpi', { method: 'PATCH', json: { id: kpi.id, ...v } }); onSaved(r.warning) } catch (err) { setError((err as Error).message) } finally { setSaving(false) }
  }
  return (
    <Modal title={`Ubah KPI: ${kpi.nama}`} onClose={onClose}
      footer={<><span className="pap-spacer" /><button type="button" className="pap-btn" onClick={onClose}>Batal</button><button type="submit" form="ap-kpi-form" className="pap-primary-button" disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan'}</button></>}>
      <form id="ap-kpi-form" className="pap-form-grid" onSubmit={submit}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Definisi" full><input className="pap-input" maxLength={500} value={v.definisi} onChange={set('definisi')} /></Field>
        <Field label="Target" hint="Mis. ≥85%, ≤15%, 0, ≤24 jam"><input className="pap-input" maxLength={60} value={v.target} onChange={set('target')} /></Field>
        <Field label="Frekuensi"><input className="pap-input" maxLength={30} value={v.frekuensi} onChange={set('frekuensi')} /></Field>
        {!kpi.auto && <Field label="Realisasi"><input className="pap-input" maxLength={60} value={v.realisasi} onChange={set('realisasi')} /></Field>}
        {!kpi.auto && <Field label="Status"><input className="pap-input" list="ap-kpi-status" maxLength={30} value={v.status} onChange={set('status')} /><datalist id="ap-kpi-status"><option value="Tercapai" /><option value="Belum tercapai" /></datalist></Field>}
        <Field label="PIC"><input className="pap-input" maxLength={120} value={v.pic_text} onChange={set('pic_text')} /></Field>
        <Field label="Catatan" full><textarea className="pap-input" rows={2} maxLength={500} value={v.catatan} onChange={set('catatan')} /></Field>
        {kpi.auto && <p className="pap-muted full">Realisasi & status KPI ini dihitung otomatis dari data program.</p>}
      </form>
    </Modal>
  )
}

// ---------- Form program (admin) ----------
function ProgramForm({ initial, data, onClose, onSaved }: { initial: Program | null; data: ListRes; onClose: () => void; onSaved: (text: string, warn: string | null, id?: number) => void }) {
  const [v, setV] = useState({
    nama: initial?.nama ?? '', jenis: initial?.jenis ?? '', divisi: initial?.divisi ?? '', tujuan: initial?.tujuan ?? '', target: initial?.target ?? '',
    pic_text: initial?.pic_text ?? '', support_text: initial?.support_text ?? '', start_date: initial?.start_date?.slice(0, 10) ?? '', end_date: initial?.end_date?.slice(0, 10) ?? '',
    priority: initial?.priority ?? 'Medium', status: initial?.status ?? 'Not Started', progress: String(initial?.progress ?? 0), catatan: initial?.catatan ?? '',
  })
  const [pic, setPic] = useState(new Set(initial?.people.filter((p) => p.peran === 'pic').map((p) => p.user_id) ?? []))
  const [support, setSupport] = useState(new Set(initial?.people.filter((p) => p.peran === 'support').map((p) => p.user_id) ?? []))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }))
  const cancelled = initial?.status === 'Cancelled'
  // Nama PIC (teks di sheet) ikut terisi dari akun yang dipilih bila masih kosong
  const namesOf = (ids: Set<number>) => data.users.filter((u) => ids.has(u.id)).map((u) => u.name).join(', ')
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const payload = { ...v, pic_text: v.pic_text || namesOf(pic), support_text: v.support_text || namesOf(support), pic: [...pic], support: [...support] }
      if (initial) {
        const r = await api<{ warning: string | null }>(`/api/action-plan/${initial.id}`, { method: 'PATCH', json: payload })
        onSaved(`Program ${initial.kode} diperbarui.`, r.warning)
      } else {
        const r = await api<{ id: number; kode: string; warning: string | null }>('/api/action-plan', { method: 'POST', json: payload })
        onSaved(`Program ${r.kode} ditambahkan.`, r.warning, r.id)
      }
    } catch (err) { setError((err as Error).message) } finally { setSaving(false) }
  }
  return (
    <Modal title={initial ? `Ubah program ${initial.kode}` : 'Tambah program kerja'} subtitle={initial?.nama} wide onClose={onClose}
      footer={<><span className="pap-spacer" /><button type="button" className="pap-btn" onClick={onClose}>Batal</button><button type="submit" form="ap-program-form" className="pap-primary-button" disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan'}</button></>}>
      <form id="ap-program-form" className="pap-form-grid" onSubmit={submit}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Nama program" full><input className="pap-input" required maxLength={255} value={v.nama} onChange={set('nama')} placeholder="Contoh: Menambah supplier biji plastik" /></Field>
        <Field label="Jenis program"><select className="pap-select" value={v.jenis} onChange={set('jenis')}><option value="">—</option>{data.options.jenis.map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Divisi / area"><input className="pap-input" list="ap-divisi" maxLength={80} value={v.divisi} onChange={set('divisi')} /><datalist id="ap-divisi">{data.options.divisi.map((x) => <option key={x} value={x} />)}</datalist></Field>
        <Field label="Tujuan" full><textarea className="pap-input" rows={2} maxLength={5000} value={v.tujuan} onChange={set('tujuan')} /></Field>
        <Field label="Target angka" full><input className="pap-input" maxLength={500} value={v.target} onChange={set('target')} placeholder="Contoh: 2 supplier baru, 100% karyawan terlatih" /></Field>
        <Field label="Start date" hint={initial?.start_text ? `Di sheet tertulis "${initial.start_text}"` : undefined}><input className="pap-input" type="date" value={v.start_date} onChange={set('start_date')} /></Field>
        <Field label="End date (deadline)" hint={initial?.end_text ? `Di sheet tertulis "${initial.end_text}"` : undefined}><input className="pap-input" type="date" value={v.end_date} onChange={set('end_date')} /></Field>
        <Field label="Priority"><select className="pap-select" value={v.priority} onChange={set('priority')}><option value="">—</option>{data.options.priority.map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Status" hint={cancelled ? 'Program dibatalkan: aktifkan kembali dari detail program.' : undefined}>
          <select className="pap-select" value={v.status} onChange={set('status')} disabled={cancelled}>
            {(cancelled ? ['Cancelled'] : data.options.status.filter((x) => x !== 'Cancelled')).map((x) => <option key={x}>{x}</option>)}
          </select>
        </Field>
        <Field label="% Progress"><input className="pap-input" type="number" min={0} max={100} value={v.progress} onChange={set('progress')} /></Field>
        <div />
        <Field label="PIC utama (teks di sheet)" hint="Kosongkan untuk memakai nama akun PIC yang dipilih"><input className="pap-input" maxLength={255} value={v.pic_text} onChange={set('pic_text')} /></Field>
        <Field label="Support (teks di sheet)"><input className="pap-input" maxLength={255} value={v.support_text} onChange={set('support_text')} /></Field>
        <Field label="Akun PIC (boleh update progress)" full><UserPicker users={data.users} selected={pic} noun="PIC" onChange={setPic} /></Field>
        <Field label="Akun support (boleh update progress)" full><UserPicker users={data.users.filter((u) => !pic.has(u.id))} selected={support} noun="support" onChange={setSupport} /></Field>
        <Field label="Catatan" full><textarea className="pap-input" rows={2} maxLength={5000} value={v.catatan} onChange={set('catatan')} placeholder="Catatan, link dokumen pendukung, dll." /></Field>
      </form>
    </Modal>
  )
}

// ---------- Detail program ----------
type Detail = { program: Program; progress: LogItem[]; issues: Issue[]; can: { manage: boolean; update: boolean; peran: string | null } }
function ProgramDetail({ id, data, onClose, onEdit, onChanged, onDeleted }: {
  id: number; data: ListRes; onClose: () => void; onEdit: (p: Program) => void; onChanged: (text: string, warn?: string | null) => void; onDeleted: (text: string, warn?: string | null) => void
}) {
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [panel, setPanel] = useState<'progress' | 'issue' | null>(null)
  const load = useCallback(() => { api<Detail>(`/api/action-plan/${id}`).then(setD).catch((e) => setError(e.message)) }, [id])
  useEffect(load, [load])
  const p = d?.program
  async function act(action: 'cancel' | 'reactivate') {
    if (!p) return
    let reason: string | null = null
    if (action === 'cancel') {
      reason = await askReason({ title: `Batalkan ${p.kode}?`, label: 'Alasan pembatalan', confirmLabel: 'Batalkan program' })
      if (!reason) return
    } else if (!(await confirmDialog({ title: `Aktifkan kembali ${p.kode}?`, message: `Status kembali ke "${p.prev_status ?? (p.progress > 0 ? 'On Progress' : 'Not Started')}".`, confirmLabel: 'Aktifkan kembali' }))) return
    setBusy(true)
    try {
      const r = await api<{ status: string; warning: string | null }>(`/api/action-plan/${p.id}/status`, { method: 'POST', json: { action, reason } })
      onChanged(action === 'cancel' ? `Program ${p.kode} dibatalkan (tetap tercatat).` : `Program ${p.kode} aktif kembali: ${r.status}.`, r.warning)
      load()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  async function remove() {
    if (!p || !(await confirmDialog({ title: `Hapus ${p.kode}?`, message: 'Program, riwayat progress, dan PIC-nya dihapus (masuk Data Terhapus) dan barisnya dikosongkan di sheet. Untuk menghentikan program tetapi tetap tercatat, gunakan "Batalkan".', confirmLabel: 'Hapus', tone: 'danger' }))) return
    setBusy(true)
    try { const r = await api<{ warning: string | null }>(`/api/action-plan/${p.id}`, { method: 'DELETE' }); onDeleted(`Program ${p.kode} dihapus.`, r.warning) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const footer = p && (
    <>
      {d?.can.manage && <button className="pap-btn danger" disabled={busy} onClick={remove}><Trash2 /> Hapus</button>}
      {d?.can.manage && (p.status === 'Cancelled'
        ? <button className="pap-btn" disabled={busy} onClick={() => act('reactivate')}><RotateCcw /> Aktifkan kembali</button>
        : <button className="pap-btn" disabled={busy} onClick={() => act('cancel')}><Ban /> Batalkan</button>)}
      <span className="pap-spacer" />
      {d?.can.manage && <button className="pap-btn" onClick={() => onEdit(p)}><Pencil /> Ubah</button>}
      {d?.can.update && <button className="pap-primary-button" onClick={() => setPanel(panel === 'progress' ? null : 'progress')}><TrendingUp /> Update progress</button>}
    </>
  )
  return (
    <Modal title={p ? `${p.kode} · ${p.nama}` : 'Memuat…'} subtitle={p ? [p.jenis, p.divisi].filter(Boolean).join(' · ') : undefined} wide onClose={onClose} footer={footer}>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {!p && !error && <p className="pap-muted">Memuat…</p>}
      {p && (
        <div className="pap-ap-detail">
          <div className="pap-ap-badges">
            <Badge value={statusOf(p)} />{p.overdue && p.status !== 'Overdue' && <Badge value={p.status} />}
            {p.priority && <Badge value={`Priority ${p.priority}`} tone={PRIORITY_TONE[p.priority]} />}
            {p.overdue && p.hari_lewat > 0 && <span className="pap-status danger">Lewat {p.hari_lewat} hari</span>}
            {d?.can.peran && <span className="pap-chip">Anda {d.can.peran === 'pic' ? 'PIC' : 'support'}</span>}
          </div>
          {p.status === 'Cancelled' && (
            <Notice>Dibatalkan {p.cancelled_at ? formatDate(p.cancelled_at, true) : ''}{p.cancelled_name ? ` oleh ${p.cancelled_name}` : ''}. Alasan: {p.cancel_reason ?? '—'}. Program tetap tercatat dan bisa diaktifkan kembali oleh admin.</Notice>
          )}
          <div className="pap-ap-progress-big"><Progress value={p.progress} />{p.last_update && <small className="pap-muted">Update terakhir {formatDate(p.last_update, true)}</small>}</div>
          {panel === 'progress' && d?.can.update && <ProgressForm program={p} options={data.options} onCancel={() => setPanel(null)} onSaved={(warn) => { setPanel(null); onChanged(`Progress ${p.kode} diperbarui.`, warn); load() }} />}
          <dl className="pap-detail-grid">
            <div><dt>Periode</dt><dd>{periodText(p)}</dd></div>
            <div><dt>Target angka</dt><dd>{p.target || '—'}</dd></div>
            <div><dt>PIC utama</dt><dd>{picNames(p, 'pic') || '—'}{p.pic_text && p.people.some((x) => x.peran === 'pic') && <small className="pap-muted"><br />Di sheet: {p.pic_text}</small>}</dd></div>
            <div><dt>Support</dt><dd>{picNames(p, 'support') || '—'}</dd></div>
            <div className="full"><dt>Tujuan</dt><dd className="pap-prewrap">{p.tujuan || '—'}</dd></div>
            {p.catatan && <div className="full"><dt>Catatan</dt><dd className="pap-prewrap"><Linkify text={p.catatan} /></dd></div>}
          </dl>
          {!p.people.length && <Notice>Belum ada akun PIC yang ditautkan, sehingga belum ada yang bisa meng-update progress selain admin.{d?.can.manage ? ' Klik "Ubah" untuk memilih akun PIC.' : ''}</Notice>}
          <section className="pap-detail-section">
            <div className="pap-section-head"><h3>Riwayat progress ({d!.progress.length})</h3></div>
            {d!.progress.length ? (
              <ol className="pap-ap-history">
                {d!.progress.map((g) => (
                  <li key={g.id} className={g.jenis}>
                    <div className="pap-ap-history-head"><b>{formatDate(g.tanggal)}</b><span>{g.user_name ?? g.pic_text ?? '—'}{g.jenis === 'sheet' ? ' (sheet)' : ''}</span>{g.status && <Badge value={g.status} />}{g.jenis !== 'batal' && g.jenis !== 'aktif' && <span className="pap-ap-delta">{g.progress_before ?? 0}% → {g.progress_after ?? 0}%</span>}</div>
                    <p>{g.task}</p>
                    {g.kendala && <p className="pap-muted">Kendala: {g.kendala}</p>}
                    {g.next_action && <p className="pap-muted">Next action: {g.next_action}{g.next_deadline ? ` (deadline ${formatDate(g.next_deadline)})` : ''}</p>}
                    {g.evidence && <p className="pap-muted">Evidence: <Linkify text={g.evidence} /></p>}
                  </li>
                ))}
              </ol>
            ) : <p className="pap-muted">Belum ada update progress.</p>}
          </section>
          <section className="pap-detail-section">
            <div className="pap-section-head"><h3>Issue ({d!.issues.length})</h3>{d?.can.manage && <button className="pap-btn" onClick={() => setPanel('issue')}><Plus /> Tambah issue</button>}</div>
            {d!.issues.length ? (
              <ul className="pap-ap-issues">{d!.issues.map((i) => <li key={i.id}><Badge value={i.severity} tone={i.severity ? PRIORITY_TONE[i.severity] : undefined} /><span><b>{i.issue}</b><small>{formatDate(i.tanggal)} · {i.pic_text ?? 'Tanpa PIC'} · target {formatDate(i.target_date)}</small></span><Badge value={i.status} /></li>)}</ul>
            ) : <p className="pap-muted">Tidak ada issue.</p>}
          </section>
        </div>
      )}
      {panel === 'issue' && p && <IssueForm initial={null} data={data} programKode={p.kode} onClose={() => setPanel(null)} onSaved={(text, warn) => { setPanel(null); onChanged(text, warn); load() }} />}
    </Modal>
  )
}

function ProgressForm({ program, options, onCancel, onSaved }: { program: Program; options: Options; onCancel: () => void; onSaved: (warn: string | null) => void }) {
  const [v, setV] = useState({ progress: String(program.progress), status: program.status === 'Overdue' || program.status === 'Cancelled' ? 'On Progress' : program.status, task: '', kendala: '', next_action: '', next_deadline: '', evidence: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => {
    const next = { ...x, [k]: e.target.value }
    // Progress 100% -> Done; status Done -> 100%
    if (k === 'progress' && Number(e.target.value) >= 100) next.status = 'Done'
    if (k === 'status' && e.target.value === 'Done') next.progress = '100'
    return next
  })
  const needEvidence = v.status === 'Done' || Number(v.progress) >= 100
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try { const r = await api<{ warning: string | null }>(`/api/action-plan/${program.id}/progress`, { method: 'POST', json: v }); onSaved(r.warning) } catch (err) { setError((err as Error).message) } finally { setSaving(false) }
  }
  return (
    <form className="pap-ap-progress-form" onSubmit={submit}>
      <h3>Update progress</h3>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-form-grid">
        <Field label={`Progress: ${v.progress || 0}%`} full>
          <div className="pap-ap-range"><input type="range" min={0} max={100} step={5} value={v.progress || 0} onChange={set('progress')} aria-label="Progress" /><input className="pap-input" type="number" min={0} max={100} value={v.progress} onChange={set('progress')} aria-label="Progress persen" /></div>
        </Field>
        <Field label="Status"><select className="pap-select" value={v.status} onChange={set('status')}>{options.picStatus.map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Deadline next action"><input className="pap-input" type="date" value={v.next_deadline} onChange={set('next_deadline')} /></Field>
        <Field label="Update / task yang dikerjakan" full><textarea className="pap-input" rows={2} required maxLength={500} value={v.task} onChange={set('task')} placeholder="Contoh: Sudah survey 3 calon supplier, 1 sudah kirim penawaran" /></Field>
        <Field label="Kendala" full><textarea className="pap-input" rows={2} maxLength={5000} value={v.kendala} onChange={set('kendala')} /></Field>
        <Field label="Next action" full><textarea className="pap-input" rows={2} maxLength={5000} value={v.next_action} onChange={set('next_action')} /></Field>
        <Field label={`Evidence link${needEvidence ? ' (wajib untuk Done)' : ''}`} full hint="Link bukti: Google Drive, foto, dokumen, spreadsheet">
          <input className="pap-input" inputMode="url" maxLength={1000} required={needEvidence} value={v.evidence} onChange={set('evidence')} placeholder="https://drive.google.com/..." />
        </Field>
      </div>
      <div className="pap-inline-actions"><span className="pap-spacer" /><button type="button" className="pap-btn" onClick={onCancel}>Batal</button><button type="submit" className="pap-primary-button" disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan progress'}</button></div>
    </form>
  )
}

// ---------- Pengaturan sheet & impor Excel (admin) ----------
function SheetSettings({ sheet, onClose, onChanged }: { sheet: { url: string; syncedAt: string | null }; onClose: () => void; onChanged: (text: string, warn?: string | null) => void }) {
  const [url, setUrl] = useState(sheet.url)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  async function save() {
    setBusy('save'); setError('')
    try { await api('/api/action-plan/sheet', { method: 'PUT', json: { url } }); setInfo('Link tersimpan.'); onChanged('Link Google Sheet Action Plan tersimpan.') } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }
  async function importFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy('import'); setError('')
    try {
      const body = new FormData()
      body.append('file', file)
      const r = await api<{ programBaru: number; programUbah: number; progress: number; issueBaru: number; issueUbah: number; kpi: number; tanpaId: number; warning: string | null }>('/api/action-plan/import', { method: 'POST', body })
      const text = `Impor ${file.name}: ${r.programBaru} program baru, ${r.programUbah} diperbarui, ${r.progress} catatan progress, ${r.issueBaru + r.issueUbah} issue, ${r.kpi} KPI.`
      setInfo(text)
      onChanged(text, r.warning)
    } catch (err) { setError((err as Error).message) } finally { setBusy('') }
  }
  return (
    <Modal title="Google Sheet & impor Excel" subtitle="Sinkron dua arah dengan template Plan Monitoring Program Kerja" onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Tutup</button></>}>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {info && <Notice kind="success" onClose={() => setInfo('')}>{info}</Notice>}
      <div className="pap-form-grid">
        <Field label="Link Google Sheet" full hint={sheet.syncedAt ? `Sinkron terakhir ${formatDate(sheet.syncedAt, true)}` : 'Belum pernah disinkron'}>
          <input className="pap-input" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." />
        </Field>
        <div className="full pap-inline-actions">
          <button className="pap-primary-button" disabled={busy === 'save' || url === sheet.url} onClick={save}>{busy === 'save' ? 'Menyimpan…' : 'Simpan link'}</button>
          {sheet.url && <a className="pap-btn" href={sheet.url} target="_blank" rel="noreferrer"><FileSpreadsheet /> Buka sheet</a>}
        </div>
        <div className="full pap-ap-steps">
          <b>Cara menautkan</b>
          <ol>
            <li>File Excel (.xlsm) di Drive tidak bisa diubah otomatis: buka file di Google Drive › <i>File › Simpan sebagai Google Spreadsheet</i>.</li>
            <li>Bagikan spreadsheet baru sebagai <b>Editor</b> ke akun Google yang terhubung di SIMPAP (Master Data › Hubungkan akun Google).</li>
            <li>Tempel link spreadsheet baru di atas, simpan, lalu klik <b>Sinkron Google Sheet</b>.</li>
          </ol>
          <p className="pap-muted">Setelah tertaut, setiap tambah / ubah program, update progress, batal / aktif kembali, issue, dan KPI di SIMPAP langsung ditulis ke tab Program Kerja, Progress Report, Issue Log, KPI, dan Timeline. Perubahan yang diketik langsung di sheet masuk ke SIMPAP saat Sinkron.</p>
        </div>
        <Field label="Impor dari file Excel (.xlsx / .xlsm)" full hint="Membaca tab Program Kerja, Progress Report, Issue Log, dan KPI dari template. Program dicocokkan lewat ID (PRG-001, ...).">
          <label className="pap-btn pap-ap-upload"><Upload /> {busy === 'import' ? 'Mengimpor…' : 'Pilih file Excel'}<input type="file" hidden accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12" onChange={importFile} disabled={!!busy} /></label>
        </Field>
      </div>
    </Modal>
  )
}
