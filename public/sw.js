// PAP-MS service worker: hanya untuk menampilkan & menangani klik pop-up notifikasi.
// Sengaja tidak meng-cache request apa pun.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

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
