import { createHash } from 'crypto'
import { fail, handle, readJson, requireUser, str } from '@/lib/api'

// Suara notifikasi dari server (Gemini TTS): dipakai bila browser / perangkat tidak punya suara bahasa Indonesia.
// Suara perempuan bahasa Indonesia; hasil di-cache di memori (satu notifikasi meeting dibacakan ke banyak peserta).
const URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const MODELS = [process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts']
const VOICE = process.env.GEMINI_TTS_VOICE || 'Kore'
const cache = new Map<string, { audio: Buffer; type: string; at: number }>()
const CACHE_MAX = 40
const CACHE_MS = 2 * 3600e3
const hits = new Map<number, number[]>()

// PCM 16-bit mono -> WAV (sebagian model mengirim audio/L16 mentah)
function wav(pcm: Buffer, rate: number) {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12)
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24)
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}

async function synthesize(text: string) {
  let lastError = ''
  for (const model of MODELS) {
    const res = await fetch(`${URL_BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY! },
      body: JSON.stringify({
        // Teks polos (tanpa kalimat instruksi agar tidak ikut dibacakan); suara perempuan dari voiceName
        contents: [{ parts: [{ text }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } } },
      }),
      signal: AbortSignal.timeout(20_000),
    }).catch((e: Error) => { lastError = e.message; return null })
    if (!res) continue
    const json = (await res.json().catch(() => ({}))) as { candidates?: { content?: { parts?: { inlineData?: { mimeType: string; data: string } }[] } }[]; error?: { message?: string } }
    const data = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData
    if (res.ok && data) {
      const raw = Buffer.from(data.data, 'base64')
      if (/wav|wave/i.test(data.mimeType)) return { audio: raw, type: 'audio/wav' }
      const rate = Number(/rate=(\d+)/.exec(data.mimeType)?.[1]) || 24000
      return { audio: wav(raw, rate), type: 'audio/wav' }
    }
    lastError = json.error?.message ?? `HTTP ${res.status}`
  }
  console.error('[tts]', lastError)
  return null
}

// POST { text } -> audio/wav
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  if (!process.env.GEMINI_API_KEY) fail(503, 'Suara server belum dikonfigurasi.')
  const text = str((await readJson(request)).text, 400) || fail(400, 'Teks kosong.')
  // Batas wajar per pengguna: 30 permintaan / 10 menit
  const now = Date.now()
  const recent = (hits.get(user.id) ?? []).filter((t) => now - t < 600_000)
  if (recent.length >= 30) fail(429, 'Terlalu banyak permintaan suara, coba lagi nanti.')
  hits.set(user.id, [...recent, now])

  const key = createHash('sha256').update(`${VOICE}|${text}`).digest('hex')
  let item = cache.get(key)
  if (!item || now - item.at > CACHE_MS) {
    const out = await synthesize(text!)
    if (!out) fail(502, 'Suara tidak tersedia saat ini.')
    item = { ...out!, at: now }
    cache.set(key, item)
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!)
  }
  return new Response(new Uint8Array(item.audio), { headers: { 'Content-Type': item.type, 'Cache-Control': 'private, max-age=7200' } })
})
