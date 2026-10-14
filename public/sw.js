// PAP-MS service worker: menerima Web Push, menampilkan pop-up notifikasi, dan menangani kliknya.
// Sengaja tidak meng-cache request apa pun.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

const ICON = '/icon-192.png'
const BADGE = '/icon-light-32x32.png'

// Push dikirim tanpa isi; ambil notifikasi yang belum tampil di perangkat ini dari server
async function showPending() {
  const subscription = await self.registration.pushManager.getSubscription()
  let items = []
  try {
    const res = await fetch('/api/push/pending', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription && subscription.endpoint }),
    })
    if (res.ok) items = (await res.json()).items || []
  } catch (e) {}

  // Browser mewajibkan setiap push menampilkan notifikasi
  if (!items.length) {
    const shown = await self.registration.getNotifications()
    if (shown.length) return
    return self.registration.showNotification('PAP-MS', { body: 'Ada notifikasi baru. Ketuk untuk membuka.', icon: ICON, badge: BADGE, tag: 'pap-generic' })
  }
  await Promise.all(
    items.reverse().map((item) =>
      self.registration.showNotification(item.title, {
        body: item.body || '',
        icon: ICON,
        badge: BADGE,
        tag: `pap-${item.id}`,
        renotify: true,
        vibrate: [200, 100, 200],
        requireInteraction: item.type === 'meeting_reminder',
        data: { meetingId: item.meeting_id, planningId: item.planning_id },
      }),
    ),
  )
}

self.addEventListener('push', (event) => event.waitUntil(showPending()))

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  const params = new URLSearchParams()
  if (data.meetingId) params.set('meeting', data.meetingId)
  else if (data.planningId) params.set('planning', data.planningId)
  const url = `/${params.size ? `?${params}` : ''}`

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const client = clients.find((c) => new URL(c.url).origin === self.location.origin)
      if (client) {
        client.postMessage({ type: 'pap-open', meetingId: data.meetingId, planningId: data.planningId })
        return client.focus()
      }
      return self.clients.openWindow(url)
    }),
  )
})
