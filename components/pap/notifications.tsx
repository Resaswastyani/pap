'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, BellRing, CalendarClock, CalendarDays, CheckCircle2, ClipboardCheck, ClipboardList, FileText, FlaskConical, MapPin, Palette, PhoneCall, Repeat, Wallet, Smartphone, UserPlus, Wrench, X } from 'lucide-react'
import { api } from './ui'

export type NotificationTarget = { meetingId?: number | null; planningId?: number | null; prospectId?: number | null; visitId?: number | null; sampleId?: number | null; designId?: number | null; customerId?: number | null; paymentId?: number | null; quotationId?: number | null; repairId?: number | null; page?: string | null; pageId?: number | null }

type Item = {
  id: number
  type: 'meeting_baru' | 'meeting_diubah' | 'meeting_reminder' | 'planning_pic' | 'planning_baru' | 'sistem' | 'prospek_baru' | 'visit_reminder' | 'followup_due' | 'sample_update' | 'desain_update' | 'repeat_order' | 'pembayaran' | 'quotation' | 'perbaikan_mesin'
  title: string
  body: string | null
  meeting_id: number | null
  planning_id: number | null
  prospect_id: number | null
  visit_id: number | null
  sample_id: number | null
  design_id: number | null
  customer_id: number | null
  payment_id: number | null
  quotation_id: number | null
  repair_id: number | null
  target_page: string | null
  target_id: number | null
  read_at: string | null
  created_at: string
}

const POLL_MS = 30_000
const TOAST_MS = 15_000
const ICONS = { meeting_baru: CalendarDays, meeting_diubah: CalendarDays, meeting_reminder: CalendarClock, planning_pic: ClipboardList, planning_baru: ClipboardCheck, sistem: BellRing, prospek_baru: UserPlus, visit_reminder: MapPin, followup_due: PhoneCall, sample_update: FlaskConical, desain_update: Palette, repeat_order: Repeat, pembayaran: Wallet, quotation: FileText, perbaikan_mesin: Wrench }

// Dipanggil setelah aksi yang mungkin membuat notifikasi (lihat api() di ui.tsx) agar lonceng langsung diperbarui
export const REFRESH_EVENT = 'pap-notif-refresh'

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
const pushSupported = () => osSupported() && 'serviceWorker' in navigator && 'PushManager' in window
// iPhone/iPad: push hanya bisa bila aplikasi dibuka dari ikon Home Screen (mode standalone)
const isIos = () => typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent)
const isStandalone = () => typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true)

function urlBase64ToUint8Array(value: string) {
  const base64 = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

// Daftarkan perangkat ini ke Web Push dan simpan langganannya di server (untuk user yang sedang login)
export async function subscribePush() {
  if (!pushSupported() || Notification.permission !== 'granted') return false
  const config = await api<{ enabled: boolean; publicKey: string }>('/api/push/subscribe')
  if (!config.enabled) throw new Error('Server belum dikonfigurasi untuk notifikasi HP (VAPID belum diisi di Vercel).')
  const registration = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(config.publicKey) }))
  await api('/api/push/subscribe', { method: 'POST', json: subscription.toJSON() })
  return true
}

// Saat logout: perangkat ini berhenti menerima notifikasi akun tersebut
export async function unsubscribePush() {
  try {
    const registration = await navigator.serviceWorker?.getRegistration()
    const subscription = await registration?.pushManager.getSubscription()
    if (!subscription) return
    await fetch('/api/push/subscribe', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: subscription.endpoint }) })
    await subscription.unsubscribe()
  } catch {}
}

// Pop-up sistem operasi. Lewat service worker bila ada (wajib di Android), selain itu Notification biasa.
async function showOsNotification(item: Item) {
  if (!osSupported() || Notification.permission !== 'granted') return
  const options: NotificationOptions = {
    body: item.body ?? undefined,
    tag: `pap-${item.id}`,
    icon: '/icon-192.png',
    badge: '/notification-badge.png',
    data: { meetingId: item.meeting_id, planningId: item.planning_id, prospectId: item.prospect_id, visitId: item.visit_id, sampleId: item.sample_id, designId: item.design_id, customerId: item.customer_id, paymentId: item.payment_id, quotationId: item.quotation_id, repairId: item.repair_id, page: item.target_page, pageId: item.target_id },
    requireInteraction: item.type === 'meeting_reminder',
  }
  try {
    const registration = await navigator.serviceWorker?.getRegistration()
    if (registration) return await registration.showNotification(item.title, options)
    new Notification(item.title, options)
  } catch {}
}

