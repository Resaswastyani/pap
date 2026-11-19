// PAP AI: penyedia AI tambahan (Claude & ChatGPT) di samping Gemini, kunci API, dan pemilihan model otomatis.
// Kunci API dibaca dari env (ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY) atau dari Pengaturan > IT
// (disimpan terenkripsi di app_settings, kunci turunan AUTH_SECRET). Nilai kunci tidak pernah dikirim ke browser.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import type { RowDataPacket } from 'mysql2'
import { fail } from '@/lib/api'
import { db } from '@/lib/db'

export type AiProvider = 'gemini' | 'claude' | 'openai'
export const PROVIDERS: Record<AiProvider, { label: string; env: string; defaultModel: string; modelEnv: string }> = {
  gemini: { label: 'Gemini', env: 'GEMINI_API_KEY', defaultModel: 'gemini-3.5-flash', modelEnv: 'GEMINI_MODEL' },
  claude: { label: 'Claude', env: 'ANTHROPIC_API_KEY', defaultModel: 'claude-opus-5-5', modelEnv: 'CLAUDE_MODEL' },
  openai: { label: 'ChatGPT', env: 'OPENAI_API_KEY', defaultModel: 'gpt-5', modelEnv: 'OPENAI_MODEL' },
}

// ---- Penyimpanan kunci terenkripsi ----
const cryptoKey = () => createHash('sha256').update(`${process.env.AUTH_SECRET ?? ''}:pap-ai-keys`).digest()
function encrypt(text: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', cryptoKey(), iv)
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.')
}
function decrypt(value: string) {
  const [iv, tag, data] = value.split('.').map((p) => Buffer.from(p, 'base64'))
  const decipher = createDecipheriv('aes-256-gcm', cryptoKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

type Stored = { keys: Partial<Record<AiProvider, string>>; models: Partial<Record<AiProvider, string>> }
const cache = globalThis as unknown as { papAiConfig?: { at: number; value: Stored } }
async function stored(): Promise<Stored> {
  if (cache.papAiConfig && Date.now() - cache.papAiConfig.at < 30_000) return cache.papAiConfig.value
  const [rows] = await db.query<(RowDataPacket & { key: string; value: string | null })[]>("SELECT `key`, value FROM app_settings WHERE `key` LIKE 'ai.%'")
  const value: Stored = { keys: {}, models: {} }
  for (const r of rows) {
    const m = String(r.key).match(/^ai\.(key|model)\.(gemini|claude|openai)$/)
    if (!m || !r.value) continue
    if (m[1] === 'key') {
      try { value.keys[m[2] as AiProvider] = decrypt(r.value) } catch { /* AUTH_SECRET berubah: kunci perlu diisi ulang */ }
    } else value.models[m[2] as AiProvider] = r.value
  }
  cache.papAiConfig = { at: Date.now(), value }
  return value
}

export async function aiKey(p: AiProvider) {
  return process.env[PROVIDERS[p].env]?.trim() || (await stored()).keys[p] || null
}
export async function aiModel(p: AiProvider) {
  return (await stored()).models[p] || process.env[PROVIDERS[p].modelEnv]?.trim() || PROVIDERS[p].defaultModel
}

// Status untuk Pengaturan > IT (tanpa nilai kunci)
export async function aiStatus() {
  const s = await stored()
  return Promise.all((Object.keys(PROVIDERS) as AiProvider[]).map(async (p) => ({
    provider: p, label: PROVIDERS[p].label, model: await aiModel(p),
    configured: !!(await aiKey(p)), source: process.env[PROVIDERS[p].env]?.trim() ? 'env' : s.keys[p] ? 'pengaturan' : null,
  })))
}

export async function saveAiKey(p: AiProvider, key: string | null, model: string | null, userId: number) {
  if (!(p in PROVIDERS)) fail(400, 'Penyedia AI tidak dikenal.')
  if (key !== null) {
    const k = key.trim()
    if (k && (k.length < 20 || /\s/.test(k))) fail(400, 'Format kunci API tidak valid.')
    await db.query('INSERT INTO app_settings (`key`, value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)', [`ai.key.${p}`, k ? encrypt(k) : '', userId])
  }
  if (model !== null) {
    const m = model.trim()
    if (m && !/^[a-zA-Z0-9._:-]{3,80}$/.test(m)) fail(400, 'Nama model tidak valid.')
    await db.query('INSERT INTO app_settings (`key`, value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)', [`ai.model.${p}`, m, userId])
  }
  cache.papAiConfig = undefined
}

// ---- Pemilihan model otomatis ----
// Analisis data (tren, perbandingan, penyebab, rekomendasi, strategi, prediksi) -> Claude, lalu ChatGPT, lalu Gemini.
// Pertanyaan ringan / umum -> Gemini (cepat & murah), lalu ChatGPT, lalu Claude. Hanya penyedia yang punya kunci API.
const ANALYSIS = /analis|tren|bandingk|perbandingan|kenapa|mengapa|penyebab|rekomendasi|strategi|prediksi|proyeksi|forecast|evaluasi|insight|performa|kinerja|potensi|peluang|risiko|turun|naik|menurun|meningkat|optimal|efisien|evaluasi|laporan|ringkas/i
export function isAnalysis(question: string) {
  return ANALYSIS.test(question) || question.length > 160
}
export async function providerOrder(question: string) {
  const order: AiProvider[] = isAnalysis(question) ? ['claude', 'openai', 'gemini'] : ['gemini', 'openai', 'claude']
  const out: AiProvider[] = []
  for (const p of order) if (await aiKey(p)) out.push(p)
  return out
}
