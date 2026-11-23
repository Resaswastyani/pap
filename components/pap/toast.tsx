'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'

// Toast: pemberitahuan singkat di pojok layar setelah tambah / ubah / hapus data.
// Dipanggil otomatis oleh api() untuk setiap POST/PUT/PATCH/DELETE yang berhasil (lihat apiToast di bawah),
// atau manual lewat toast('Pesan', 'success' | 'error' | 'info').
export type ToastKind = 'success' | 'error' | 'info'
type ToastItem = { id: number; message: string; kind: ToastKind; count: number }

// Penerima toast aktif (diisi ToastHost)
let show: ((message: string, kind: ToastKind) => void) | null = null

export function toast(message: string, kind: ToastKind = 'success') {
  show?.(message, kind)
}

// Nama data per endpoint untuk kalimat toast ("Prospek berhasil disimpan")
const RESOURCE: Record<string, string> = {
  prospects: 'Prospek', visits: 'Jadwal visit', samples: 'Request sample', designs: 'Request desain', customers: 'Customer', products: 'Produk',
  quotations: 'Quotation', 'order-documents': 'Dokumen order', 'order-custom': 'Checklist order custom', complaints: 'Kendala customer',
  'repeat-order': 'Repeat order', content: 'Konten', kpi: 'KPI', payments: 'Pembayaran', production: 'Data produksi', capacity: 'Kapasitas produksi',
  stock: 'Stok', formulations: 'Formulasi', 'shift-schedule': 'Jadwal shift', faktur: 'Faktur', 'tech-analyses': 'Analisa teknik', machines: 'Data mesin',
  repairs: 'Laporan kerusakan', maintenance: 'Perawatan mesin', sop: 'SOP mesin', 'tech-items': 'Sparepart', 'purchase-requests': 'Pengajuan pembelian',
  purchasing: 'Data purchasing', vendors: 'Supplier', logistik: 'Data logistik', expeditions: 'Ekspedisi', accounting: 'Data accounting', hpp: 'Data HPP',
  hrd: 'Data SDM', ga: 'Data GA', planning: 'Planning', meetings: 'Meeting', 'action-plan': 'Action plan', tickets: 'Tiket', users: 'User', roles: 'Role',
  divisions: 'Divisi', master: 'Master data', settings: 'Pengaturan', account: 'Akun', 'recycle-bin': 'Data terhapus', notes: 'Catatan', accurate: 'Data Accurate',
}
// Panggilan latar (bukan aksi CRUD pengguna): tanpa toast
const SILENT = ['/api/notifications', '/api/push', '/api/preferences', '/api/ai', '/api/auth', '/api/search', '/api/account/heartbeat', '/api/activity']

// Kalimat toast untuk respons api() yang berhasil; null = tanpa toast
export function apiToast(path: string, method: string, data: unknown): string | null {
  if (method === 'GET' || SILENT.some((p) => path.startsWith(p))) return null
  const fromServer = data && typeof data === 'object' ? (data as { message?: unknown; toast?: unknown }) : null
  if (typeof fromServer?.toast === 'string') return fromServer.toast
  if (typeof fromServer?.message === 'string' && fromServer.message.length <= 140) return fromServer.message
  const parts = path.split('?')[0].split('/').filter(Boolean).slice(1) // tanpa 'api'
  const label = RESOURCE[parts[0]] ?? 'Data'
  const sub = parts.slice(1).filter((p) => !/^\d+$/.test(p))
  const last = sub[sub.length - 1]
  const what = last === 'attachments' || last === 'files' ? 'Lampiran' : last === 'comments' ? 'Komentar' : last === 'updates' || last === 'log' ? 'Catatan' : label
  if (method === 'DELETE') return `${what} berhasil dihapus`
  // POST ke koleksi (mis. /api/prospects) = data baru; POST ke data tertentu (/api/x/12/...) = aksi / perubahan
  if (method === 'POST') return /\/\d+(\/|$)/.test(path) ? `${what === label ? `Perubahan ${label.toLowerCase()}` : what} berhasil disimpan` : `${what} berhasil ditambahkan`
  return `${what} berhasil diperbarui`
}

const ICON = { success: CheckCircle2, error: AlertTriangle, info: Info } as const
let seq = 0

// Dipasang sekali di app shell (bersama ConfirmHost)
export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([])
  useEffect(() => {
    const timers = new Map<number, ReturnType<typeof setTimeout>>()
    const dismiss = (id: number) => { setItems((list) => list.filter((t) => t.id !== id)); timers.delete(id) }
    const schedule = (id: number, kind: ToastKind) => {
      clearTimeout(timers.get(id))
      timers.set(id, setTimeout(() => dismiss(id), kind === 'error' ? 6000 : 3500))
    }
    show = (message, kind) => setItems((list) => {
      // Pesan sama beruntun (mis. simpan banyak baris) digabung: "Pesan ×3"
      const same = list.find((t) => t.message === message && t.kind === kind)
      if (same) { schedule(same.id, kind); return list.map((t) => (t.id === same.id ? { ...t, count: t.count + 1 } : t)) }
      const id = ++seq
      schedule(id, kind)
      return [...list.slice(-3), { id, message, kind, count: 1 }]
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
            <Icon className="pap-toast-icon" />
            <span>{t.message}{t.count > 1 ? <b> ×{t.count}</b> : null}</span>
            <button type="button" aria-label="Tutup" onClick={() => setItems((list) => list.filter((x) => x.id !== t.id))}><X /></button>
          </div>
        )
      })}
    </output>
  )
}
