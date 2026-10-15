'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarCheck, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, MapPin, Navigation, Plus } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { CheckinForm, localDate, mapsSearch, VISIT_LABEL, VISIT_TYPE_LABEL, VisitBadge, VisitDetail, VisitForm, type MarketingUser, type Visit } from './marketing'
import { api, formatDate, Notice } from './ui'

const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']

// Senin dari minggu yang memuat tanggal d
const startOfWeek = (d: Date) => {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7))
  return r
}
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

export function VisitPage({ user, focusId, onOpenProspect }: { user: UserProfile; focusId?: number | null; onOpenProspect: (id: number) => void }) {
  const [week, setWeek] = useState(() => startOfWeek(new Date()))
  const [items, setItems] = useState<Visit[]>([])
  const [stats, setStats] = useState({ today: 0, pending: 0, done_month: 0, missed: 0 })
  const [users, setUsers] = useState<MarketingUser[]>([])
  const [canSupervise, setCanSupervise] = useState(false)
  const [sales, setSales] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState<Visit | 'new' | null>(null)
  const [detail, setDetail] = useState<Visit | null>(null)
  const [checkin, setCheckin] = useState<Visit | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ from: localDate(week), to: localDate(addDays(week, 6)) })
      if (sales) params.set('sales', sales)
      if (status) params.set('status', status)
      const res = await api<{ items: Visit[]; stats: typeof stats; users: MarketingUser[]; canSupervise: boolean }>(`/api/visits?${params}`)
      setItems(res.items)
      setStats(res.stats)
      setUsers(res.users)
      setCanSupervise(res.canSupervise)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [week, sales, status])
  useEffect(() => { load() }, [load])

  // Dibuka dari notifikasi: tampilkan detail visit + pindah ke minggunya
  useEffect(() => {
    if (!focusId) return
    api<{ item: Visit }>(`/api/visits/${focusId}`).then((res) => {
      setWeek(startOfWeek(new Date(res.item.jadwal.replace(' ', 'T'))))
      setDetail(res.item)
    }).catch((e) => setError(e.message))
  }, [focusId])

  const flash = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 5000)
    load()
  }
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week])
  const todayKey = localDate(new Date())
  const byDay = useMemo(() => {
    const map = new Map<string, Visit[]>()
    for (const v of items) map.set(v.jadwal.slice(0, 10), [...(map.get(v.jadwal.slice(0, 10)) ?? []), v])
    return map
  }, [items])
  const isOverdue = (v: Visit) => v.status === 'terjadwal' && new Date(v.jadwal.replace(' ', 'T')).getTime() < Date.now() - 3600e3
  const canCheckin = (v: Visit) => v.status === 'terjadwal' && (v.sales_id === user.id || user.role.isAdmin)

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">MARKETING</p>
          <h1>Jadwal Visit</h1>
          <span>Jadwal kunjungan sales ke prospek & customer, dengan check-in lokasi GPS dan foto bukti di lokasi.</span>
        </div>
        <button className="pap-primary-button" onClick={() => setForm('new')}><Plus /> Jadwalkan visit</button>
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      <div className="pap-stat-grid four">
        <div className="pap-stat-card"><div><span>Visit hari ini</span><strong>{stats.today}</strong><small className="neutral">Belum check-in</small></div><div className="pap-stat-icon stat-1"><CalendarDays /></div></div>
        <div className="pap-stat-card"><div><span>Akan datang</span><strong>{stats.pending}</strong><small className="neutral">Jadwal terjadwal</small></div><div className="pap-stat-icon stat-1"><CalendarCheck /></div></div>
        <div className="pap-stat-card"><div><span>Selesai bulan ini</span><strong>{stats.done_month}</strong><small className="neutral">Sudah check-in</small></div><div className="pap-stat-icon stat-0"><CheckCircle2 /></div></div>
        <div className="pap-stat-card"><div><span>Belum dilaporkan</span><strong>{stats.missed}</strong><small className="neutral">Lewat jadwal, belum check-in</small></div><div className="pap-stat-icon stat-2"><AlertTriangle /></div></div>
      </div>
      <div className="pap-table-card">
        <div className="pap-calendar-bar pap-visit-bar">
          <div className="pap-calendar-nav">
            <button className="pap-icon-button" aria-label="Minggu sebelumnya" onClick={() => setWeek((w) => addDays(w, -7))}><ChevronLeft /></button>
            <button className="pap-btn" onClick={() => setWeek(startOfWeek(new Date()))}>Minggu ini</button>
            <button className="pap-icon-button" aria-label="Minggu berikutnya" onClick={() => setWeek((w) => addDays(w, 7))}><ChevronRight /></button>
            <h3>{formatDate(localDate(week))} – {formatDate(localDate(addDays(week, 6)))}</h3>
          </div>
          <div className="pap-inline-actions">
            {canSupervise && (
              <select className="pap-select" value={sales} onChange={(e) => setSales(e.target.value)} aria-label="Filter sales">
                <option value="">Semua sales</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            )}
            <select className="pap-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter status">
              <option value="">Semua status</option>
              {Object.entries(VISIT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
        </div>
        {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <div className={`pap-visit-days ${loading ? 'loading' : ''}`}>
          {days.map((d) => {
            const key = localDate(d)
            const list = byDay.get(key) ?? []
            return (
              <section key={key} className={`pap-visit-day ${key === todayKey ? 'today' : ''} ${list.length ? '' : 'empty'}`}>
                <header><strong>{DAY_NAMES[d.getDay()]}</strong><span>{formatDate(key)}</span>{key === todayKey && <span className="pap-chip">Hari ini</span>}</header>
                {list.map((v) => (
                  <article key={v.id} className={`pap-visit-card ${v.status} ${isOverdue(v) ? 'overdue' : ''}`} onClick={() => setDetail(v)}>
                    <div className="pap-visit-time">{v.jadwal.slice(11, 16)}</div>
                    <div className="pap-visit-main">
                      <strong>{v.target_name ?? '—'}</strong>
                      <small>{VISIT_TYPE_LABEL[v.jenis]}{canSupervise ? ` · ${v.sales_name}` : ''}{v.kontak_nama ? ` · ${v.kontak_nama}` : ''}</small>
                      {v.alamat && <small className="pap-visit-addr"><MapPin className="pap-inline-icon" /> {v.alamat}</small>}
                      {v.tujuan && <span className="pap-clamp">{v.tujuan}</span>}
                    </div>
                    <div className="pap-visit-actions" onClick={(e) => e.stopPropagation()}>
                      {isOverdue(v) ? <span className="pap-status danger">Belum dilaporkan</span> : <VisitBadge value={v.status} />}
                      {v.alamat && v.status === 'terjadwal' && <a className="pap-icon-button" href={mapsSearch(v.alamat)} target="_blank" rel="noreferrer" aria-label="Navigasi ke lokasi" title="Buka Google Maps"><Navigation /></a>}
                      {canCheckin(v) && <button className="pap-primary-button" onClick={() => setCheckin(v)}><CheckCircle2 /> Check-in</button>}
                    </div>
                  </article>
                ))}
                {!list.length && <p className="pap-muted">Tidak ada jadwal.</p>}
              </section>
            )
          })}
        </div>
      </div>
      {form && (
        <VisitForm
          initial={form === 'new' ? null : form}
          users={users}
          canSupervise={canSupervise}
          currentUserId={user.id}
          onClose={() => setForm(null)}
          onSaved={(text) => { setForm(null); setDetail(null); flash(text) }}
        />
      )}
      {detail && !checkin && !form && (
        <VisitDetail
          visit={detail}
          currentUserId={user.id}
          canSupervise={canSupervise}
          isAdmin={user.role.isAdmin}
          onClose={() => setDetail(null)}
          onCheckin={() => setCheckin(detail)}
          onEdit={() => setForm(detail)}
          onChanged={(text) => { setDetail(null); flash(text) }}
          onOpenProspect={onOpenProspect}
        />
      )}
      {checkin && <CheckinForm visit={checkin} onClose={() => setCheckin(null)} onSaved={(text) => { setCheckin(null); setDetail(null); flash(text) }} />}
    </>
  )
}
