'use client'

import { useCallback, useEffect, useState } from 'react'
import { Cog, Pencil, Plus, Trash2, Wrench } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { api, Field, Modal, Notice } from './ui'

type Machine = { id: number; kode: string; nama: string; tahap: string; kapasitas: string | null; status: 'aktif' | 'maintenance' | 'nonaktif'; keterangan: string | null; antrian: number; sedang_dikerjakan: string | null }

const STATUS_LABEL = { aktif: 'Aktif', maintenance: 'Maintenance', nonaktif: 'Nonaktif' } as const
const STATUS_TONE = { aktif: 'success', maintenance: 'warning', nonaktif: 'neutral' } as const

export function MachinePage({ user }: { user: UserProfile }) {
  const [items, setItems] = useState<Machine[]>([])
  const [tahapList, setTahapList] = useState<string[]>(['Blow', 'Cetak', 'Bag making', 'Lainnya'])
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState<Machine | 'new' | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<{ items: Machine[]; tahap: string[]; canManage: boolean }>('/api/machines')
      setItems(res.items)
      setTahapList(res.tahap)
      setCanManage(res.canManage)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const flash = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 4000)
  }
  const count = (status: Machine['status']) => items.filter((m) => m.status === status).length
  const busyCount = items.filter((m) => m.sedang_dikerjakan).length

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">PRODUKSI</p>
          <h1>Data Mesin</h1>
          <span>Mesin produksi per tahap (Blow, Cetak, Bag making) untuk penjadwalan produksi.</span>
        </div>
        {canManage && <button className="pap-primary-button" onClick={() => setForm('new')}><Plus /> Tambah mesin</button>}
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      <div className="pap-stat-grid">
        <div className="pap-stat-card"><div><span>Mesin aktif</span><strong>{count('aktif')}/{items.length}</strong><small className="neutral">{busyCount} sedang memproduksi</small></div><div className="pap-stat-icon stat-0"><Cog /></div></div>
        <div className="pap-stat-card"><div><span>Maintenance</span><strong>{count('maintenance')}</strong><small className="neutral">Tidak dijadwalkan sementara</small></div><div className="pap-stat-icon stat-2"><Wrench /></div></div>
        <div className="pap-stat-card"><div><span>Antrian tahap</span><strong>{items.reduce((n, m) => n + m.antrian, 0)}</strong><small className="neutral">Tahap belum selesai di semua mesin</small></div><div className="pap-stat-icon stat-1"><Cog /></div></div>
      </div>
      <div className="pap-table-card">
        <div className="pap-card-head"><div><h2>Daftar mesin</h2><p>{canManage ? 'PPIC & Teknik dapat menambah dan mengubah data mesin.' : `${user.division.name} · hanya melihat`}</p></div></div>
        {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Mesin</th><th>Tahap</th><th>Kapasitas</th><th>Sedang dikerjakan</th><th className="pap-num">Antrian</th><th>Status</th>{canManage && <th aria-label="Aksi" />}</tr></thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id}>
                  <td><div className="pap-cell-title">{m.nama}</div><div className="pap-cell-sub">{m.kode}{m.keterangan ? ` · ${m.keterangan}` : ''}</div></td>
                  <td>{m.tahap}</td>
                  <td>{m.kapasitas ?? '—'}</td>
                  <td>{m.sedang_dikerjakan ?? <span className="pap-muted">—</span>}</td>
                  <td className="pap-num">{m.antrian}</td>
                  <td><span className={`pap-status ${STATUS_TONE[m.status]}`}>{STATUS_LABEL[m.status]}</span></td>
                  {canManage && <td><button className="pap-icon-button" aria-label={`Edit ${m.nama}`} onClick={() => setForm(m)}><Pencil /></button></td>}
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !items.length && <div className="pap-empty">Belum ada mesin. {canManage ? 'Klik "Tambah mesin" untuk mulai.' : 'PPIC / Teknik dapat menambahkan mesin.'}</div>}
          {loading && !items.length && <div className="pap-empty">Memuat mesin...</div>}
        </div>
      </div>
      {form && <MachineForm initial={form === 'new' ? null : form} tahapList={tahapList} onClose={() => setForm(null)} onSaved={(text) => { setForm(null); flash(text); load() }} />}
    </>
  )
}

function MachineForm({ initial, tahapList, onClose, onSaved }: { initial: Machine | null; tahapList: string[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [values, setValues] = useState({
    kode: initial?.kode ?? '',
    nama: initial?.nama ?? '',
    tahap: initial?.tahap ?? 'Blow',
    kapasitas: initial?.kapasitas ?? '',
    status: initial?.status ?? 'aktif',
    keterangan: initial?.keterangan ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (key: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (initial) await api(`/api/machines/${initial.id}`, { method: 'PATCH', json: values })
      else await api('/api/machines', { method: 'POST', json: values })
      onSaved(initial ? 'Mesin diperbarui.' : 'Mesin ditambahkan.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }
  async function remove() {
    if (!initial || !window.confirm(`Hapus mesin ${initial.nama}? Tahap yang memakai mesin ini perlu dijadwalkan ulang.`)) return
    setSaving(true)
    try {
      await api(`/api/machines/${initial.id}`, { method: 'DELETE' })
      onSaved('Mesin dihapus.')
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal
      title={initial ? 'Edit mesin' : 'Tambah mesin'}
      subtitle={initial?.kode}
      onClose={onClose}
      footer={<>{initial && <button type="button" className="pap-btn danger" disabled={saving} onClick={remove}><Trash2 /> Hapus</button>}<span className="pap-spacer" /><button type="button" className="pap-btn" onClick={onClose}>Batal</button><button type="submit" form="machine-form" className="pap-primary-button" disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</button></>}
    >
      <form id="machine-form" className="pap-form-grid" onSubmit={submit}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Kode mesin"><input className="pap-input" required maxLength={30} value={values.kode} onChange={set('kode')} placeholder="Contoh: BLW-01" /></Field>
        <Field label="Nama mesin"><input className="pap-input" required maxLength={150} value={values.nama} onChange={set('nama')} placeholder="Contoh: Mesin Blow 1" /></Field>
        <Field label="Tahap">
          <select className="pap-select" value={values.tahap} onChange={set('tahap')}>{tahapList.map((t) => <option key={t} value={t}>{t}</option>)}</select>
        </Field>
        <Field label="Status">
          <select className="pap-select" value={values.status} onChange={set('status')}>{Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </Field>
        <Field label="Kapasitas (opsional)" full><input className="pap-input" maxLength={150} value={values.kapasitas} onChange={set('kapasitas')} placeholder="Contoh: 500 kg/hari" /></Field>
        <Field label="Keterangan (opsional)" full><textarea className="pap-input" rows={2} maxLength={5000} value={values.keterangan} onChange={set('keterangan')} /></Field>
      </form>
    </Modal>
  )
}
