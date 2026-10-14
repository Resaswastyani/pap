'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, BellRing, CalendarClock, CalendarDays, ClipboardList, X } from 'lucide-react'
import { api } from './ui'

export type NotificationTarget = { meetingId?: number | null; planningId?: number | null }

type Item = {
  id: number
  type: 'meeting_baru' | 'meeting_diubah' | 'meeting_reminder' | 'planning_pic'
  title: string
  body: string | null
  meeting_id: number | null
  planning_id: number | null
  read_at: string | null
  created_at: string
}

const POLL_MS = 30_000
const TOAST_MS = 15_000
const ICONS = { meeting_baru: CalendarDays, meeting_diubah: CalendarDays, meeting_reminder: CalendarClock, planning_pic: ClipboardList }

const storageKey = (userId: number) => `pap-notif-last-${userId}`
function readLastSeen(userId: number) {
  try {
    const value = localStorage.getItem(storageKey(userId))
    return value === null ? null : Number(value)
  } catch {
    return null
  }
}
function writeLastSeen(userId: number, id: number) {
  try {
    localStorage.setItem(storageKey(userId), String(id))
  } catch {}
}

const osSupported = () => typeof window !== 'undefined' && 'Notification' in window

// Pop-up sistem operasi. Lewat service worker bila ada (wajib di Android), selain itu Notification biasa.
async function showOsNotification(item: Item) {
  if (!osSupported() || Notification.permission !== 'granted') return
  const options: NotificationOptions = {
    body: item.body ?? undefined,
    tag: `pap-${item.id}`,
    icon: '/apple-icon.png',
    badge: '/icon-light-32x32.png',
    data: { meetingId: item.meeting_id, planningId: item.planning_id },
    requireInteraction: item.type === 'meeting_reminder',
  }
  try {
    const registration = await navigator.serviceWorker?.getRegistration()
    if (registration) return await registration.showNotification(item.title, options)
    new Notification(item.title, options)
  } catch {}
}

const relative = (value: string) => {
  const diff = (Date.now() - new Date(value.replace(' ', 'T') + '+07:00').getTime()) / 60000
  if (diff < 1) return 'baru saja'
  if (diff < 60) return `${Math.floor(diff)} menit lalu`
  if (diff < 1440) return `${Math.floor(diff / 60)} jam lalu`
  return `${Math.floor(diff / 1440)} hari lalu`
}

export function NotificationCenter({ userId, onOpen }: { userId: number; onOpen: (target: NotificationTarget) => void }) {
  const [items, setItems] = useState<Item[]>([])
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const [toasts, setToasts] = useState<Item[]>([])
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('unsupported')
  const lastSeen = useRef<number | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const dismissToast = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), [])

  const poll = useCallback(async () => {
    try {
      const res = await api<{ items: Item[]; unread: number }>('/api/notifications')
      setItems(res.items)
      setUnread(res.unread)
      const maxId = res.items.reduce((max, item) => Math.max(max, item.id), 0)
      // Kunjungan pertama di perangkat ini: jangan banjiri pop-up dengan notifikasi lama
      if (lastSeen.current === null) lastSeen.current = readLastSeen(userId) ?? maxId
      const fresh = res.items.filter((item) => item.id > lastSeen.current! && !item.read_at).reverse()
      if (maxId > lastSeen.current) {
        lastSeen.current = maxId
        writeLastSeen(userId, maxId)
      }
      for (const item of fresh) {
        setToasts((list) => [...list.filter((t) => t.id !== item.id), item].slice(-3))
        // Reminder tetap tampil sampai ditutup; jenis lain hilang sendiri
        if (item.type !== 'meeting_reminder') setTimeout(() => dismissToast(item.id), TOAST_MS)
        if (document.visibilityState !== 'visible' || item.type === 'meeting_reminder') showOsNotification(item)
      }
    } catch {}
  }, [userId, dismissToast])

  useEffect(() => {
    setPermission(osSupported() ? Notification.permission : 'unsupported')
    navigator.serviceWorker?.register('/sw.js').catch(() => {})
    poll()
    const timer = setInterval(poll, POLL_MS)
    const onVisible = () => document.visibilityState === 'visible' && poll()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [poll])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !panelRef.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  async function markRead(body: { ids: number[] } | { all: true }) {
    await api('/api/notifications/read', { method: 'POST', json: body }).catch(() => {})
    poll()
  }

  function activate(item: Item) {
    if (!item.read_at) markRead({ ids: [item.id] })
    dismissToast(item.id)
    setOpen(false)
    onOpen({ meetingId: item.meeting_id, planningId: item.planning_id })
  }

  async function enableOs() {
    if (!osSupported()) return
    setPermission(await Notification.requestPermission())
  }

  return (
    <>
      <div className="pap-notif" ref={panelRef}>
        <button className="pap-icon-button" aria-label={`Notifikasi${unread ? `, ${unread} belum dibaca` : ''}`} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <Bell />
          {unread > 0 && <span className="pap-notif-count">{unread > 9 ? '9+' : unread}</span>}
        </button>
        {open && (
          <div className="pap-notif-panel" role="dialog" aria-label="Notifikasi">
            <div className="pap-notif-head">
              <strong>Notifikasi</strong>
              {unread > 0 && <button className="pap-link-button" onClick={() => markRead({ all: true })}>Tandai semua dibaca</button>}
            </div>
            {permission === 'default' && (
              <button className="pap-notif-enable" onClick={enableOs}><BellRing /> Aktifkan pop-up notifikasi di perangkat ini</button>
            )}
            {permission === 'denied' && <p className="pap-notif-hint">Pop-up diblokir browser. Izinkan notifikasi untuk situs ini di pengaturan browser.</p>}
            <ul className="pap-notif-list">
              {items.map((item) => {
                const Icon = ICONS[item.type]
                return (
                  <li key={item.id}>
                    <button className={item.read_at ? '' : 'unread'} onClick={() => activate(item)}>
                      <span className={`pap-notif-icon ${item.type}`}><Icon /></span>
                      <span className="pap-notif-text"><strong>{item.title}</strong>{item.body && <small>{item.body}</small>}<time>{relative(item.created_at)}</time></span>
                    </button>
                  </li>
                )
              })}
              {!items.length && <li className="pap-notif-empty">Belum ada notifikasi.</li>}
            </ul>
          </div>
        )}
      </div>
      {toasts.length > 0 && (
        <div className="pap-toasts" aria-live="polite">
          {toasts.map((item) => {
            const Icon = ICONS[item.type]
            return (
              <div key={item.id} className={`pap-toast ${item.type}`}>
                <button className="pap-toast-main" onClick={() => activate(item)}>
                  <span className={`pap-notif-icon ${item.type}`}><Icon /></span>
                  <span className="pap-notif-text"><strong>{item.title}</strong>{item.body && <small>{item.body}</small>}</span>
                </button>
                <button className="pap-toast-close" aria-label="Tutup" onClick={() => dismissToast(item.id)}><X /></button>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
