'use client'

import { useCallback, useEffect, useState } from 'react'
import { Calculator, FileText, History, Layers, Pencil, Plus, Settings2, TrendingDown, TrendingUp } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { HPP_MODEL_LABEL, HPP_PARAM_KEYS, HPP_PARAM_LABEL, hitungHpp, rupiah, type HppModel, type HppParams } from '@/lib/hpp-calc'
import { api, Field, formatDate, Modal, Notice } from './ui'

export type Material = {
  id: number; kode: string; nama: string; jenis: 'resin' | 'pewarna' | 'tinta' | 'aditif' | 'lainnya'; satuan: string; harga: number; density: number | null
  keterangan: string | null; aktif: number; updated_by_name: string | null; updated_at: string; harga_sebelumnya: number | null
}
export type HppData = { materials: Material[]; params: HppParams; doc: Record<string, string>; canEditPrices: boolean; canEditParams: boolean }

const JENIS_LABEL = { resin: 'Resin / biji plastik', pewarna: 'Pewarna / masterbatch', tinta: 'Tinta', aditif: 'Aditif', lainnya: 'Lainnya' } as const

export function useHppData() {
  const [data, setData] = useState<HppData | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => {
    api<HppData>('/api/hpp').then(setData).catch((e) => setError(e.message))
  }, [])
  useEffect(load, [load])
  return { data, error, setError, reload: load }
}

// ---------------- Kalkulator HPP satu produk (dipakai di Tabel HPP & form Quotation) ----------------
export type CalcValues = {
  model: HppModel; material_id: string; pewarna_id: string; pewarna_persen: string
  panjang_cm: string; lebar_cm: string; gusset_cm: string; tebal_mikron: string; jumlah_warna: string; satuan: string
}
export const emptyCalc = (materials: Material[]): CalcValues => ({
  model: 'kantong', material_id: String(materials.find((m) => m.jenis === 'resin' && m.aktif)?.id ?? ''), pewarna_id: '', pewarna_persen: '',
  panjang_cm: '', lebar_cm: '', gusset_cm: '', tebal_mikron: '', jumlah_warna: '0', satuan: 'pcs',
})
const n = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))

export function calcResult(values: CalcValues, data: HppData) {
  const resin = data.materials.find((m) => String(m.id) === values.material_id) ?? null
  const pewarna = data.materials.find((m) => String(m.id) === values.pewarna_id) ?? null
  return hitungHpp({
    model: values.model,
    panjang_cm: n(values.panjang_cm), lebar_cm: n(values.lebar_cm), gusset_cm: n(values.gusset_cm), tebal_mikron: n(values.tebal_mikron),
    jumlah_warna: Number(values.jumlah_warna) || 0,
    satuan: values.satuan === 'kg' ? 'kg' : 'pcs',
    resin: resin ? { harga: resin.harga, density: resin.density } : null,
    pewarna: pewarna && (n(values.pewarna_persen) ?? 0) > 0 ? { harga: pewarna.harga, persen: n(values.pewarna_persen)! } : null,
  }, data.params)
}

