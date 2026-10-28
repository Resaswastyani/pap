'use client'

import { useCallback, useEffect, useState } from 'react'
import { Factory, Gauge, Pencil, Plus, Printer, Trash2 } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { api, Field, formatDate, Modal, Notice, confirmDialog } from './ui'

type Capacity = {
  id: number; jenis_plastik: string; lebar_maks_cm: number | null; kapasitas_maks_ton: number; efisiensi_pct: number; kapasitas_eff_ton: number
  mesin: string; jumlah_mesin: number; catatan: string | null; updated_at: string; updated_name: string | null
}
type Totals = { maks: number; eff: number; mesin: number; per_jenis: { jenis_plastik: string; maks: number; eff: number; mesin: number }[] }
type Info = { judul: string; tanggal: string | null; catatan: string; ttd: string[] }
type Data = { items: Capacity[]; totals: Totals; info: Info; can: { manage: boolean } }

const num = (n: number | null) => (n === null ? '—' : n.toLocaleString('id-ID', { maximumFractionDigits: 2 }))
const ton = (n: number) => `${num(n)} Ton`

// Kapasitas produksi per mesin blow & jenis plastik (dokumen Kapasitas Produksi PAP – Non Mika)
export function CapacityPage(_props: { user: UserProfile }) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [edit, setEdit] = useState<Capacity | 'baru' | null>(null)
  const [infoOpen, setInfoOpen] = useState(false)
  const load = useCallback(async () => {
    try {
      setData(await api<Data>('/api/capacity'))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => { load() }, [load])
  const done = (text: string) => {
    setEdit(null)
    setInfoOpen(false)
    setMessage(text)
    setTimeout(() => setMessage(''), 5000)
    load()
  }
  async function remove(c: Capacity) {
    if (!(await confirmDialog(`Hapus kapasitas ${c.mesin} (${c.jenis_plastik})?`))) return
    try {
      await api(`/api/capacity/${c.id}`, { method: 'DELETE' })
      done('Data kapasitas dihapus.')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const info = data?.info
  const t = data?.totals
  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">PRODUKSI</p>
          <h1>Kapasitas Produksi</h1>
          <span>{info?.judul ?? 'Kapasitas produksi per jenis plastik'}{info?.tanggal ? ` · Ttd ${formatDate(info.tanggal)}` : ''}. Kapasitas efektif = kapasitas maksimal × efisiensi.</span>
        </div>
        <div className="pap-inline-actions pap-wrap">
          <a className="pap-btn" href="/cetak/kapasitas-produksi" target="_blank" rel="noreferrer"><Printer /> Cetak</a>
          {data?.can.manage && <button className="pap-btn" onClick={() => setInfoOpen(true)}><Pencil /> Keterangan dokumen</button>}
          {data?.can.manage && <button className="pap-primary-button" onClick={() => setEdit('baru')}><Plus /> Tambah mesin</button>}
        </div>
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {t && (
        <div className="pap-stat-grid four">
          <div className="pap-stat-card"><div><span>Total kapasitas maksimal</span><strong className="pap-stat-text">{ton(t.maks)}</strong><small className="neutral">{t.mesin} mesin blow</small></div><div className="pap-stat-icon stat-1"><Factory /></div></div>
          <div className="pap-stat-card"><div><span>Total kapasitas efektif</span><strong className="pap-stat-text">{ton(t.eff)}</strong><small>{t.maks ? `${num(Math.round((t.eff / t.maks) * 1000) / 10)}% dari maksimal` : '—'}</small></div><div className="pap-stat-icon stat-0"><Gauge /></div></div>
          {t.per_jenis.slice(0, 2).map((j) => (
            <div className="pap-stat-card" key={j.jenis_plastik}><div><span>Plastik {j.jenis_plastik}</span><strong className="pap-stat-text">{ton(j.eff)}</strong><small className="neutral">efektif · maks {ton(j.maks)} · {j.mesin} mesin</small></div><div className="pap-stat-icon stat-2"><Gauge /></div></div>
          ))}
        </div>
      )}
      <div className="pap-table-card">
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Jenis plastik</th><th>Lebar maks</th><th>Kapasitas maks</th><th>Kapasitas efektif</th><th>Mesin</th>{data?.can.manage && <th />}</tr></thead>
            <tbody>
              {data?.items.map((c) => (
                <tr key={c.id}>
                  <td><div className="pap-cell-title">{c.jenis_plastik}</div>{c.catatan && <div className="pap-cell-sub">{c.catatan}</div>}</td>
                  <td className="pap-nowrap">{c.lebar_maks_cm === null ? '—' : `${num(c.lebar_maks_cm)} cm`}</td>
                  <td className="pap-nowrap">{ton(c.kapasitas_maks_ton)}</td>
                  <td className="pap-nowrap"><b>{ton(c.kapasitas_eff_ton)}</b> <span className="pap-muted">({num(c.efisiensi_pct)}%)</span></td>
                  <td>{c.jumlah_mesin} {c.mesin}{c.updated_name && <div className="pap-cell-sub">Diubah {c.updated_name} · {formatDate(c.updated_at)}</div>}</td>
                  {data.can.manage && (
                    <td className="pap-nowrap">
                      <button className="pap-icon-button" aria-label={`Ubah ${c.mesin}`} onClick={() => setEdit(c)}><Pencil /></button>
                      <button className="pap-icon-button" aria-label={`Hapus ${c.mesin}`} onClick={() => remove(c)}><Trash2 /></button>
                    </td>
                  )}
                </tr>
              ))}
              {t && t.per_jenis.length > 0 && (
                <tr className="pap-total-row">
                  <td colSpan={2}><b>Total</b></td>
                  <td className="pap-nowrap"><b>{ton(t.maks)}</b></td>
                  <td className="pap-nowrap"><b>{ton(t.eff)}</b></td>
                  <td>{t.per_jenis.map((j) => `${j.jenis_plastik}: ${ton(j.eff)}`).join(' · ')}</td>
                  {data?.can.manage && <td />}
                </tr>
              )}
            </tbody>
          </table>
          {data && !data.items.length && <div className="pap-empty">Belum ada data kapasitas produksi.</div>}
          {!data && !error && <div className="pap-empty">Memuat kapasitas produksi...</div>}
        </div>
      </div>
      {info && (info.catatan || info.ttd.length > 0) && (
        <section className="pap-table-card pap-capacity-note">
          {info.catatan && <><h3>Catatan</h3><ul>{info.catatan.split('\n').filter((l) => l.trim()).map((l, i) => <li key={i}>{l.replace(/^[-•]\s*/, '')}</li>)}</ul></>}
          {info.ttd.length > 0 && <p className="pap-muted">Ditandatangani{info.tanggal ? ` ${formatDate(info.tanggal)}` : ''}: {info.ttd.join(', ')}</p>}
        </section>
      )}
      {edit && <CapacityForm item={edit === 'baru' ? null : edit} jenisList={[...new Set(data?.items.map((c) => c.jenis_plastik) ?? [])]} onClose={() => setEdit(null)} onSaved={done} />}
      {infoOpen && info && <InfoForm info={info} onClose={() => setInfoOpen(false)} onSaved={done} />}
    </>
  )
}

function CapacityForm({ item, jenisList, onClose, onSaved }: { item: Capacity | null; jenisList: string[]; onClose: () => void; onSaved: (text: string) => void }) {
  const [v, setV] = useState({
    jenis_plastik: item?.jenis_plastik ?? '', lebar_maks_cm: item?.lebar_maks_cm?.toString() ?? '', kapasitas_maks_ton: item?.kapasitas_maks_ton.toString() ?? '',
    efisiensi_pct: item?.efisiensi_pct.toString() ?? '70', mesin: item?.mesin ?? '', jumlah_mesin: item?.jumlah_mesin.toString() ?? '1', catatan: item?.catatan ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value })
  const eff = (Number(v.kapasitas_maks_ton.replace(',', '.')) * Number(v.efisiensi_pct.replace(',', '.'))) / 100
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api(item ? `/api/capacity/${item.id}` : '/api/capacity', { method: item ? 'PUT' : 'POST', json: v })
      onSaved(item ? 'Kapasitas diperbarui.' : 'Kapasitas ditambahkan.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={item ? 'Ubah kapasitas' : 'Tambah kapasitas mesin'} onClose={onClose} footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="capacity-form" disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan'}</button></>}>
      <form id="capacity-form" className="pap-form-grid" onSubmit={save}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Jenis plastik">
          <input className="pap-input" list="pap-capacity-jenis" required maxLength={60} value={v.jenis_plastik} onChange={set('jenis_plastik')} placeholder="HD/PE atau PP" />
          <datalist id="pap-capacity-jenis">{[...new Set(['HD/PE', 'PP', ...jenisList])].map((j) => <option key={j} value={j} />)}</datalist>
        </Field>
        <Field label="Lebar maksimal (cm)"><input className="pap-input" inputMode="decimal" value={v.lebar_maks_cm} onChange={set('lebar_maks_cm')} placeholder="65" /></Field>
        <Field label="Nama mesin" full><input className="pap-input" required maxLength={255} value={v.mesin} onChange={set('mesin')} placeholder="Mesin Blow HD/PE Besar" /></Field>
        <Field label="Jumlah mesin"><input className="pap-input" type="number" min={1} max={50} required value={v.jumlah_mesin} onChange={set('jumlah_mesin')} /></Field>
        <Field label="Kapasitas maksimal (Ton)"><input className="pap-input" inputMode="decimal" required value={v.kapasitas_maks_ton} onChange={set('kapasitas_maks_ton')} placeholder="30" /></Field>
        <Field label="Efisiensi (%)" hint={Number.isFinite(eff) && eff > 0 ? `Kapasitas efektif ${num(Math.round(eff * 100) / 100)} Ton` : undefined}><input className="pap-input" inputMode="decimal" required value={v.efisiensi_pct} onChange={set('efisiensi_pct')} /></Field>
        <Field label="Catatan (opsional)" full><input className="pap-input" maxLength={500} value={v.catatan} onChange={set('catatan')} /></Field>
      </form>
    </Modal>
  )
}

