'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'

// Toast: pemberitahuan singkat di pojok layar setelah tambah / ubah / hapus data, menyebut datanya
// ("Produk Kantong HD 30x45 berhasil diubah"). Dipanggil otomatis oleh api() untuk setiap POST/PUT/PATCH/DELETE
// yang berhasil (lihat apiToast), atau manual lewat toast('Pesan', 'success' | 'error' | 'info').
export type ToastKind = 'success' | 'error' | 'info'
// Pesan terstruktur: [label] [nama data, ditebalkan] [kata kerja]
export type ToastMessage = { label?: string; name?: string; verb: string }
type ToastItem = { id: number; key: string; msg: ToastMessage; kind: ToastKind; count: number }

// Penerima toast aktif (diisi ToastHost)
let show: ((msg: ToastMessage, kind: ToastKind) => void) | null = null

export function toast(message: string | ToastMessage, kind: ToastKind = 'success') {
  show?.(typeof message === 'string' ? { verb: message } : message, kind)
}

// Subjek konfirmasi hapus terakhir (dari confirmDialog), dipakai menamai data di toast "… berhasil dihapus"
let lastConfirm: { subject: string; at: number } | null = null
export function rememberConfirm(title: string | undefined, message: unknown) {
  const text = typeof message === 'string' ? message : ''
  const first = text.split('\n')[0].trim()
  const subject = (first || title || '').replace(/^hapus( permanen)?\s+/i, '').split('?')[0].trim()
  lastConfirm = subject && subject.length <= 120 ? { subject, at: Date.now() } : null
}

// Nama data per endpoint untuk kalimat toast ("Prospek … berhasil diubah")
const RESOURCE: Record<string, string> = {
  prospects: 'Prospek', visits: 'Jadwal visit', samples: 'Request sample', designs: 'Request desain', customers: 'Customer', products: 'Produk',
  quotations: 'Quotation', 'order-documents': 'Dokumen order', 'order-custom': 'Checklist order custom', complaints: 'Kendala customer',
  'repeat-order': 'Repeat order', content: 'Konten', kpi: 'KPI', payments: 'Pembayaran', production: 'Data produksi', capacity: 'Kapasitas produksi',
  stock: 'Stok', formulations: 'Formulasi', 'shift-schedule': 'Jadwal shift', faktur: 'Faktur', 'tech-analyses': 'Analisa teknik', machines: 'Mesin',
  repairs: 'Laporan kerusakan', maintenance: 'Perawatan mesin', sop: 'SOP mesin', 'tech-items': 'Sparepart', 'purchase-requests': 'Pengajuan pembelian',
  purchasing: 'Data purchasing', vendors: 'Supplier', logistik: 'Data logistik', expeditions: 'Ekspedisi', accounting: 'Data accounting', hpp: 'Data HPP',
  hrd: 'Data SDM', ga: 'Data GA', planning: 'Planning', meetings: 'Meeting', 'action-plan': 'Action plan', tickets: 'Tiket', users: 'User', roles: 'Role',
  divisions: 'Divisi', master: 'Master data', settings: 'Pengaturan', account: 'Akun', 'recycle-bin': 'Data terhapus', notes: 'Catatan', accurate: 'Data Accurate',
}
// Panggilan latar (bukan aksi CRUD pengguna): tanpa toast
const SILENT = ['/api/notifications', '/api/push', '/api/preferences', '/api/ai', '/api/auth', '/api/search', '/api/account/heartbeat', '/api/activity']
// Kolom yang biasanya berisi nama data (urutan prioritas)
const NAME_KEYS = ['nama_produk', 'nama', 'nama_usaha', 'judul', 'title', 'name', 'kepada', 'nama_customer', 'customer_nama', 'nama_barang', 'label', 'subject', 'keperluan', 'kode', 'nomor']

function nameOf(...sources: unknown[]) {
  for (const src of sources) {
    if (!src || typeof src !== 'object') continue
    const obj = src as Record<string, unknown>
    for (const k of NAME_KEYS) {
      const v = obj[k]
      if (typeof v === 'string' && v.trim() && v.trim().length <= 90) return v.trim()
    }
  }
  return undefined
}

