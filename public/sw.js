// PAP-MS service worker: menerima Web Push, menampilkan pop-up notifikasi, dan menangani kliknya.
// Sengaja tidak meng-cache request apa pun.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

const ICON = '/icon-192.png'
// Badge Android (ikon kecil di status bar): siluet logo putih di atas latar transparan
const BADGE = '/notification-badge.png'

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
        requireInteraction: item.type === 'meeting_reminder' || item.type === 'visit_reminder',
        data: { meetingId: item.meeting_id, planningId: item.planning_id, prospectId: item.prospect_id, visitId: item.visit_id, sampleId: item.sample_id, designId: item.design_id, customerId: item.customer_id, paymentId: item.payment_id, quotationId: item.quotation_id },
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
  else if (data.visitId) params.set('visit', data.visitId)
  else if (data.prospectId) params.set('prospek', data.prospectId)
  else if (data.sampleId) params.set('sample', data.sampleId)
  else if (data.designId) params.set('desain', data.designId)
  else if (data.customerId) params.set('customer', data.customerId)
  else if (data.paymentId) params.set('bayar', data.paymentId)
  else if (data.quotationId) params.set('quotation', data.quotationId)
  const url = `/${params.size ? `?${params}` : ''}`

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const client = clients.find((c) => new URL(c.url).origin === self.location.origin)
      if (client) {
        client.postMessage({ type: 'pap-open', meetingId: data.meetingId, planningId: data.planningId, prospectId: data.prospectId, visitId: data.visitId, sampleId: data.sampleId, designId: data.designId, customerId: data.customerId, paymentId: data.paymentId, quotationId: data.quotationId })
        return client.focus()
      }
      return self.clients.openWindow(url)
    }),
  )
})