const BANNER_KEY = 'pap-push-banner-dismissed'
const bannerDismissed = () => {
  try {
    return Date.now() - Number(localStorage.getItem(BANNER_KEY) || 0) < 3 * 864e5 // muncul lagi setelah 3 hari
  } catch {
    return false
  }
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
  const [pushActive, setPushActive] = useState(false)
  const [iosNeedsInstall, setIosNeedsInstall] = useState(false)
  const [enabling, setEnabling] = useState(false)
  const [pushError, setPushError] = useState('')
  const [testing, setTesting] = useState('')
  const [showBanner, setShowBanner] = useState(false)
  const pushActiveRef = useRef(false)
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
        // Bila push aktif, pop-up perangkat sudah ditampilkan service worker (hindari dobel)
        if (!pushActiveRef.current && (document.visibilityState !== 'visible' || item.type === 'meeting_reminder')) showOsNotification(item)
      }
    } catch {}
  }, [userId, dismissToast])

  useEffect(() => {
    const current = osSupported() ? Notification.permission : 'unsupported'
    const iosInstall = isIos() && !isStandalone()
    setPermission(current)
    setIosNeedsInstall(iosInstall)
    // Ajak aktifkan notifikasi setelah login bila belum pernah diputuskan di perangkat ini
    setShowBanner(!bannerDismissed() && (iosInstall || (current === 'default' && pushSupported())))
    navigator.serviceWorker?.register('/sw.js').catch(() => {})
    // Izin sudah diberikan sebelumnya: pastikan langganan perangkat ini tercatat untuk akun yang login
    subscribePush()
      .then((ok) => setPushActive((pushActiveRef.current = ok)))
      .catch((e) => setPushError((e as Error).message || 'Gagal menghubungkan notifikasi HP.'))
    poll()
    const timer = setInterval(poll, POLL_MS)
    const onVisible = () => document.visibilityState === 'visible' && poll()
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    const onRefresh = () => {
      clearTimeout(refreshTimer)
      refreshTimer = setTimeout(poll, 800)
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener(REFRESH_EVENT, onRefresh)
    return () => {
      clearInterval(timer)
      clearTimeout(refreshTimer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener(REFRESH_EVENT, onRefresh)
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
    onOpen({ meetingId: item.meeting_id, planningId: item.planning_id, prospectId: item.prospect_id, visitId: item.visit_id, sampleId: item.sample_id, designId: item.design_id, customerId: item.customer_id, paymentId: item.payment_id, quotationId: item.quotation_id, repairId: item.repair_id, page: item.target_page, pageId: item.target_id })
  }

  async function enableOs() {
    if (!osSupported()) return
    setEnabling(true)
    setPushError('')
    try {
      const result = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
      setPermission(result)
      if (result === 'granted') {
        const ok = await subscribePush()
        setPushActive((pushActiveRef.current = ok))
        setShowBanner(false)
        const registration = await navigator.serviceWorker?.getRegistration()
        registration?.showNotification('Notifikasi PAP-MS aktif', { body: 'Pemberitahuan meeting dan planning akan muncul di perangkat ini.', icon: '/icon-192.png', badge: '/notification-badge.png', tag: 'pap-welcome' })
      }
    } catch (e) {
      setPushError((e as Error).message || 'Gagal mengaktifkan notifikasi.')
    } finally {
      setEnabling(false)
    }
  }

  async function sendTest() {
    setTesting('Mengirim...')
    try {
      const res = await api<{ devices: number }>('/api/push/test', { method: 'POST' })
      setTesting(res.devices ? `Terkirim ke ${res.devices} perangkat. Cek layar HP/laptop dalam beberapa detik.` : 'Belum ada perangkat terdaftar untuk akun ini.')
    } catch (e) {
      setTesting((e as Error).message)
    }
  }

  function dismissBanner() {
    setShowBanner(false)
    try {
      localStorage.setItem(BANNER_KEY, String(Date.now()))
    } catch {}
  }

  const iosHint = <><Smartphone className="pap-inline-icon" /> Di iPhone: ketuk <strong>Share</strong> lalu <strong>Add to Home Screen</strong>, buka PAP-MS dari ikon tersebut, kemudian aktifkan notifikasi.</>

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
            {iosNeedsInstall ? (
              <p className="pap-notif-hint">{iosHint}</p>
            ) : permission === 'unsupported' ? (
              <p className="pap-notif-hint">Browser ini tidak mendukung notifikasi. Gunakan Chrome (Android/PC) atau buka dari ikon Home Screen (iPhone).</p>
            ) : permission === 'denied' ? (
              <p className="pap-notif-hint">Notifikasi diblokir browser. Izinkan notifikasi untuk situs ini di pengaturan browser, lalu muat ulang halaman.</p>
            ) : pushActive ? (
              <div className="pap-notif-status">
                <p className="pap-notif-hint ok"><CheckCircle2 className="pap-inline-icon" /> Notifikasi aktif di perangkat ini, termasuk saat aplikasi ditutup.</p>
                <button className="pap-link-button" onClick={sendTest}>Kirim notifikasi uji</button>
                {testing && <small className="pap-notif-test">{testing}</small>}
              </div>
            ) : (
              <button className="pap-notif-enable" onClick={enableOs} disabled={enabling}><BellRing /> {enabling ? 'Mengaktifkan...' : permission === 'granted' ? 'Hubungkan notifikasi HP / perangkat ini' : 'Aktifkan notifikasi di HP / perangkat ini'}</button>
            )}
            {pushError && <p className="pap-notif-hint error">{pushError}</p>}
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
      {showBanner && (
        <div className="pap-push-banner" role="dialog" aria-label="Aktifkan notifikasi">
          <span className="pap-notif-icon sistem"><BellRing /></span>
          <div className="pap-push-banner-text">
            <strong>Aktifkan notifikasi di perangkat ini</strong>
            <small>{iosNeedsInstall ? iosHint : 'Pemberitahuan meeting baru & reminder 15 menit akan muncul di layar HP seperti pesan WhatsApp.'}</small>
            {pushError && <small className="error">{pushError}</small>}
          </div>
          <div className="pap-push-banner-actions">
            {!iosNeedsInstall && <button className="pap-primary-button" onClick={enableOs} disabled={enabling}>{enabling ? 'Mengaktifkan...' : 'Aktifkan'}</button>}
            <button className="pap-btn" onClick={dismissBanner}>Nanti</button>
          </div>
        </div>
      )}
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
