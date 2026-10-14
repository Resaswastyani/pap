'use client'

import { useEffect, useMemo, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { Eye, EyeOff, Search, X } from 'lucide-react'
import { PLANNING_STATUS, type PlanningStatus } from '@/lib/permissions'

// Panggil API JSON; lempar Error berisi pesan dari server bila gagal
export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init
  const res = await fetch(path, {
    ...rest,
    headers: json !== undefined ? { 'Content-Type': 'application/json', ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `Permintaan gagal (${res.status}).`)
  // Aksi yang mengubah data bisa membuat notifikasi baru (mis. meeting/planning dibuat): segarkan lonceng
  if (rest.method && rest.method !== 'GET' && !path.startsWith('/api/notifications')) window.dispatchEvent(new Event('pap-notif-refresh'))
  return data as T
}

export function Modal({ title, subtitle, onClose, children, footer, wide }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="pap-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`pap-modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="pap-modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="pap-icon-button" onClick={onClose} aria-label="Tutup"><X /></button>
        </div>
        <div className="pap-modal-body">{children}</div>
        {footer && <div className="pap-modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export type UserOption = { id: number; name: string; division_id: number; division_name: string }

// Pilih banyak user dikelompokkan per divisi (peserta meeting, PIC planning). lockedId (opsional) selalu terpilih.
export function UserPicker({ users, selected, lockedId = null, lockedLabel = '', noun, onChange }: { users: UserOption[]; selected: Set<number>; lockedId?: number | null; lockedLabel?: string; noun: string; onChange: (next: Set<number>) => void }) {
  const [term, setTerm] = useState('')
  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase()
    return users.filter((u) => !t || u.name.toLowerCase().includes(t) || u.division_name.toLowerCase().includes(t))
  }, [users, term])
  const groups = useMemo(() => {
    const map = new Map<string, UserOption[]>()
    for (const u of filtered) map.set(u.division_name, [...(map.get(u.division_name) ?? []), u])
    return [...map.entries()]
  }, [filtered])
  const toggle = (id: number) => {
    if (id === lockedId) return
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }
  const toggleGroup = (members: UserOption[]) => {
    const next = new Set(selected)
    const all = members.every((m) => next.has(m.id))
    for (const m of members) if (m.id !== lockedId) all ? next.delete(m.id) : next.add(m.id)
    onChange(next)
  }
  return (
    <div className="pap-picker">
      <label className="pap-filter-search pap-picker-search"><Search /><input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Cari nama atau divisi..." /></label>
      <div className="pap-picker-list">
        {groups.map(([divisionName, members]) => (
          <div key={divisionName} className="pap-picker-group">
            <button type="button" className="pap-picker-group-head" onClick={() => toggleGroup(members)}>{divisionName} <span>{members.filter((m) => selected.has(m.id)).length}/{members.length}</span></button>
            {members.map((u) => (
              <label key={u.id} className="pap-check">
                <input type="checkbox" checked={selected.has(u.id)} disabled={u.id === lockedId} onChange={() => toggle(u.id)} />
                <span>{u.name}{u.id === lockedId && <small className="pap-hint-inline"> ({lockedLabel})</small>}</span>
              </label>
            ))}
          </div>
        ))}
        {!groups.length && <p className="pap-muted">Tidak ada user yang cocok.</p>}
      </div>
      <small className="pap-hint">{selected.size} {noun} dipilih. Klik nama divisi untuk memilih satu divisi sekaligus.</small>
    </div>
  )
}

export function Field({ label, hint, children, full }: { label: string; hint?: string; children: ReactNode; full?: boolean }) {
  return (
    <label className={`pap-field ${full ? 'full' : ''}`}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}

// Input password dengan ikon mata untuk menampilkan/menyembunyikan isian
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false)
  return (
    <span className="pap-password-field">
      <input {...props} type={visible ? 'text' : 'password'} className={`pap-input ${props.className ?? ''}`} />
      <button type="button" className="pap-password-toggle" onClick={() => setVisible((v) => !v)} aria-label={visible ? 'Sembunyikan password' : 'Tampilkan password'} aria-pressed={visible}>
        {visible ? <EyeOff /> : <Eye />}
      </button>
    </span>
  )
}

export function Notice({ kind = 'error', children, onClose }: { kind?: 'error' | 'success'; children: ReactNode; onClose?: () => void }) {
  return (
    <div className={`pap-notice ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span>{children}</span>
      {onClose && <button onClick={onClose} aria-label="Tutup pesan"><X /></button>}
    </div>
  )
}

const STATUS_TONE: Record<PlanningStatus, string> = { belum_mulai: 'neutral', berjalan: 'info', selesai: 'success', ditunda: 'warning', dibatalkan: 'danger' }

export const StatusBadge = ({ value }: { value: PlanningStatus }) => <span className={`pap-status ${STATUS_TONE[value]}`}>{PLANNING_STATUS[value]}</span>

export function Progress({ value }: { value: number }) {
  return (
    <div className="pap-progress" aria-label={`Progress ${value}%`}>
      <div className="pap-progress-track"><div style={{ width: `${value}%` }} className={value >= 100 ? 'done' : ''} /></div>
      <span>{value}%</span>
    </div>
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
export function formatDate(value: string | null | undefined, withTime = false) {
  if (!value) return '—'
  const [date, time] = value.split(' ')
  const [y, m, d] = date.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}${withTime && time ? ` ${time.slice(0, 5)}` : ''}`
}

export function formatSize(bytes: number | null) {
  if (!bytes) return ''
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
