'use client'

import { ClipboardCheck, ClipboardList, FlaskConical, Handshake, ListChecks, MapPinned, Palette, ShoppingCart, Target, Wrench } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { Modal } from './ui'

// Menu lapor cepat dari tombol "+ Lapor" di HP. Hanya aksi dari menu yang dimiliki user yang tampil;
// aksi dijalankan halaman tujuan lewat useQuickAction (membuka form-nya langsung).
const ACTIONS: { menu: string; action: string; label: string; hint: string; icon: typeof Wrench; group: string }[] = [
  { menu: 'Kerusakan Mesin', action: 'lapor-kerusakan', label: 'Lapor kerusakan mesin', hint: 'Langsung diteruskan ke Teknik', icon: Wrench, group: 'Produksi & Teknik' },
  { menu: 'Kerusakan Mesin', action: 'form-kerusakan', label: 'Isi form kerusakan', hint: 'Catat kerusakan & tindakannya', icon: ClipboardList, group: 'Produksi & Teknik' },
  { menu: 'Perawatan Mesin', action: 'checkup-perawatan', label: 'Catat checkup perawatan', hint: 'Hasil checkup mesin', icon: ClipboardCheck, group: 'Produksi & Teknik' },
  { menu: 'Pengajuan Pembelian', action: 'ajukan-pembelian', label: 'Ajukan pembelian', hint: 'Sparepart, peralatan, bahan', icon: ShoppingCart, group: 'Produksi & Teknik' },
  { menu: 'Prospek', action: 'tambah-prospek', label: 'Tambah prospek', hint: 'Calon customer baru', icon: Target, group: 'Marketing' },
  { menu: 'Jadwal Visit', action: 'jadwal-visit', label: 'Jadwalkan visit', hint: 'Kunjungan ke prospek/customer', icon: MapPinned, group: 'Marketing' },
  { menu: 'Request Sample', action: 'request-sample', label: 'Request sample', hint: 'Ke PPIC & Produksi', icon: FlaskConical, group: 'Marketing' },
  { menu: 'Request Desain', action: 'request-desain', label: 'Request desain', hint: 'Ke Tim Desain', icon: Palette, group: 'Marketing' },
  { menu: 'Planning', action: 'buat-planning', label: 'Buat planning', hint: 'Rencana kerja & PIC', icon: ListChecks, group: 'Kolaborasi' },
  { menu: 'Meeting', action: 'tambah-meeting', label: 'Tambah meeting', hint: 'Jadwal & peserta', icon: Handshake, group: 'Kolaborasi' },
]

export function QuickReport({ user: _user, canOpen, onClose, onPick }: { user: UserProfile; canOpen: (menu: string) => boolean; onClose: () => void; onPick: (menu: string, action: string) => void }) {
  const actions = ACTIONS.filter((a) => canOpen(a.menu))
  const groups = [...new Set(actions.map((a) => a.group))]
  return (
    <Modal title="Lapor cepat" subtitle="Pilih yang ingin dilaporkan atau dicatat." onClose={onClose}>
      {!actions.length && <p className="pap-muted">Belum ada menu laporan untuk akun Anda. Hubungi Staff IT bila perlu akses.</p>}
      {groups.map((g) => (
        <section key={g} className="pap-quick-group">
          <h3>{g}</h3>
          <div className="pap-quick-grid">
            {actions.filter((a) => a.group === g).map((a) => (
              <button key={a.action} className="pap-quick-item" onClick={() => onPick(a.menu, a.action)}>
                <span className="pap-quick-icon"><a.icon /></span>
                <span><b>{a.label}</b><small>{a.hint}</small></span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </Modal>
  )
}