export function CalcFields({ values, onChange, data, compact }: { values: CalcValues; onChange: (patch: Partial<CalcValues>) => void; data: HppData; compact?: boolean }) {
  const resins = data.materials.filter((m) => m.jenis === 'resin' && (m.aktif || String(m.id) === values.material_id))
  const pewarnas = data.materials.filter((m) => m.jenis === 'pewarna' && (m.aktif || String(m.id) === values.pewarna_id))
  const set = (key: keyof CalcValues) => (e: { target: { value: string } }) => onChange({ [key]: e.target.value } as Partial<CalcValues>)
  return (
    <div className={`pap-calc-grid ${compact ? 'compact' : ''}`}>
      <label><span>Model</span><select className="pap-select" value={values.model} onChange={set('model')}>{Object.entries(HPP_MODEL_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label><span>Bahan</span><select className="pap-select" value={values.material_id} onChange={set('material_id')}><option value="">Pilih bahan</option>{resins.map((m) => <option key={m.id} value={m.id}>{m.nama} ({rupiah(m.harga)}/{m.satuan})</option>)}</select></label>
      <label><span>Panjang (cm)</span><input className="pap-input" inputMode="decimal" value={values.panjang_cm} onChange={set('panjang_cm')} placeholder="60" /></label>
      <label><span>Lebar (cm)</span><input className="pap-input" inputMode="decimal" value={values.lebar_cm} onChange={set('lebar_cm')} placeholder="40" /></label>
      {values.model === 'gusset' && <label><span>Gusset total (cm)</span><input className="pap-input" inputMode="decimal" value={values.gusset_cm} onChange={set('gusset_cm')} placeholder="10" /></label>}
      <label><span>Tebal (mikron)</span><input className="pap-input" inputMode="decimal" value={values.tebal_mikron} onChange={set('tebal_mikron')} placeholder="40" /></label>
      <label><span>Jumlah warna cetak</span><input className="pap-input" type="number" min={0} max={12} value={values.jumlah_warna} onChange={set('jumlah_warna')} /></label>
      <label><span>Satuan jual</span><select className="pap-select" value={values.satuan} onChange={set('satuan')}><option value="pcs">per pcs</option><option value="kg">per kg</option></select></label>
      <label><span>Pewarna (opsional)</span><select className="pap-select" value={values.pewarna_id} onChange={set('pewarna_id')}><option value="">Tanpa pewarna</option>{pewarnas.map((m) => <option key={m.id} value={m.id}>{m.nama}</option>)}</select></label>
      {values.pewarna_id && <label><span>Porsi pewarna (%)</span><input className="pap-input" inputMode="decimal" value={values.pewarna_persen} onChange={set('pewarna_persen')} placeholder="3" /></label>}
    </div>
  )
}

export function CalcSummary({ result, satuan }: { result: ReturnType<typeof hitungHpp>; satuan: string }) {
  return (
    <div className="pap-calc-result">
      <div><span>Berat / pcs</span><b>{result.berat_gram === null ? '—' : `${result.berat_gram.toLocaleString('id-ID', { maximumFractionDigits: 2 })} g`}</b><small>{result.pcs_per_kg ? `±${result.pcs_per_kg} pcs/kg` : ''}</small></div>
      <div><span>Bahan / kg</span><b>{rupiah(result.bahan_per_kg)}</b></div>
      <div><span>Proses / kg</span><b>{rupiah(result.proses_per_kg)}</b></div>
      <div><span>Overhead / kg</span><b>{rupiah(result.overhead_per_kg)}</b></div>
      <div className="hl"><span>HPP / kg</span><b>{rupiah(result.hpp_per_kg)}</b></div>
      <div className="hl"><span>HPP / {satuan === 'kg' ? 'kg' : 'pcs'}</span><b>{rupiah(result.hpp_satuan, satuan === 'kg' ? 0 : 2)}</b></div>
      <div className="ok"><span>Harga saran</span><b>{rupiah(result.harga_saran)}</b></div>
      {result.klise > 0 && <div><span>Klise (sekali)</span><b>{rupiah(result.klise)}</b></div>}
      {result.peringatan.length > 0 && <p className="pap-calc-warn">{result.peringatan.join(' ')}</p>}
    </div>
  )
}

// ---------------- Halaman Tabel HPP ----------------
type Tab = 'bahan' | 'parameter' | 'kalkulator' | 'dokumen'

export function HppPage({ user: _user }: { user: UserProfile }) {
  const { data, error, setError, reload } = useHppData()
  const [tab, setTab] = useState<Tab>('bahan')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState<Material | 'new' | null>(null)
  const [history, setHistory] = useState<Material | null>(null)
  const flash = (text: string) => { setMessage(text); setTimeout(() => setMessage(''), 5000); reload() }

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">MARKETING · PURCHASING</p>
          <h1>Tabel HPP</h1>
          <span>Harga bahan baku terbaru, parameter biaya produksi, dan kalkulator HPP sebagai dasar harga penawaran ke customer.</span>
        </div>
        {tab === 'bahan' && data?.canEditPrices && <button className="pap-primary-button" onClick={() => setForm('new')}><Plus /> Tambah bahan</button>}
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-segmented pap-page-tabs" role="tablist">
        <button className={tab === 'bahan' ? 'active' : ''} onClick={() => setTab('bahan')}><Layers /> Harga bahan baku</button>
        <button className={tab === 'parameter' ? 'active' : ''} onClick={() => setTab('parameter')}><Settings2 /> Parameter biaya</button>
        <button className={tab === 'kalkulator' ? 'active' : ''} onClick={() => setTab('kalkulator')}><Calculator /> Kalkulator HPP</button>
        <button className={tab === 'dokumen' ? 'active' : ''} onClick={() => setTab('dokumen')}><FileText /> Data dokumen</button>
      </div>
      {!data && !error && <div className="pap-empty">Memuat...</div>}
      {data && tab === 'bahan' && (
        <div className="pap-table-card">
          <div className="pap-card-head"><div><h2>Harga bahan baku</h2><p>{data.canEditPrices ? 'Purchasing / Admin / GM memperbarui harga; setiap perubahan tercatat di riwayat.' : 'Hanya melihat. Harga diperbarui Purchasing.'}</p></div></div>
          <div className="pap-table-wrap">
            <table>
              <thead><tr><th>Bahan</th><th>Jenis</th><th className="pap-num">Harga</th><th>Perubahan</th><th>Density</th><th>Diperbarui</th><th aria-label="Aksi" /></tr></thead>
              <tbody>
                {data.materials.map((m) => {
                  const diff = m.harga_sebelumnya !== null && m.harga_sebelumnya > 0 ? ((m.harga - m.harga_sebelumnya) / m.harga_sebelumnya) * 100 : null
                  return (
                    <tr key={m.id} className={m.aktif ? '' : 'pap-row-muted'}>
                      <td><div className="pap-cell-title">{m.nama}</div><div className="pap-cell-sub">{m.kode}{m.keterangan ? ` · ${m.keterangan}` : ''}{m.aktif ? '' : ' · nonaktif'}</div></td>
                      <td>{JENIS_LABEL[m.jenis]}</td>
                      <td className="pap-num">{m.harga ? `${rupiah(m.harga)}/${m.satuan}` : <span className="pap-status warning">Belum diisi</span>}</td>
                      <td>{diff === null || Math.abs(diff) < 0.01 ? '—' : <span className={`pap-trend ${diff > 0 ? 'up' : 'down'}`}>{diff > 0 ? <TrendingUp /> : <TrendingDown />} {diff.toFixed(1)}%</span>}</td>
                      <td>{m.density ?? '—'}</td>
                      <td>{formatDate(m.updated_at, true)}<div className="pap-cell-sub">{m.updated_by_name ?? ''}</div></td>
                      <td className="pap-nowrap">
                        <button className="pap-icon-button" aria-label={`Riwayat harga ${m.nama}`} onClick={() => setHistory(m)}><History /></button>
                        {data.canEditPrices && <button className="pap-icon-button" aria-label={`Edit ${m.nama}`} onClick={() => setForm(m)}><Pencil /></button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {data && tab === 'parameter' && <ParamsForm data={data} onSaved={flash} />}
      {data && tab === 'kalkulator' && <StandaloneCalc data={data} />}
      {data && tab === 'dokumen' && <DocForm data={data} onSaved={flash} />}
      {form && data && <MaterialForm initial={form === 'new' ? null : form} onClose={() => setForm(null)} onSaved={(t) => { setForm(null); flash(t) }} />}
      {history && <PriceHistory material={history} onClose={() => setHistory(null)} />}
    </>
  )
}

function ParamsForm({ data, onSaved }: { data: HppData; onSaved: (message: string) => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(HPP_PARAM_KEYS.map((k) => [k, String(data.params[k] ?? 0)])))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await api('/api/hpp', { method: 'PATCH', json: { params: values } })
      onSaved('Parameter biaya disimpan.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <form className="pap-table-card pap-settings-card" onSubmit={save}>
      <div className="pap-card-head"><div><h2>Parameter biaya produksi</h2><p>Dipakai semua perhitungan HPP. {data.canEditParams ? 'Admin / GM dapat mengubah.' : 'Hanya melihat.'}</p></div></div>
      {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
      <div className="pap-form-grid pap-settings-body">
        {HPP_PARAM_KEYS.map((k) => (
          <Field key={k} label={HPP_PARAM_LABEL[k]}>
            <input className="pap-input" inputMode="decimal" disabled={!data.canEditParams} value={values[k]} onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))} />
          </Field>
        ))}
        <p className="pap-hint full">Rumus: HPP/kg = (harga bahan × (1 + susut%) + blow + cetak × jumlah warna + bag making) × (1 + overhead%). HPP/pcs = HPP/kg × berat per pcs. Berat per pcs = (lebar + gusset) × panjang × 2 lapis × tebal × density bahan.</p>
      </div>
      {data.canEditParams && <div className="pap-settings-foot"><button className="pap-primary-button" disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan parameter'}</button></div>}
    </form>
  )
}

function DocForm({ data, onSaved }: { data: HppData; onSaved: (message: string) => void }) {
  const [values, setValues] = useState<Record<string, string>>({ ...data.doc })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k: string) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }))
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await api('/api/hpp', { method: 'PATCH', json: { doc: values } })
      onSaved('Data dokumen disimpan.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }
  const dis = !data.canEditParams
  return (
    <form className="pap-table-card pap-settings-card" onSubmit={save}>
      <div className="pap-card-head"><div><h2>Data perusahaan di surat penawaran</h2><p>Kop surat, rekening, syarat & ketentuan default, dan penandatangan.</p></div></div>
      {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
      <div className="pap-form-grid pap-settings-body">
        <Field label="Nama perusahaan"><input className="pap-input" disabled={dis} value={values.nama ?? ''} onChange={set('nama')} /></Field>
        <Field label="Telepon / WA"><input className="pap-input" disabled={dis} value={values.telepon ?? ''} onChange={set('telepon')} /></Field>
        <Field label="Alamat" full><textarea className="pap-input" rows={2} disabled={dis} value={values.alamat ?? ''} onChange={set('alamat')} /></Field>
        <Field label="Email"><input className="pap-input" disabled={dis} value={values.email ?? ''} onChange={set('email')} /></Field>
        <Field label="Penandatangan (nama & jabatan)"><input className="pap-input" disabled={dis} value={values.penandatangan ?? ''} onChange={set('penandatangan')} placeholder="Kosongkan = nama sales pembuat" /></Field>
        <Field label="Rekening pembayaran" full><textarea className="pap-input" rows={2} disabled={dis} value={values.rekening ?? ''} onChange={set('rekening')} placeholder="Bank ... a.n. PT. Pandawa Amerta Packindo No. rek ..." /></Field>
        <Field label="Syarat & ketentuan default" full><textarea className="pap-input" rows={4} disabled={dis} value={values.syarat ?? ''} onChange={set('syarat')} /></Field>
      </div>
      {!dis && <div className="pap-settings-foot"><button className="pap-primary-button" disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan data dokumen'}</button></div>}
    </form>
  )
}

function StandaloneCalc({ data }: { data: HppData }) {
  const [values, setValues] = useState<CalcValues>(() => emptyCalc(data.materials))
  const result = calcResult(values, data)
  return (
    <div className="pap-table-card pap-settings-card">
      <div className="pap-card-head"><div><h2>Kalkulator HPP</h2><p>Hitung cepat HPP & harga saran untuk satu produk dengan harga bahan dan parameter terbaru.</p></div></div>
      <div className="pap-settings-body">
        <CalcFields values={values} data={data} onChange={(patch) => setValues((v) => ({ ...v, ...patch }))} />
        <CalcSummary result={result} satuan={values.satuan} />
      </div>
    </div>
  )
}

function MaterialForm({ initial, onClose, onSaved }: { initial: Material | null; onClose: () => void; onSaved: (message: string) => void }) {
  const [values, setValues] = useState({
    kode: initial?.kode ?? '', nama: initial?.nama ?? '', jenis: initial?.jenis ?? 'resin', satuan: initial?.satuan ?? 'kg',
    harga: initial ? String(initial.harga) : '', density: initial?.density === null || !initial ? '' : String(initial.density), keterangan: initial?.keterangan ?? '',
    aktif: initial ? !!initial.aktif : true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }))
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (initial) await api(`/api/hpp/materials/${initial.id}`, { method: 'PATCH', json: values })
      else await api('/api/hpp/materials', { method: 'POST', json: values })
      onSaved(initial ? 'Bahan baku diperbarui.' : 'Bahan baku ditambahkan.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal title={initial ? `Edit ${initial.nama}` : 'Tambah bahan baku'} onClose={onClose}
      footer={<><span className="pap-spacer" /><button type="button" className="pap-btn" onClick={onClose}>Batal</button><button type="submit" form="material-form" className="pap-primary-button" disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</button></>}
    >
      <form id="material-form" className="pap-form-grid" onSubmit={submit}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Kode"><input className="pap-input" required maxLength={30} value={values.kode} onChange={set('kode')} placeholder="HDPE" /></Field>
        <Field label="Nama"><input className="pap-input" required maxLength={150} value={values.nama} onChange={set('nama')} /></Field>
        <Field label="Jenis"><select className="pap-select" value={values.jenis} onChange={set('jenis')}>{Object.entries(JENIS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Satuan"><input className="pap-input" maxLength={20} value={values.satuan} onChange={set('satuan')} /></Field>
        <Field label={`Harga per ${values.satuan || 'satuan'} (Rp)`}><input className="pap-input" inputMode="decimal" required value={values.harga} onChange={set('harga')} placeholder="18500" /></Field>
        <Field label="Density (g/cm³)" hint="Untuk resin: HDPE 0,95 · LDPE 0,92 · PP 0,90"><input className="pap-input" inputMode="decimal" value={values.density} onChange={set('density')} /></Field>
        <Field label="Keterangan" full><input className="pap-input" maxLength={500} value={values.keterangan} onChange={set('keterangan')} placeholder="Supplier, grade, dll." /></Field>
        <label className="pap-check full"><input type="checkbox" checked={values.aktif} onChange={(e) => setValues((v) => ({ ...v, aktif: e.target.checked }))} /><span>Aktif (bisa dipilih di kalkulator)</span></label>
      </form>
    </Modal>
  )
}

function PriceHistory({ material, onClose }: { material: Material; onClose: () => void }) {
  const [items, setItems] = useState<{ harga: number; created_at: string; updated_by_name: string | null }[] | null>(null)
  useEffect(() => { api<{ items: typeof items }>(`/api/hpp/materials/${material.id}`).then((r) => setItems(r.items)).catch(() => setItems([])) }, [material.id])
  return (
    <Modal title={`Riwayat harga ${material.nama}`} onClose={onClose}>
      {!items ? <p className="pap-muted">Memuat...</p> : (
        <table className="pap-compact-table">
          <thead><tr><th>Tanggal</th><th className="pap-num">Harga</th><th>Oleh</th></tr></thead>
          <tbody>{items.map((h, i) => <tr key={i}><td>{formatDate(h.created_at, true)}</td><td className="pap-num">{rupiah(h.harga)}</td><td>{h.updated_by_name ?? '—'}</td></tr>)}</tbody>
        </table>
      )}
      {items && !items.length && <p className="pap-muted">Belum ada riwayat.</p>}
    </Modal>
  )
}
