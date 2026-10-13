'use client'

import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { PLANNING_APPROVAL, PLANNING_STATUS, type PlanningApproval, type PlanningStatus } from '@/lib/permissions'

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

export function Field({ label, hint, children, full }: { label: string; hint?: string; children: ReactNode; full?: boolean }) {
  return (
    <label className={`pap-field ${full ? 'full' : ''}`}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
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
const APPROVAL_TONE: Record<PlanningApproval, string> = { menunggu: 'warning', disetujui: 'success', ditolak: 'danger' }

export const StatusBadge = ({ value }: { value: PlanningStatus }) => <span className={`pap-status ${STATUS_TONE[value]}`}>{PLANNING_STATUS[value]}</span>
export const ApprovalBadge = ({ value }: { value: PlanningApproval }) => <span className={`pap-status ${APPROVAL_TONE[value]}`}>{PLANNING_APPROVAL[value]}</span>

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
