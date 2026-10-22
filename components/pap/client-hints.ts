'use client'

// Model HP (mis. SM-A556E, CPH2591) dari browser untuk log aktivitas. Chrome Android menyamarkan model di User-Agent
// ("Android 10; K") dan header Client Hints tidak selalu terkirim, jadi nilainya diminta lewat navigator.userAgentData
// lalu dikirim sebagai header di setiap permintaan ke API. Merek laptop / PC tidak pernah dibuka browser.
type UaData = { getHighEntropyValues?: (hints: string[]) => Promise<{ model?: string; platformVersion?: string }> }

let cached: Record<string, string> | null = null
let pending: Promise<void> | null = null

function prime() {
  if (cached || pending || typeof navigator === 'undefined') return pending
  const uad = (navigator as Navigator & { userAgentData?: UaData }).userAgentData
  if (!uad?.getHighEntropyValues) {
    cached = {}
    return null
  }
  pending = uad.getHighEntropyValues(['model', 'platformVersion'])
    .then((v) => {
      cached = {}
      if (v.model) cached['X-UA-Model'] = encodeURIComponent(v.model.slice(0, 100))
      if (v.platformVersion) cached['X-UA-Platform-Version'] = encodeURIComponent(v.platformVersion.slice(0, 20))
    })
    .catch(() => { cached = {} })
  return pending
}

export async function clientHintHeaders(): Promise<Record<string, string>> {
  if (!cached) await prime()
  return cached ?? {}
}
