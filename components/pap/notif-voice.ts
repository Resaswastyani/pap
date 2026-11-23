'use client'

import { useEffect } from 'react'

// Suara notifikasi: nada singkat + notifikasi dibacakan (Text-to-Speech bahasa Indonesia, bawaan browser).
// Contoh: "Meeting Evaluasi Produksi direncanakan 24 November 2026 jam 10.00 di Ruang Meeting".
// Bisa dimatikan per perangkat lewat tombol speaker di panel Notifikasi.
const KEY = 'pap-notif-voice'
const MONTHS: Record<string, string> = {
  Jan: 'Januari', Feb: 'Februari', Mar: 'Maret', Apr: 'April', Mei: 'Mei', Jun: 'Juni', Jul: 'Juli', Agu: 'Agustus', Agt: 'Agustus', Aug: 'Agustus',
  Sep: 'September', Okt: 'Oktober', Oct: 'Oktober', Nov: 'November', Des: 'Desember', Dec: 'Desember',
}

export function voiceEnabled() {
  try { return localStorage.getItem(KEY) !== 'off' } catch { return true }
}
export function setVoiceEnabled(on: boolean) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off') } catch { /* penyimpanan diblokir: tetap default aktif */ }
  if (!on && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
}

// Browser hanya mengizinkan suara setelah ada interaksi (klik / sentuh) di halaman: siapkan AudioContext saat itu
let audio: AudioContext | null = null
export function unlockAudio() {
  if (typeof window === 'undefined') return
  const Ctx = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!audio && Ctx) audio = new Ctx()
  if (audio?.state === 'suspended') audio.resume().catch(() => undefined)
}


// Pasang sekali (NotificationCenter): siapkan audio pada klik / sentuhan / tombol pertama
export function useAudioUnlock() {
  useEffect(() => {
    window.addEventListener('pointerdown', unlockAudio, { passive: true })
    window.addEventListener('keydown', unlockAudio)
    return () => { window.removeEventListener('pointerdown', unlockAudio); window.removeEventListener('keydown', unlockAudio) }
  }, [])
}

// Nada "ding-dong" dua nada (tanpa file audio)
function chime() {
  if (!audio || audio.state !== 'running') return
  const now = audio.currentTime
  for (const [freq, at] of [[880, 0], [1318.5, 0.16]] as const) {
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, now + at)
    gain.gain.exponentialRampToValueAtTime(0.25, now + at + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.45)
    osc.connect(gain).connect(audio.destination)
    osc.start(now + at)
    osc.stop(now + at + 0.5)
  }
}

// Ubah teks notifikasi jadi kalimat yang enak didengar
export function spokenText(title: string, body: string | null) {
  const parts = (body ?? '').split(' · ').map((s) => s.trim()).filter(Boolean)
  const tanggal = (s: string) => s
    .replace(/\b(\d{1,2}) ([A-Z][a-z]{2})\b/g, (m, d: string, mon: string) => (MONTHS[mon] ? `${d} ${MONTHS[mon]}` : m))
    .replace(/\b(\d{1,2})[:.](\d{2})\b/g, 'jam $1.$2')
  // Meeting: "Meeting <judul> direncanakan <waktu> di <tempat>"
  const meeting = title.match(/^(Meeting baru|Jadwal meeting diubah|Meeting dibatalkan|Meeting segera dimulai): (.+)$/)
  if (meeting) {
    const [, jenis, judul] = meeting
    const waktu = parts[0] ? tanggal(parts[0]) : ''
    const tempat = parts[1] && !/^(dari|oleh) /.test(parts[1]) ? parts[1] : ''
    const kata = jenis === 'Meeting baru' ? 'direncanakan' : jenis === 'Jadwal meeting diubah' ? 'dijadwalkan ulang' : jenis === 'Meeting dibatalkan' ? 'dibatalkan, semula' : 'segera dimulai,'
    return `Meeting ${judul} ${kata} ${waktu}${tempat ? ` di ${tempat}` : ''}.`.replace(/\s+/g, ' ')
  }
  return `${title}. ${tanggal(parts.join(', '))}`.replace(/\s+/g, ' ').trim()
}

let voice: SpeechSynthesisVoice | null | undefined
function indonesianVoice() {
  if (voice !== undefined || typeof speechSynthesis === 'undefined') return voice ?? null
  const all = speechSynthesis.getVoices()
  if (!all.length) return null
  voice = all.find((v) => v.lang === 'id-ID') ?? all.find((v) => v.lang.startsWith('id')) ?? null
  return voice
}

// Bunyikan & bacakan notifikasi baru (maks 3 sekaligus agar tidak terlalu panjang)
export function announce(items: { title: string; body: string | null }[]) {
  if (!items.length || !voiceEnabled()) return
  chime()
  if (typeof speechSynthesis === 'undefined') return
  const list = items.slice(-3)
  const extra = items.length - list.length
  // Jeda sebentar setelah nada, lalu dibacakan berurutan
  setTimeout(() => {
    list.forEach((n, i) => {
      const text = spokenText(n.title, n.body) + (i === list.length - 1 && extra > 0 ? ` Dan ${extra} notifikasi lainnya.` : '')
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'id-ID'
      const v = indonesianVoice()
      if (v) u.voice = v
      speechSynthesis.speak(u)
    })
  }, 650)
}

// Contoh suara (tombol "Tes suara")
export function testVoice() {
  unlockAudio()
  announce([{ title: 'Notifikasi SIMPAP', body: 'Suara notifikasi aktif' }])
}
