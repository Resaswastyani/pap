'use client'

import { useState } from 'react'
import { Pencil, RotateCcw, Save, X } from 'lucide-react'
import { api } from './ui'

// Cycle order customer: hasil analisis otomatis (median jarak order) atau diisi manual (hari / bulan)
export type CycleInfo = {
  cycle_auto_days: number | null
  cycle_auto_gaps: number | null
  cycle_manual_days: number | null
  cycle_manual_unit: 'hari' | 'bulan' | null
  batas_pasif: number
  order_count: number
}

export const cycleDays = (c: CycleInfo) => c.cycle_manual_days ?? c.cycle_auto_days ?? null

// "25 hari" / "2 bulan" (manual dalam bulan ditampilkan sebagai bulan)
export function cycleText(c: CycleInfo) {
  if (c.cycle_manual_days) return c.cycle_manual_unit === 'bulan' ? `${Math.round(c.cycle_manual_days / 30)} bulan` : `${c.cycle_manual_days} hari`
  return c.cycle_auto_days ? `${c.cycle_auto_days} hari` : null
}

export function cycleSource(c: CycleInfo) {
  if (c.cycle_manual_days) return 'diisi manual'
  if (c.cycle_auto_days) return `otomatis, median dari ${c.cycle_auto_gaps ?? 0} jarak order`
  return c.order_count < 2 ? 'belum ketahuan, baru 1x order' : 'belum ketahuan'
}

export function CycleField({ customerId, info, canEdit, onSaved }: { customerId: number; info: CycleInfo; canEdit: boolean; onSaved: (message: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [unit, setUnit] = useState<'hari' | 'bulan'>(info.cycle_manual_unit ?? 'hari')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const text = cycleText(info)

  function start() {
    const days = cycleDays(info)
    const u = info.cycle_manual_unit ?? 'hari'
    setUnit(u)
    setValue(days ? String(u === 'bulan' ? Math.max(1, Math.round(days / 30)) : days) : '')
    setError('')
    setEditing(true)
  }
  async function save(manual: { value: number | null; unit: 'hari' | 'bulan' }) {
    setBusy(true)
    setError('')
    try {
      await api(`/api/customers/${customerId}/cycle`, { method: 'PUT', body: JSON.stringify(manual) })
      setEditing(false)
      onSaved(manual.value ? 'Cycle order disimpan.' : 'Cycle order kembali memakai hasil analisis otomatis.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <div className="pap-cycle-edit">
        <div className="pap-cycle-inputs">
          <input className="pap-input" type="number" min={1} max={unit === 'bulan' ? 24 : 730} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Cycle order" autoFocus />
          <select className="pap-select" value={unit} onChange={(e) => setUnit(e.target.value as 'hari' | 'bulan')} aria-label="Satuan cycle">
            <option value="hari">hari</option>
            <option value="bulan">bulan</option>
          </select>
        </div>
        <div className="pap-cycle-actions">
          <button type="button" className="pap-primary-button" disabled={busy || !(Number(value) >= 1)} onClick={() => save({ value: Number(value), unit })}><Save /> Simpan</button>
          <button type="button" className="pap-btn" disabled={busy} onClick={() => setEditing(false)}><X /> Batal</button>
        </div>
        {error && <small className="pap-field-error">{error}</small>}
      </div>
    )
  }
  return (
    <div className="pap-cycle-view">
      <span>{text ? <>Tiap <b>{text}</b></> : <span className="pap-muted">Belum ketahuan</span>} <small className="pap-muted">({cycleSource(info)}{info.cycle_manual_days && info.cycle_auto_days ? `; otomatis ${info.cycle_auto_days} hari` : ''})</small></span>
      <small className="pap-muted">Pasif bila tidak order &gt; {info.batas_pasif} hari</small>
      {canEdit && (
        <span className="pap-cycle-actions">
          <button type="button" className="pap-link-button" onClick={start}><Pencil /> {text ? 'Ubah' : 'Isi manual'}</button>
          {info.cycle_manual_days && <button type="button" className="pap-link-button" disabled={busy} onClick={() => save({ value: null, unit: 'hari' })}><RotateCcw /> Pakai otomatis</button>}
        </span>
      )}
      {error && <small className="pap-field-error">{error}</small>}
    </div>
  )
}
