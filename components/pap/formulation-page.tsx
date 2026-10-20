'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Archive, Beaker, FlaskConical, Layers, Plus, Search, Trash2 } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { formatRupiah } from './accurate'
import { api, Field, formatDate, Modal, Notice } from './ui'

type Item = { material_id: number; kode: string; nama: string; jenis: string; satuan: string; persentase: number; keterangan: string | null; harga?: number }
export type Formulation = {
  id: number; kode: string; nama: string; jenis_plastik: string | null; tingkat_kualitas: string | null; product_id: number | null; product_nama: string | null; customer_name: string | null
  versi: number; status: 'aktif' | 'arsip'; catatan: string | null; created_at: string; updated_at: string; created_name: string; updated_name: string | null
  dipakai_aktif: number; dipakai_total: number; items: Item[]; total_persen: number; komposisi: string; biaya_per_kg: number | null; biaya_lengkap: boolean | null
}
type Material = { id: number; kode: string; nama: string; jenis: string; satuan: string; aktif: number }
type Can = { manage: boolean; cost: boolean }
type ListResponse = { items: Formulation[]; materials: Material[]; plasticTypes: string[]; can: Can }

const JENIS_BAHAN: Record<string, string> = { resin: 'Resin', pewarna: 'Pewarna', tinta: 'Tinta', aditif: 'Aditif', lainnya: 'Lainnya' }
// Teks formulasi yang disalin ke SPK
export const formulaSnapshot = (f: Pick<Formulation, 'kode' | 'versi' | 'nama' | 'komposisi'>) => `${f.kode} v${f.versi} · ${f.nama}\n${f.komposisi}`

export function FormulationPage(_props: { user: UserProfile }) {
  const [data, setData] = useState<ListResponse | null>(null)
  const [status, setStatus] = useState('aktif')
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState<Formulation | 'new' | null>(null)

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ status })
      if (q.trim()) params.set('q', q.trim())
      setData(await api<ListResponse>(`/api/formulations?${params}`))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [status, q])
  useEffect(() => {
    const timer = setTimeout(load, q ? 300 : 0)
    return () => clearTimeout(timer)
  }, [load, q])
  const flash = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 4000)
    load()
  }
  const items = data?.items ?? []
  const used = items.filter((f) => f.dipakai_aktif > 0).length

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">PPIC · PRODUKSI</p>
          <h1>Formulasi Produk</h1>
          <span>Database campuran bahan per formula (bahan dari Tabel HPP, total 100%). PPIC memilih formulasi saat menyusun SPK; komposisi yang berubah menaikkan versi formula.</span>
        </div>
        {data?.can.manage && <button className="pap-primary-button" onClick={() => setForm('new')}><Plus /> Formulasi baru</button>}
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {data && (
        <div className="pap-stat-grid">
          <div className="pap-stat-card"><div><span>Formulasi {status === 'arsip' ? 'diarsipkan' : status === 'semua' ? 'total' : 'aktif'}</span><strong>{items.length}</strong><small className="neutral">{data.materials.filter((m) => m.aktif).length} bahan baku di Tabel HPP</small></div><div className="pap-stat-icon stat-1"><FlaskConical /></div></div>
          <div className="pap-stat-card"><div><span>Dipakai SPK aktif</span><strong>{used}</strong><small className="neutral">formulasi sedang dipakai produksi</small></div><div className="pap-stat-icon stat-0"><Layers /></div></div>
          <div className="pap-stat-card"><div><span>Komposisi belum 100%</span><strong>{items.filter((f) => Math.abs(f.total_persen - 100) > 0.01).length}</strong><small className="neutral">perlu diperiksa PPIC</small></div><div className="pap-stat-icon stat-2"><Beaker /></div></div>
        </div>
      )}
      <div className="pap-table-card">
        <div className="pap-filters pap-filters-top">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari kode, nama, jenis, produk, customer..." /></label>
          <select className="pap-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter status">
            <option value="aktif">Aktif</option>
            <option value="arsip">Diarsipkan</option>
            <option value="semua">Semua</option>
          </select>
        </div>
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Formulasi</th><th>Komposisi bahan</th><th>Jenis · kualitas</th>{data?.can.cost && <th className="pap-num">Biaya bahan / kg</th>}<th>Dipakai</th></tr></thead>
            <tbody>
              {items.map((f) => (
                <tr key={f.id} className="pap-row-link" onClick={() => setForm(f)}>
                  <td className="pap-nowrap"><div className="pap-cell-title">{f.kode} <span className="pap-status neutral">v{f.versi}</span>{f.status === 'arsip' && <span className="pap-status neutral">Arsip</span>}</div><div className="pap-cell-sub">{f.nama}</div>{f.product_nama && <div className="pap-cell-sub">{f.product_nama}{f.customer_name ? ` · ${f.customer_name}` : ''}</div>}</td>
                  <td><FormulaBar items={f.items} />{Math.abs(f.total_persen - 100) > 0.01 && <div className="pap-cell-sub pap-text-danger">Total {f.total_persen}%</div>}</td>
                  <td>{f.jenis_plastik ?? '—'}<div className="pap-cell-sub">{f.tingkat_kualitas ?? ''}</div></td>
                  {data?.can.cost && <td className="pap-num pap-nowrap">{f.biaya_per_kg === null ? '—' : formatRupiah(f.biaya_per_kg)}{f.biaya_per_kg !== null && f.biaya_lengkap === false && <div className="pap-cell-sub">sebagian harga kosong</div>}</td>}
                  <td className="pap-nowrap">{f.dipakai_aktif ? <span className="pap-status info">{f.dipakai_aktif} SPK aktif</span> : <span className="pap-muted">—</span>}<div className="pap-cell-sub">{f.dipakai_total} total</div></td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && !items.length && <div className="pap-empty">{q ? 'Tidak ada formulasi yang cocok.' : status === 'arsip' ? 'Belum ada formulasi diarsipkan.' : 'Belum ada formulasi. PPIC dapat menambahkan formulasi baru.'}</div>}
          {!data && <div className="pap-empty">Memuat formulasi...</div>}
        </div>
      </div>
      {form && data && <FormulationForm initial={form === 'new' ? null : form} materials={data.materials} plasticTypes={data.plasticTypes} can={data.can} onClose={() => setForm(null)} onSaved={(t) => { setForm(null); flash(t) }} />}
    </>
  )
}

