'use client'

import { useCallback, useEffect, useState } from 'react'
import { Pencil, Plus, Search, Trash2, Truck } from 'lucide-react'
import { formatRupiah } from './accurate'
import { api, Field, formatDate, Modal, Notice, Pager, usePaged } from './ui'

type Expedition = {
  id: number; nama: string; kontak: string | null; telepon: string | null; tujuan: string; tarif_per_kg: number | null; minimal_kg: number | null
  estimasi_hari: string | null; keterangan: string | null; aktif: number; updated_at: string; updated_by_name: string | null
}

// Master ekspedisi: diurutkan per tujuan, termurah per kg lebih dulu (dipakai di Surat Order)
export function ExpeditionList() {
  const [items, setItems] = useState<Expedition[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [tujuan, setTujuan] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState<Expedition | 'new' | null>(null)
  const load = useCallback(async () => {
    try {
      const res = await api<{ items: Expedition[]; canEdit: boolean }>(`/api/expeditions${tujuan.trim() ? `?tujuan=${encodeURIComponent(tujuan.trim())}` : ''}`)
      setItems(res.items)
      setCanEdit(res.canEdit)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [tujuan])
  useEffect(() => {
    const t = setTimeout(load, tujuan ? 300 : 0)
    return () => clearTimeout(t)
  }, [load, tujuan])
  // Termurah per tujuan ditandai
  const cheapest = new Map<string, number>()
  for (const e of items) if (e.aktif && e.tarif_per_kg !== null) {
    const key = e.tujuan.toLowerCase()
    if (!cheapest.has(key) || e.tarif_per_kg < (items.find((x) => x.id === cheapest.get(key))?.tarif_per_kg ?? Infinity)) cheapest.set(key, e.id)
  }

  const paged = usePaged(items, items.length)
  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">MASTER DATA</p>
          <h1>Ekspedisi</h1>
          <span>Daftar ekspedisi per tujuan dengan tarif per kg dan estimasi waktu; yang termurah ditandai. Dipakai saat membuat Surat Order.</span>
        </div>
        {canEdit && <button className="pap-primary-button" onClick={() => setForm('new')}><Plus /> Tambah ekspedisi</button>}
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-table-card">
        <div className="pap-filters"><label className="pap-filter-search"><Search /><input value={tujuan} onChange={(e) => setTujuan(e.target.value)} placeholder="Cari kota tujuan atau nama ekspedisi..." /></label></div>
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Tujuan</th><th>Ekspedisi</th><th className="pap-num">Tarif / kg</th><th>Minimal</th><th>Estimasi</th><th>Kontak</th>{canEdit && <th aria-label="Aksi" />}</tr></thead>
            <tbody>
              {paged.items.map((e) => (
                <tr key={e.id} className={e.aktif ? '' : 'pap-row-muted'}>
                  <td><div className="pap-cell-title">{e.tujuan}</div></td>
                  <td>{e.nama} {cheapest.get(e.tujuan.toLowerCase()) === e.id && <span className="pap-status success">Termurah</span>}{e.keterangan && <div className="pap-cell-sub">{e.keterangan}</div>}</td>
                  <td className="pap-num">{e.tarif_per_kg === null ? '—' : formatRupiah(e.tarif_per_kg)}</td>
                  <td>{e.minimal_kg ? `${e.minimal_kg} kg` : '—'}</td>
                  <td>{e.estimasi_hari ? `${e.estimasi_hari} hari` : '—'}</td>
                  <td>{[e.kontak, e.telepon].filter(Boolean).join(' · ') || '—'}<div className="pap-cell-sub">Diperbarui {formatDate(e.updated_at)}</div></td>
                  {canEdit && <td><button className="pap-icon-button" aria-label={`Edit ${e.nama}`} onClick={() => setForm(e)}><Pencil /></button></td>}
                </tr>
              ))}
            </tbody>
          </table>
          {!items.length && <div className="pap-empty"><Truck className="pap-inline-icon" /> {tujuan ? 'Tidak ada ekspedisi untuk tujuan ini.' : 'Belum ada data ekspedisi.'}</div>}
        </div>
        <Pager {...paged.pager} noun="ekspedisi" />
      </div>
      {form && <ExpeditionForm initial={form === 'new' ? null : form} onClose={() => setForm(null)} onSaved={(t) => { setForm(null); setMessage(t); load() }} />}
    </>
  )
}

function ExpeditionForm({ initial, onClose, onSaved }: { initial: Expedition | null; onClose: () => void; onSaved: (m: string) => void }) {
  const [v, setV] = useState({
    nama: initial?.nama ?? '', tujuan: initial?.tujuan ?? '', tarif_per_kg: initial?.tarif_per_kg?.toString() ?? '', minimal_kg: initial?.minimal_kg?.toString() ?? '',
    estimasi_hari: initial?.estimasi_hari ?? '', kontak: initial?.kontak ?? '', telepon: initial?.telepon ?? '', keterangan: initial?.keterangan ?? '', aktif: initial ? !!initial.aktif : true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }))
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (initial) await api(`/api/expeditions/${initial.id}`, { method: 'PATCH', json: v })
      else await api('/api/expeditions', { method: 'POST', json: v })
      onSaved(initial ? 'Ekspedisi diperbarui.' : 'Ekspedisi ditambahkan.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }
  async function remove() {
    if (!initial || !window.confirm(`Hapus ${initial.nama} (${initial.tujuan})?`)) return
    try {
      await api(`/api/expeditions/${initial.id}`, { method: 'DELETE' })
      onSaved('Ekspedisi dihapus.')
    } catch (err) {
      setError((err as Error).message)
    }
  }
  return (
    <Modal title={initial ? `Edit ${initial.nama}` : 'Tambah ekspedisi'} onClose={onClose}
      footer={<>{initial && <button type="button" className="pap-btn danger" onClick={remove}><Trash2 /> Hapus</button>}<span className="pap-spacer" /><button type="button" className="pap-btn" onClick={onClose}>Batal</button><button type="submit" form="expedition-form" className="pap-primary-button" disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</button></>}
    >
      <form id="expedition-form" className="pap-form-grid" onSubmit={submit}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Nama ekspedisi"><input className="pap-input" required maxLength={150} value={v.nama} onChange={set('nama')} placeholder="Contoh: Indah Cargo" /></Field>
        <Field label="Tujuan (kota / area)"><input className="pap-input" required maxLength={255} value={v.tujuan} onChange={set('tujuan')} placeholder="Contoh: Surabaya" /></Field>
        <Field label="Tarif per kg (Rp)"><input className="pap-input" inputMode="numeric" value={v.tarif_per_kg} onChange={set('tarif_per_kg')} /></Field>
        <Field label="Minimal (kg)"><input className="pap-input" inputMode="decimal" value={v.minimal_kg} onChange={set('minimal_kg')} /></Field>
        <Field label="Estimasi (hari)"><input className="pap-input" maxLength={30} value={v.estimasi_hari} onChange={set('estimasi_hari')} placeholder="2-3" /></Field>
        <Field label="Kontak"><input className="pap-input" maxLength={150} value={v.kontak} onChange={set('kontak')} /></Field>
        <Field label="Telepon / WA"><input className="pap-input" maxLength={40} value={v.telepon} onChange={set('telepon')} /></Field>
        <Field label="Keterangan" full><input className="pap-input" maxLength={500} value={v.keterangan} onChange={set('keterangan')} placeholder="Jadwal berangkat, asuransi, pick-up gratis, dll." /></Field>
        <label className="pap-check full"><input type="checkbox" checked={v.aktif} onChange={(e) => setV((x) => ({ ...x, aktif: e.target.checked }))} /><span>Aktif</span></label>
      </form>
    </Modal>
  )
}
