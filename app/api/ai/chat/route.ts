import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { aiEnabled, askAssistant, assistantCapabilities, type ChatMessage } from '@/lib/ai-assistant'

export const maxDuration = 60

// Batas sederhana per user per instance: 20 pertanyaan / 5 menit
const hits = new Map<number, number[]>()
function throttle(userId: number) {
  const now = Date.now()
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < 5 * 60e3)
  if (recent.length >= 20) fail(429, 'Terlalu banyak pertanyaan dalam waktu singkat. Coba lagi beberapa menit lagi.')
  hits.set(userId, [...recent, now])
}

// Kemampuan PAP AI untuk user ini (saran pertanyaan di panel)
export const GET = handle(async () => {
  const user = await requireUser()
  return NextResponse.json({ enabled: aiEnabled(), can: assistantCapabilities(user) })
})

// Tanya PAP AI: { messages: [{ role: 'user' | 'model', text }] } (pesan terakhir = pertanyaan baru)
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  const body = (await readJson(request)) as { messages?: unknown }
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .map((m) => m as Partial<ChatMessage>)
    .filter((m) => (m.role === 'user' || m.role === 'model') && typeof m.text === 'string' && m.text.trim())
    .map((m) => ({ role: m.role!, text: m.text!.slice(0, m.role === 'user' ? 2000 : 6000) }))
    .slice(-12)
  if (!messages.length || messages[messages.length - 1].role !== 'user') fail(400, 'Tulis pertanyaan terlebih dahulu.')
  // Riwayat harus diawali pesan user
  while (messages[0]?.role !== 'user') messages.shift()
  throttle(user.id)
  return NextResponse.json(await askAssistant(user, messages))
})