// Batang komposisi: lebar sesuai persentase
const BAR_COLORS = ['#7c5cfc', '#1db98a', '#f5a524', '#0096cf', '#ef5a3c', '#be185d', '#64748b']
export function FormulaBar({ items }: { items: Pick<Item, 'nama' | 'persentase'>[] }) {
  return (
    <div className="pap-formula">
      <div className="pap-formula-bar">{items.map((i, n) => <span key={n} style={{ width: `${Math.max(0, i.persentase)}%`, background: BAR_COLORS[n % BAR_COLORS.length] }} title={`${i.nama} ${i.persentase}%`} />)}</div>
      <div className="pap-formula-legend">{items.map((i, n) => <span key={n}><i style={{ background: BAR_COLORS[n % BAR_COLORS.length] }} />{i.nama} <b>{Number(i.persentase).toLocaleString('id-ID', { maximumFractionDigits: 3 })}%</b></span>)}</div>
    </div>
  )
}

type Row = { key: number; material_id: string; persentase: string; keterangan: string }
type Product = { id: number; nama: string; kode: string | null; customer_name: string | null }

function FormulationForm({ initial, materials, plasticTypes, can, onClose, onSaved }: {
  initial: Formulation | null; materials: Material[]; plasticTypes: string[]; can: Can; onClose: () => void; onSaved: (text: string) => void
}) {
  const readOnly = !can.manage
  const [values, setValues] = useState({
    kode: initial?.kode ?? '', nama: initial?.nama ?? '', jenis_plastik: initial?.jenis_plastik ?? '', tingkat_kualitas: initial?.tingkat_kualitas ?? '',
    status: initial?.status ?? 'aktif', catatan: initial?.catatan ?? '',
  })
  const [rows, setRows] = useState<Row[]>(initial?.items.length ? initial.items.map((i, n) => ({ key: n, material_id: String(i.material_id), persentase: String(i.persentase), keterangan: i.keterangan ?? '' })) : [{ key: 0, material_id: '', persentase: '', keterangan: '' }])
  const [product, setProduct] = useState<Product | null>(initial?.product_id ? { id: initial.product_id, nama: initial.product_nama ?? '', kode: null, customer_name: initial.customer_name } : null)
  const [productQ, setProductQ] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [jobs, setJobs] = useState<{ id: number; nomor: string; spk_nomor: string | null; item_name: string; status: string; customer_name: string | null }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (initial) api<{ jobs: typeof jobs }>(`/api/formulations/${initial.id}`).then((r) => setJobs(r.jobs)).catch(() => {})
  }, [initial])
  useEffect(() => {
    if (productQ.trim().length < 2) return setProducts([])
    const timer = setTimeout(() => api<{ items: Product[] }>(`/api/formulations/products?q=${encodeURIComponent(productQ.trim())}`).then((r) => setProducts(r.items)).catch(() => {}), 300)
    return () => clearTimeout(timer)
  }, [productQ])

  const total = useMemo(() => Math.round(rows.reduce((sum, r) => sum + (Number(r.persentase.replace(',', '.')) || 0), 0) * 1000) / 1000, [rows])
  const setRow = (key: number, field: keyof Row, value: string) => setRows((list) => list.map((r) => (r.key === key ? { ...r, [field]: value } : r)))
  const materialName = (id: string) => materials.find((m) => String(m.id) === id)?.nama ?? ''
  const changedComposition = initial && rows.map((r) => `${r.material_id}:${Number(r.persentase.replace(',', '.'))}`).sort().join('|') !== initial.items.map((i) => `${i.material_id}:${i.persentase}`).sort().join('|')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const json = { ...values, product_id: product?.id ?? null, items: rows.map((r) => ({ material_id: r.material_id, persentase: r.persentase, keterangan: r.keterangan })) }
      await api(initial ? `/api/formulations/${initial.id}` : '/api/formulations', { method: initial ? 'PUT' : 'POST', json })
      onSaved(initial ? `Formulasi ${values.kode} disimpan${changedComposition ? ` sebagai versi ${initial.versi + 1}` : ''}.` : `Formulasi ${values.kode} ditambahkan.`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    if (!initial || !window.confirm(`Hapus formulasi ${initial.kode}?`)) return
    setBusy(true)
    try {
      await api(`/api/formulations/${initial.id}`, { method: 'DELETE' })
      onSaved(`Formulasi ${initial.kode} dihapus.`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      wide
      title={initial ? `${initial.kode} · ${initial.nama}` : 'Formulasi baru'}
      subtitle={initial ? `Versi ${initial.versi} · dibuat ${initial.created_name} ${formatDate(initial.created_at)}${initial.updated_name ? ` · diubah ${initial.updated_name} ${formatDate(initial.updated_at, true)}` : ''}` : 'Campuran bahan baku dari Tabel HPP, total harus 100%.'}
      onClose={onClose}
      footer={
        <>
          {!readOnly && initial && !initial.dipakai_total && <button className="pap-btn danger" disabled={busy} onClick={remove}><Trash2 /> Hapus</button>}
          {!readOnly && initial && initial.dipakai_total > 0 && values.status === 'aktif' && <button className="pap-btn" disabled={busy} onClick={() => setValues((v) => ({ ...v, status: 'arsip' }))}><Archive /> Arsipkan</button>}
          <span className="pap-spacer" />
          <button className="pap-btn" onClick={onClose}>{readOnly ? 'Tutup' : 'Batal'}</button>
          {!readOnly && <button className="pap-primary-button" form="formulation-form" disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan formulasi'}</button>}
        </>
      }
    >
      <form id="formulation-form" className="pap-form-grid" onSubmit={submit}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <fieldset className="pap-fieldset full" disabled={readOnly}>
          <div className="pap-form-grid">
            <Field label="Kode"><input className="pap-input" required maxLength={30} value={values.kode} onChange={(e) => setValues((v) => ({ ...v, kode: e.target.value.toUpperCase() }))} placeholder="mis. HD-JINJING-A" /></Field>
            <Field label="Nama formulasi"><input className="pap-input" required maxLength={200} value={values.nama} onChange={(e) => setValues((v) => ({ ...v, nama: e.target.value }))} placeholder="mis. Kantong HD jinjing putih" /></Field>
            <Field label="Jenis plastik">
              <select className="pap-select" value={values.jenis_plastik} onChange={(e) => setValues((v) => ({ ...v, jenis_plastik: e.target.value }))}>
                <option value="">—</option>
                {plasticTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Tingkat kualitas"><input className="pap-input" maxLength={100} value={values.tingkat_kualitas} onChange={(e) => setValues((v) => ({ ...v, tingkat_kualitas: e.target.value }))} placeholder="mis. Grade A, food grade" /></Field>
            <Field label="Khusus produk customer (opsional)" full hint="Kosong = formulasi umum yang bisa dipakai banyak produk.">
              {product ? (
                <div className="pap-inline-actions"><span className="pap-status info">{product.nama}{product.customer_name ? ` · ${product.customer_name}` : ''}</span>{!readOnly && <button type="button" className="pap-link-button" onClick={() => setProduct(null)}>Lepas</button>}</div>
              ) : (
                <>
                  <input className="pap-input" value={productQ} onChange={(e) => setProductQ(e.target.value)} placeholder="Cari nama produk / customer..." />
                  {products.length > 0 && (
                    <div className="pap-pick-list">{products.map((p) => <button type="button" key={p.id} onClick={() => { setProduct(p); setProductQ(''); setProducts([]) }}>{p.nama}<small>{[p.kode, p.customer_name].filter(Boolean).join(' · ')}</small></button>)}</div>
                  )}
                </>
              )}
            </Field>
            <div className="full">
              <div className="pap-section-head">
                <span className="pap-field-label">Campuran bahan</span>
                <span className={`pap-status ${Math.abs(total - 100) <= 0.01 ? 'success' : 'danger'}`}>Total {total.toLocaleString('id-ID', { maximumFractionDigits: 3 })}%</span>
              </div>
              <div className="pap-formula-rows">
                {rows.map((r) => (
                  <div key={r.key} className="pap-formula-row">
                    <select className="pap-select" required value={r.material_id} onChange={(e) => setRow(r.key, 'material_id', e.target.value)} aria-label="Bahan">
                      <option value="">— Pilih bahan —</option>
                      {Object.entries(JENIS_BAHAN).map(([jenis, label]) => {
                        const list = materials.filter((m) => m.jenis === jenis && (m.aktif || String(m.id) === r.material_id))
                        return list.length ? <optgroup key={jenis} label={label}>{list.map((m) => <option key={m.id} value={m.id} disabled={rows.some((x) => x.key !== r.key && x.material_id === String(m.id))}>{m.nama} ({m.kode})</option>)}</optgroup> : null
                      })}
                    </select>
                    <label className="pap-input-suffix"><input className="pap-input" inputMode="decimal" required value={r.persentase} onChange={(e) => setRow(r.key, 'persentase', e.target.value)} placeholder="0" aria-label="Persentase" /><span>%</span></label>
                    <input className="pap-input" maxLength={255} value={r.keterangan} onChange={(e) => setRow(r.key, 'keterangan', e.target.value)} placeholder="Keterangan (opsional)" aria-label="Keterangan" />
                    {!readOnly && <button type="button" className="pap-icon-button" aria-label="Hapus bahan" disabled={rows.length === 1} onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))}><Trash2 /></button>}
                  </div>
                ))}
              </div>
              {!readOnly && (
                <div className="pap-inline-actions">
                  <button type="button" className="pap-btn" onClick={() => setRows((list) => [...list, { key: Date.now(), material_id: '', persentase: list.length ? String(Math.max(0, Math.round((100 - total) * 1000) / 1000) || '') : '100', keterangan: '' }])}><Plus /> Tambah bahan</button>
                  {!materials.length && <small className="pap-text-danger">Belum ada bahan baku. Tambahkan dulu di Tabel HPP (Purchasing).</small>}
                </div>
              )}
              {rows.some((r) => r.material_id) && <FormulaBar items={rows.filter((r) => r.material_id).map((r) => ({ nama: materialName(r.material_id), persentase: Number(r.persentase.replace(',', '.')) || 0 }))} />}
              {changedComposition && <small className="pap-hint">Komposisi berubah: disimpan sebagai versi {initial!.versi + 1}. SPK yang sudah terbit tetap memakai salinan komposisi lama.</small>}
            </div>
            <Field label="Status">
              <select className="pap-select" value={values.status} onChange={(e) => setValues((v) => ({ ...v, status: e.target.value as 'aktif' | 'arsip' }))}>
                <option value="aktif">Aktif (bisa dipilih di SPK)</option>
                <option value="arsip">Arsip</option>
              </select>
            </Field>
            {initial && can.cost && <Field label="Biaya bahan per kg">{initial.biaya_per_kg === null ? <span className="pap-muted">Harga bahan belum diisi di Tabel HPP</span> : <strong>{formatRupiah(initial.biaya_per_kg)}{initial.biaya_lengkap === false ? ' (sebagian harga kosong)' : ''}</strong>}</Field>}
            <Field label="Catatan proses" full><textarea className="pap-input" rows={3} maxLength={5000} value={values.catatan} onChange={(e) => setValues((v) => ({ ...v, catatan: e.target.value }))} placeholder="Suhu, urutan pencampuran, standar ketebalan, dll." /></Field>
          </div>
        </fieldset>
        {jobs.length > 0 && (
          <div className="full">
            <span className="pap-field-label">Dipakai di SPK</span>
            <ul className="pap-formula-jobs">{jobs.map((j) => <li key={j.id}><b>{j.spk_nomor ?? j.nomor}</b> · {j.item_name}{j.customer_name ? ` · ${j.customer_name}` : ''} <span className="pap-status neutral">{j.status}</span></li>)}</ul>
          </div>
        )}
      </form>
    </Modal>
  )
}
