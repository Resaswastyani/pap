'use client'

import { useState } from 'react'
import { Download, FileSpreadsheet, Printer } from 'lucide-react'
import { Field, Modal } from './ui'

// Unduh laporan absensi / gaji kapan saja (mis. laporan HRD ke Keuangan tiap Senin): Excel (.xlsx) atau PDF (cetak)
const iso = (d: Date) => d.toISOString().slice(0, 10)
const wib = () => new Date(Date.now() + 7 * 3600e3)
function presets() {
  const now = wib()
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const monday = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * 86400e3)
  const day = (base: Date, n: number) => new Date(base.getTime() + n * 86400e3)
  return [
    { key: 'minggu_lalu', label: 'Minggu lalu (Senin–Minggu)', dari: iso(day(monday, -7)), sampai: iso(day(monday, -1)) },
    { key: 'minggu_ini', label: 'Minggu ini (Senin s/d hari ini)', dari: iso(monday), sampai: iso(today) },
    { key: 'bulan_ini', label: 'Bulan ini', dari: iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), sampai: iso(today) },
    { key: 'cutoff', label: 'Periode gaji berjalan (cut off 27)', dari: iso(today.getUTCDate() > 27 ? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 28)) : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 28))), sampai: iso(today) },
  ]
}

export function ReportDownloadButton({ jenis, periode }: { jenis: 'absensi' | 'gaji'; periode?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="pap-btn" onClick={() => setOpen(true)}><Download /> Unduh laporan</button>
      {open && <ReportDownload jenis={jenis} periode={periode} onClose={() => setOpen(false)} />}
    </>
  )
}

function ReportDownload({ jenis, periode, onClose }: { jenis: 'absensi' | 'gaji'; periode?: string; onClose: () => void }) {
  const list = presets()
  const [preset, setPreset] = useState(list[0].key)
  const [range, setRange] = useState({ dari: list[0].dari, sampai: list[0].sampai })
  const [bulan, setBulan] = useState(periode ?? (() => { const n = wib(); return iso(n.getUTCDate() > 27 ? new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1)) : n).slice(0, 7) })())
  const pick = (key: string) => {
    setPreset(key)
    const p = list.find((x) => x.key === key)
    if (p) setRange({ dari: p.dari, sampai: p.sampai })
  }
  const valid = jenis === 'gaji' ? /^\d{4}-\d{2}$/.test(bulan) : !!range.dari && !!range.sampai && range.dari <= range.sampai
  const qs = jenis === 'gaji' ? `periode=${bulan}` : `dari=${range.dari}&sampai=${range.sampai}`
  const xlsx = jenis === 'gaji' ? `/api/hrd/payroll/report?${qs}` : `/api/hrd/attendance/report?${qs}`
  const pdf = jenis === 'gaji' ? `/cetak/laporan-gaji?${qs}` : `/cetak/absensi?${qs}`
  return (
    <Modal title={jenis === 'gaji' ? 'Unduh laporan gaji' : 'Unduh laporan absensi'} subtitle="Bisa diunduh kapan saja; data sampai hari ini" onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Tutup</button>
        <a className={`pap-btn ${valid ? '' : 'disabled'}`} href={valid ? pdf : undefined} target="_blank" rel="noreferrer"><Printer /> PDF</a>
        <a className={`pap-primary-button ${valid ? '' : 'disabled'}`} href={valid ? xlsx : undefined}><FileSpreadsheet /> Excel (.xlsx)</a></>}>
      <div className="pap-form-grid">
        {jenis === 'gaji' ? (
          <Field label="Periode gaji (bulan cut off)" hint="Mis. Oktober = 28 Sep – 27 Okt" full><input className="pap-input" type="month" value={bulan} onChange={(e) => setBulan(e.target.value)} /></Field>
        ) : (
          <>
            <Field label="Rentang" full>
              <select className="pap-select" value={preset} onChange={(e) => pick(e.target.value)}>
                {list.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                <option value="custom">Pilih tanggal sendiri</option>
              </select>
            </Field>
            <Field label="Dari"><input className="pap-input" type="date" value={range.dari} onChange={(e) => { setPreset('custom'); setRange({ ...range, dari: e.target.value }) }} /></Field>
            <Field label="Sampai"><input className="pap-input" type="date" value={range.sampai} onChange={(e) => { setPreset('custom'); setRange({ ...range, sampai: e.target.value }) }} /></Field>
          </>
        )}
        <p className="pap-hint full">
          {jenis === 'gaji'
            ? 'Excel berisi Rekap Gaji, rincian jam per minggu, dan baris slip setiap karyawan. PDF dibuka di tab baru; pilih "Simpan sebagai PDF" di dialog cetak.'
            : 'Excel berisi Rekap (hadir, terlambat, tanpa keterangan, izin, sakit, cuti, OFF, jam kerja, lembur) dan Harian (jam masuk–pulang per tanggal). Hari libur sesuai Jadwal Shift. PDF dibuka di tab baru; pilih "Simpan sebagai PDF".'}
        </p>
      </div>
    </Modal>
  )
}