// Kalimat toast untuk respons api() yang berhasil; null = tanpa toast. body = isian JSON yang dikirim.
export function apiToast(path: string, method: string, data: unknown, body?: unknown): ToastMessage | null {
  if (method === 'GET' || SILENT.some((p) => path.startsWith(p))) return null
  const res = data && typeof data === 'object' ? (data as Record<string, unknown>) : null
  if (typeof res?.toast === 'string') return { verb: res.toast }
  const parts = path.split('?')[0].split('/').filter(Boolean).slice(1) // tanpa 'api'
  const label = RESOURCE[parts[0]] ?? 'Data'
  const sub = parts.slice(1).filter((p) => !/^\d+$/.test(p))
  const last = sub[sub.length - 1]
  const child = last === 'attachments' || last === 'files' ? 'Lampiran' : last === 'comments' ? 'Komentar' : last === 'updates' || last === 'log' ? 'Catatan' : null
  if (method === 'DELETE') {
    const recent = lastConfirm && Date.now() - lastConfirm.at < 60_000 ? lastConfirm.subject : undefined
    lastConfirm = null
    if (child) return { label: child, name: recent, verb: 'berhasil dihapus' }
    return recent ? { name: recent, verb: 'berhasil dihapus' } : { label, verb: 'berhasil dihapus' }
  }
  if (typeof res?.message === 'string' && res.message.length <= 140) return { verb: res.message }
  const name = child ? undefined : nameOf(body, res?.item, res)
  const isNew = method === 'POST' && !/\/\d+(\/|$)/.test(path)
  return { label: child ?? label, name, verb: isNew ? 'berhasil ditambahkan' : 'berhasil diubah' }
}

const ICON = { success: CheckCircle2, error: AlertTriangle, info: Info } as const
const keyOf = (m: ToastMessage) => [m.label, m.name, m.verb].join('|')
let seq = 0

// Dipasang sekali di app shell (bersama ConfirmHost)
export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([])
  useEffect(() => {
    const timers = new Map<number, ReturnType<typeof setTimeout>>()
    const dismiss = (id: number) => { setItems((list) => list.filter((t) => t.id !== id)); timers.delete(id) }
    const schedule = (id: number, kind: ToastKind) => {
      clearTimeout(timers.get(id))
      timers.set(id, setTimeout(() => dismiss(id), kind === 'error' ? 6000 : 4000))
    }
    show = (msg, kind) => setItems((list) => {
      // Pesan sama beruntun (mis. simpan banyak baris) digabung: "Pesan ×3"
      const key = keyOf(msg)
      const same = list.find((t) => t.key === key && t.kind === kind)
      if (same) { schedule(same.id, kind); return list.map((t) => (t.id === same.id ? { ...t, count: t.count + 1 } : t)) }
      const id = ++seq
      schedule(id, kind)
      return [...list.slice(-3), { id, key, msg, kind, count: 1 }]
    })
    return () => { show = null; timers.forEach(clearTimeout) }
  }, [])
  if (!items.length) return null
  return (
    <output className="pap-toasts" aria-live="polite">
      {items.map((t) => {
        const Icon = ICON[t.kind]
        return (
          <div key={t.id} className={`pap-toast ${t.kind}`}>
            <span className="pap-toast-logo" aria-hidden="true"><Icon className="pap-toast-icon" /></span>
            <span className="pap-toast-text">
              <small>SIMPAP</small>
              <span>{t.msg.label ? `${t.msg.label} ` : ''}{t.msg.name ? <b>{t.msg.name} </b> : null}{t.msg.verb}{t.count > 1 ? <em> ×{t.count}</em> : null}</span>
            </span>
            <button type="button" aria-label="Tutup" onClick={() => setItems((list) => list.filter((x) => x.id !== t.id))}><X /></button>
          </div>
        )
      })}
    </output>
  )
}