function InfoForm({ info, onClose, onSaved }: { info: Info; onClose: () => void; onSaved: (text: string) => void }) {
  const [v, setV] = useState({ judul: info.judul, tanggal: info.tanggal ?? '', catatan: info.catatan, ttd: info.ttd.join(', ') })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api('/api/capacity', { method: 'PUT', json: { ...v, ttd: v.ttd.split(',').map((s) => s.trim()) } })
      onSaved('Keterangan dokumen disimpan.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="Keterangan dokumen kapasitas" onClose={onClose} footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="capacity-info" disabled={busy}>Simpan</button></>}>
      <form id="capacity-info" className="pap-form-grid" onSubmit={save}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Judul" full><input className="pap-input" maxLength={200} value={v.judul} onChange={(e) => setV({ ...v, judul: e.target.value })} /></Field>
        <Field label="Tanggal tanda tangan"><input className="pap-input" type="date" value={v.tanggal} onChange={(e) => setV({ ...v, tanggal: e.target.value })} /></Field>
        <Field label="Penanda tangan" hint="Pisahkan dengan koma"><input className="pap-input" value={v.ttd} onChange={(e) => setV({ ...v, ttd: e.target.value })} /></Field>
        <Field label="Catatan" hint="Satu poin per baris" full><textarea className="pap-input" rows={3} maxLength={2000} value={v.catatan} onChange={(e) => setV({ ...v, catatan: e.target.value })} /></Field>
      </form>
    </Modal>
  )
}
