'use client'

import { useCallback, useEffect, useState } from 'react'
import { Monitor, Search, Smartphone, Tablet, X } from 'lucide-react'
import { ACTIVITY_ACTIONS, ACTIVITY_MODULES, type ActivityAction, type ActivityChange, type DeviceType } from '@/lib/activity-types'
import { api, formatDate, Notice } from './ui'

type ActivityLog = {
  id: number
  actor_name: string
  module: string
  entity_label: string | null
  action: ActivityAction
  description: string
  changes: ActivityChange[] | null
  device: string | null
  device_type: DeviceType | null
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

const ACTION_TONE: Record<ActivityAction, string> = {
  create: 'success', update: 'info', delete: 'danger', upload: 'success', password: 'warning', permission: 'warning',
  checkin: 'info', import: 'success', sync: 'neutral', login: 'neutral', login_failed: 'danger', logout: 'neutral',
}
const DEVICE_ICON = { desktop: Monitor, mobile: Smartphone, tablet: Tablet, lainnya: Monitor }

export function UserActivityLog({ filterUser, onClearUser }: { filterUser: { id: number; name: string } | null; onClearUser: () => void }) {
  const [items, setItems] = useState<ActivityLog[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [action, setAction] = useState('')
  const [moduleName, setModuleName] = useState('')
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')

  // Pencarian dikirim setelah berhenti mengetik sebentar
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 350)
    return () => clearTimeout(t)
  }, [q])

  const load = useCallback(async (before?: number) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (moduleName) params.set('module', moduleName)
      if (action) params.set('action', action)
      if (term) params.set('q', term)
      if (filterUser) params.set('user', String(filterUser.id))
      if (before) params.set('before', String(before))
      const res = await api<{ items: ActivityLog[]; hasMore: boolean }>(`/api/users/activity?${params}`)
      setItems((list) => (before ? [...list, ...res.items] : res.items))
      setHasMore(res.hasMore)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [moduleName, action, term, filterUser])
  useEffect(() => { load() }, [load])

  return (
    <div className="pap-table-card">
      <div className="pap-card-head">
        <div><h2>Log aktivitas sistem</h2><p>Login, tambah, ubah, hapus data di semua modul, ganti password, dan ubah permission, beserta perangkat yang dipakai.</p></div>
      </div>
      {error && <div className="pap-activity-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
      <div className="pap-filters">
        <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari pelaku, data, perangkat, atau IP..." /></label>
        <select className="pap-select" value={moduleName} onChange={(e) => setModuleName(e.target.value)} aria-label="Filter modul">
          <option value="">Semua modul</option>
          {ACTIVITY_MODULES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select className="pap-select" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filter aktivitas">
          <option value="">Semua aktivitas</option>
          {Object.entries(ACTIVITY_ACTIONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        {filterUser && <button className="pap-chip pap-activity-filter" onClick={onClearUser}>User: {filterUser.name} <X /></button>}
      </div>
      <div className="pap-table-wrap">
        <table className="pap-activity-table">
          <thead><tr><th>Waktu</th><th>Pelaku</th><th>Modul</th><th>Aktivitas</th><th>Detail</th><th>Perangkat</th></tr></thead>
          <tbody>
            {items.map((log) => {
              const Icon = DEVICE_ICON[log.device_type ?? 'lainnya']
              return (
                <tr key={log.id}>
                  <td className="pap-nowrap">{formatDate(log.created_at, true)}</td>
                  <td><div className="pap-cell-title">{log.actor_name}</div></td>
                  <td className="pap-nowrap">{log.module}</td>
                  <td>
                    <span className={`pap-status ${ACTION_TONE[log.action]}`}>{ACTIVITY_ACTIONS[log.action]}</span>
                    {log.entity_label && <div className="pap-cell-sub">{log.entity_label}</div>}
                  </td>
                  <td>
                    <div>{log.description}</div>
                    {!!log.changes?.length && (
                      <ul className="pap-activity-changes">
                        {log.changes.map((c, i) => <li key={i}><strong>{c.field}:</strong> {c.from ?? '–'} → {c.to ?? '–'}</li>)}
                      </ul>
                    )}
                  </td>
                  <td>
                    <div className="pap-activity-device" title={log.user_agent ?? undefined}><Icon /> <span>{log.device ?? 'Tidak diketahui'}</span></div>
                    {log.ip_address && <div className="pap-cell-sub">IP {log.ip_address}</div>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!items.length && !loading && <div className="pap-empty">Belum ada aktivitas yang tercatat.</div>}
      </div>
      {hasMore && (
        <div className="pap-activity-more">
          <button className="pap-btn" disabled={loading} onClick={() => load(items[items.length - 1]?.id)}>{loading ? 'Memuat...' : 'Muat lebih banyak'}</button>
        </div>
      )}
    </div>
  )
}
