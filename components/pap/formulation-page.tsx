'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { FlaskConical, Layers, PackageSearch, Plus, Search, Trash2 } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { AccurateSyncBar, formatNumber } from './accurate'
import { api, Field, formatDate, Modal, Notice, Pager } from './ui'

// Formulasi = Bill of Material (Formula Produksi) Accurate + data PPIC (jenis plastik, kualitas, catatan)
type Item = { line_id?: number; item_accurate_id: number | null; item_no: string | null; nama: string; quantity: number; unit: string | null; per_unit: number; persentase: number; stok: number | null }
export type Formulation = {
  key: string; id: number | null; bom_accurate_id: number; kode: string; nama: string; item_accurate_id: number | null; item_no: string | null
  hasil: number; unit: string | null; tanggal: string | null; deskripsi: string | null; jenis_plastik: string | null; tingkat_kualitas: string | null; catatan: string | null
  status: 'aktif' | 'arsip'; suspended: boolean; customer_name: string | null; synced_at: string; dipakai_aktif: number; dipakai_total: number
  items: Item[]; total_bahan: number; komposisi: string
}
type AccItem = { accurate_id: number; item_no: string | null; name: string; unit: string | null; category: string | null; stok: number | null; murni: boolean }
type ListResponse = { items: Formulation[]; total: number; page: number; pageSize: number; plasticTypes: string[]; bom: { total: number; synced: number }; can: { manage: boolean } }

const qtyText = (v: number | null | undefined, unit: string | null | undefined, digits = 4) => (v === null || v === undefined ? '—' : `${formatNumber(v, digits)} ${unit ?? ''}`.trim())
// Teks formulasi yang disalin ke SPK; dengan target: kebutuhan bahan = jumlah per hasil × target
export function formulaSnapshot(f: Pick<Formulation, 'kode' | 'nama' | 'komposisi' | 'items' | 'unit'>, target?: number | null, targetUnit?: string | null) {
  const lines = [`${f.kode} · ${f.nama}`, f.komposisi]
  if (target && f.items.length && (!targetUnit || !f.unit || targetUnit.toLowerCase() === f.unit.toLowerCase())) {
    lines.push(`Kebutuhan bahan untuk target ${formatNumber(target)} ${targetUnit ?? f.unit ?? ''}: ${f.items.map((i) => `${i.nama} ${formatNumber(i.per_unit * target)} ${i.unit ?? ''}`.trim()).join(' · ')}`)
  }
  return lines.join('\n')
}

export function FormulationPage(_props: { user: UserProfile }) {
  const [data, setData] = useState<ListResponse | null>(null)
  const [status, setStatus] = useState('aktif')
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [open, setOpen] = useState<number | 'new' | null>(null)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(25)

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ status, page: String(page), pageSize: String(size) })
      if (q.trim()) params.set('q', q.trim())
      setData(await api<ListResponse>(`/api/formulations?${params}`))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [status, q, page, size])
  useEffect(() => setPage(1), [status, q])
  useEffect(() => {
    const timer = setTimeout(load, q ? 300 : 0)
    return () => clearTimeout(timer)
  }, [load, q])
  const flash = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 5000)
    load()
  }
  const items = data?.items ?? []

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">PPIC · PRODUKSI</p>
          <h1>Formulasi Produk</h1>
          <span>Formula produksi (Bill of Material) dari Accurate: barang jadi dan bahan baku per satuan hasil, beserta stok bahan. Formula baru dan perubahan bahan langsung disimpan ke Accurate.</span>
        </div>
        {data?.can.manage && <button className="pap-primary-button" onClick={() => setOpen('new')}><Plus /> Formulasi baru</button>}
      </div>
      <AccurateSyncBar entities={['bill-of-material', 'bill-of-material-detail']} canSync onSynced={load} />
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {data && (
        <div className="pap-stat-grid">
          <div className="pap-stat-card"><div><span>Formula di Accurate</span><strong>{data.bom.total.toLocaleString('id-ID')}</strong><small className="neutral">{data.bom.synced < data.bom.total ? `bahan ${data.bom.synced.toLocaleString('id-ID')} formula sudah tersinkron` : 'semua bahan sudah tersinkron'}</small></div><div className="pap-stat-icon stat-1"><FlaskConical /></div></div>
          <div className="pap-stat-card"><div><span>Dipakai SPK aktif</span><strong>{items.filter((f) => f.dipakai_aktif > 0).length}</strong><small className="neutral">dari {items.length} formula di halaman ini</small></div><div className="pap-stat-icon stat-0"><Layers /></div></div>
          <div className="pap-stat-card"><div><span>Bahan stok kosong</span><strong>{new Set(items.flatMap((f) => f.items.filter((i) => i.stok !== null && i.stok <= 0).map((i) => i.item_accurate_id))).size}</strong><small className="neutral">bahan pada formula yang tampil</small></div><div className="pap-stat-icon stat-2"><PackageSearch /></div></div>
        </div>
      )}
      <div className="pap-table-card">
        <div className="pap-filters pap-filters-top">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nomor BOM, barang jadi, bahan, customer..." /></label>
          <select className="pap-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter status">
            <option value="aktif">Aktif</option>
            <option value="arsip">Diarsipkan / nonaktif</option>
            <option value="semua">Semua</option>
          </select>
        </div>
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Formula (BOM)</th><th>Barang jadi</th><th>Bahan per 1 satuan hasil</th><th>Jenis · kualitas</th><th>Dipakai</th></tr></thead>
            <tbody>
              {items.map((f) => (
                <tr key={f.key} className="pap-row-link" onClick={() => setOpen(f.bom_accurate_id)}>
                  <td className="pap-nowrap"><div className="pap-cell-title">{f.kode}</div><div className="pap-cell-sub">{formatDate(f.tanggal)}{f.status === 'arsip' ? ' · arsip' : ''}</div></td>
                  <td><div className="pap-cell-title">{f.nama}</div><div className="pap-cell-sub">{[f.item_no, f.customer_name].filter(Boolean).join(' · ')} · hasil {qtyText(f.hasil, f.unit)}</div></td>
                  <td>{f.items.length ? <FormulaBar items={f.items} /> : <span className="pap-muted">Bahan belum tersinkron</span>}</td>
                  <td>{f.jenis_plastik ?? '—'}<div className="pap-cell-sub">{f.tingkat_kualitas ?? ''}</div></td>
                  <td className="pap-nowrap">{f.dipakai_aktif ? <span className="pap-status info">{f.dipakai_aktif} SPK aktif</span> : <span className="pap-muted">—</span>}{f.dipakai_total > 0 && <div className="pap-cell-sub">{f.dipakai_total} total</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && !items.length && <div className="pap-empty">{q ? 'Tidak ada formula yang cocok.' : data.bom.total ? 'Tidak ada formula pada filter ini.' : 'Belum ada formula. Klik "Sinkron sekarang" untuk mengambil Bill of Material dari Accurate.'}</div>}
          {data && <Pager page={page} pageSize={size} total={data.total} onPage={setPage} onPageSize={(v) => { setSize(v); setPage(1) }} noun="formula" />}
          {!data && <div className="pap-empty">Memuat formulasi...</div>}
        </div>
      </div>
      {open && data && <FormulationForm bomId={open === 'new' ? null : open} plasticTypes={data.plasticTypes} canManage={data.can.manage} onClose={() => setOpen(null)} onSaved={(t) => { setOpen(null); flash(t) }} />}
    </>
  )
}

// Batang komposisi: lebar sesuai porsi bahan dalam campuran
const BAR_COLORS = ['#7c5cfc', '#1db98a', '#f5a524', '#0096cf', '#ef5a3c', '#be185d', '#64748b']
export function FormulaBar({ items }: { items: Pick<Item, 'nama' | 'persentase' | 'per_unit' | 'unit'>[] }) {
  return (
    <div className="pap-formula">
      <div className="pap-formula-bar">{items.map((i, n) => <span key={n} style={{ width: `${Math.max(0, i.persentase)}%`, background: BAR_COLORS[n % BAR_COLORS.length] }} title={`${i.nama} ${i.persentase}%`} />)}</div>
      <div className="pap-formula-legend">{items.map((i, n) => <span key={n}><i style={{ background: BAR_COLORS[n % BAR_COLORS.length] }} />{i.nama} <b>{formatNumber(i.per_unit, 4)} {i.unit ?? ''}</b></span>)}</div>
    </div>
  )
}

type Row = { key: number; line_id: number | null; item_accurate_id: string; quantity: string; unit: string }

function FormulationForm({ bomId, plasticTypes, canManage, onClose, onSaved }: {
  bomId: number | null; plasticTypes: string[]; canManage: boolean; onClose: () => void; onSaved: (text: string) => void
}) {
  const [item, setItem] = useState<Formulation | null>(null)
  const [jobs, setJobs] = useState<{ id: number; nomor: string; spk_nomor: string | null; item_name: string; status: string; customer_name: string | null }[]>([])
  const [materials, setMaterials] = useState<AccItem[]>([])
  const [product, setProduct] = useState<AccItem | null>(null)
  const [productQ, setProductQ] = useState('')
  const [products, setProducts] = useState<AccItem[]>([])
  const [hasil, setHasil] = useState('1')
  const [rows, setRows] = useState<Row[]>([{ key: 0, line_id: null, item_accurate_id: '', quantity: '', unit: '' }])
  const [extras, setExtras] = useState({ jenis_plastik: '', tingkat_kualitas: '', catatan: '', status: 'aktif' })
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(!!bomId)
  const [error, setError] = useState('')

  useEffect(() => {
    if (canManage) api<{ items: AccItem[] }>('/api/formulations/items?kind=bahan').then((r) => setMaterials(r.items)).catch((e) => setError(e.message))
    if (!bomId) return
    api<{ item: Formulation; jobs: typeof jobs }>(`/api/formulations/${bomId}`).then((r) => {
      setItem(r.item)
      setJobs(r.jobs)
      setHasil(String(r.item.hasil))
      setRows(r.item.items.map((i, n) => ({ key: n, line_id: i.line_id ?? null, item_accurate_id: i.item_accurate_id ? String(i.item_accurate_id) : '', quantity: String(i.quantity), unit: i.unit ?? '' })))
      setExtras({ jenis_plastik: r.item.jenis_plastik ?? '', tingkat_kualitas: r.item.tingkat_kualitas ?? '', catatan: r.item.catatan ?? '', status: r.item.status })
    }).catch((e) => setError(e.message)).finally(() => setLoading(false))
  }, [bomId, canManage])
  useEffect(() => {
    if (productQ.trim().length < 2) return setProducts([])
    const timer = setTimeout(() => api<{ items: AccItem[] }>(`/api/formulations/items?kind=jadi&q=${encodeURIComponent(productQ.trim())}`).then((r) => setProducts(r.items)).catch(() => {}), 300)
    return () => clearTimeout(timer)
  }, [productQ])

  const matById = useMemo(() => new Map(materials.map((m) => [String(m.accurate_id), m])), [materials])
  const total = rows.reduce((sum, r) => sum + (Number(r.quantity.replace(',', '.')) || 0), 0)
  const hasilNum = Number(hasil.replace(',', '.')) || 1
  const unitHasil = item?.unit ?? product?.unit ?? ''
  const setRow = (key: number, field: keyof Row, value: string) => setRows((list) => list.map((r) => (r.key === key ? { ...r, [field]: value, ...(field === 'item_accurate_id' ? { unit: matById.get(value)?.unit ?? r.unit } : {}) } : r)))
  // Bahan yang sudah ada di formula tapi tidak (lagi) bertanda Bahan Baku tetap bisa ditampilkan
  const optionFor = (id: string) => matById.get(id) ?? (item?.items.find((i) => String(i.item_accurate_id) === id) ? { accurate_id: Number(id), item_no: item.items.find((i) => String(i.item_accurate_id) === id)!.item_no, name: item.items.find((i) => String(i.item_accurate_id) === id)!.nama, unit: null, category: null, stok: null, murni: true } : null)
  const materialsChanged = !item || hasilNum !== item.hasil || rows.length !== item.items.length
    || rows.some((r, idx) => String(item.items[idx]?.item_accurate_id ?? '') !== r.item_accurate_id || item.items[idx]?.quantity !== Number(r.quantity.replace(',', '.')) || (item.items[idx]?.unit ?? '') !== r.unit)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const payload = {
        ...extras,
        ...(materialsChanged ? { hasil, items: rows.map((r) => ({ line_id: r.line_id, item_accurate_id: r.item_accurate_id, quantity: r.quantity, unit: r.unit })) } : {}),
        ...(!bomId ? { item_accurate_id: product?.accurate_id } : {}),
      }
      const res = await api<{ item: Formulation }>(bomId ? `/api/formulations/${bomId}` : '/api/formulations', { method: bomId ? 'PUT' : 'POST', json: payload })
      onSaved(bomId ? `Formula ${res.item.kode} disimpan${materialsChanged ? ' dan bahan diperbarui di Accurate' : ''}.` : `Formula ${res.item.kode} dibuat di Accurate.`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const readOnly = !canManage
  return (
    <Modal
      wide
      title={item ? `${item.kode} · ${item.nama}` : bomId ? 'Formulasi' : 'Formulasi baru (Bill of Material Accurate)'}
      subtitle={item ? `Bill of Material Accurate · ${formatDate(item.tanggal)} · diperbarui dari Accurate ${formatDate(item.synced_at, true)}` : 'Disimpan ke Accurate sebagai Bill of Material (Formula Produksi), lalu tampil di PAP-MS.'}
      onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>{readOnly ? 'Tutup' : 'Batal'}</button>{!readOnly && <button className="pap-primary-button" form="formulation-form" disabled={busy || loading}>{busy ? 'Menyimpan ke Accurate...' : 'Simpan'}</button>}</>}
    >
      {loading ? <p className="pap-muted">Memuat formula dari Accurate...</p> : (
        <form id="formulation-form" className="pap-form-grid" onSubmit={submit}>
          {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
          <fieldset className="pap-fieldset full" disabled={readOnly}>
            <div className="pap-form-grid">
              <Field label="Barang jadi (Accurate)" full hint={bomId ? 'Barang jadi formula tidak bisa diganti; buat formula baru bila perlu.' : 'Barang Accurate bertanda Diproduksi.'}>
                {item ? <div className="pap-inline-actions"><span className="pap-status info">{item.nama}{item.item_no ? ` · ${item.item_no}` : ''}</span>{item.customer_name && <small className="pap-muted">{item.customer_name}</small>}</div>
                  : product ? <div className="pap-inline-actions"><span className="pap-status info">{product.name}{product.item_no ? ` · ${product.item_no}` : ''}</span><button type="button" className="pap-link-button" onClick={() => setProduct(null)}>Ganti</button></div>
                  : (
                    <>
                      <input className="pap-input" value={productQ} onChange={(e) => setProductQ(e.target.value)} placeholder="Cari nama / kode barang jadi..." />
                      {products.length > 0 && <div className="pap-pick-list">{products.map((p) => <button type="button" key={p.accurate_id} onClick={() => { setProduct(p); setProductQ(''); setProducts([]) }}>{p.name}<small>{[p.item_no, p.category, p.unit].filter(Boolean).join(' · ')}</small></button>)}</div>}
                    </>
                  )}
              </Field>
              <Field label={`Jumlah hasil per formula${unitHasil ? ` (${unitHasil})` : ''}`} hint="Umumnya 1, jumlah bahan dihitung per jumlah hasil ini."><input className="pap-input" inputMode="decimal" required value={hasil} onChange={(e) => setHasil(e.target.value)} /></Field>
              <div />
              <div className="full">
                <div className="pap-section-head">
                  <span className="pap-field-label">Bahan baku (barang Accurate bertanda Bahan Baku)</span>
                  <span className="pap-status neutral">Total {formatNumber(total, 4)} per {formatNumber(hasilNum)} {unitHasil}</span>
                </div>
                <div className="pap-formula-rows">
                  {rows.map((r) => {
                    const m = optionFor(r.item_accurate_id)
                    const qty = Number(r.quantity.replace(',', '.')) || 0
                    return (
                      <div key={r.key} className="pap-formula-row pap-bom-row">
                        <select className="pap-select" required value={r.item_accurate_id} onChange={(e) => setRow(r.key, 'item_accurate_id', e.target.value)} aria-label="Bahan">
                          <option value="">— Pilih bahan —</option>
                          {r.item_accurate_id && !matById.has(r.item_accurate_id) && m && <option value={r.item_accurate_id}>{m.name}</option>}
                          <optgroup label="Bahan baku murni">{materials.filter((x) => x.murni).map((x) => <option key={x.accurate_id} value={x.accurate_id} disabled={rows.some((o) => o.key !== r.key && o.item_accurate_id === String(x.accurate_id))}>{x.name}{x.item_no ? ` (${x.item_no})` : ''}</option>)}</optgroup>
                          <optgroup label="Barang setengah jadi / BS">{materials.filter((x) => !x.murni).map((x) => <option key={x.accurate_id} value={x.accurate_id} disabled={rows.some((o) => o.key !== r.key && o.item_accurate_id === String(x.accurate_id))}>{x.name}{x.item_no ? ` (${x.item_no})` : ''}</option>)}</optgroup>
                        </select>
                        <input className="pap-input pap-num" inputMode="decimal" required value={r.quantity} onChange={(e) => setRow(r.key, 'quantity', e.target.value)} placeholder="0" aria-label="Jumlah" />
                        <input className="pap-input" maxLength={40} value={r.unit} onChange={(e) => setRow(r.key, 'unit', e.target.value)} placeholder="kg" aria-label="Satuan" />
                        <small className="pap-bom-info">{total > 0 ? `${formatNumber((qty / total) * 100, 1)}%` : ''}{m?.stok !== null && m?.stok !== undefined ? ` · stok ${formatNumber(m.stok)}` : ''}</small>
                        {!readOnly && <button type="button" className="pap-icon-button" aria-label="Hapus bahan" disabled={rows.length === 1} onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))}><Trash2 /></button>}
                      </div>
                    )
                  })}
                </div>
                {!readOnly && <button type="button" className="pap-btn" onClick={() => setRows((list) => [...list, { key: Date.now(), line_id: null, item_accurate_id: '', quantity: '', unit: '' }])}><Plus /> Tambah bahan</button>}
                {rows.some((r) => r.item_accurate_id) && total > 0 && <FormulaBar items={rows.filter((r) => r.item_accurate_id).map((r) => ({ nama: optionFor(r.item_accurate_id)?.name ?? '', persentase: ((Number(r.quantity.replace(',', '.')) || 0) / total) * 100, per_unit: (Number(r.quantity.replace(',', '.')) || 0) / hasilNum, unit: r.unit || null }))} />}
                {item && materialsChanged && <small className="pap-hint">Bahan berubah: perubahan disimpan ke Bill of Material {item.kode} di Accurate. SPK yang sudah terbit tetap memakai salinan komposisi lama.</small>}
              </div>
              <Field label="Jenis plastik (PAP-MS)">
                <select className="pap-select" value={extras.jenis_plastik} onChange={(e) => setExtras((v) => ({ ...v, jenis_plastik: e.target.value }))}>
                  <option value="">—</option>
                  {plasticTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Tingkat kualitas (PAP-MS)"><input className="pap-input" maxLength={100} value={extras.tingkat_kualitas} onChange={(e) => setExtras((v) => ({ ...v, tingkat_kualitas: e.target.value }))} placeholder="mis. Grade A, food grade" /></Field>
              <Field label="Status di PAP-MS">
                <select className="pap-select" value={extras.status} onChange={(e) => setExtras((v) => ({ ...v, status: e.target.value }))}>
                  <option value="aktif">Aktif (bisa dipilih di SPK)</option>
                  <option value="arsip">Arsip (disembunyikan dari SPK)</option>
                </select>
              </Field>
              <Field label="Catatan proses (PAP-MS)" full><textarea className="pap-input" rows={3} maxLength={5000} value={extras.catatan} onChange={(e) => setExtras((v) => ({ ...v, catatan: e.target.value }))} placeholder="Suhu, urutan pencampuran, standar ketebalan, dll." /></Field>
            </div>
          </fieldset>
          {jobs.length > 0 && (
            <div className="full">
              <span className="pap-field-label">Dipakai di SPK</span>
              <ul className="pap-formula-jobs">{jobs.map((j) => <li key={j.id}><b>{j.spk_nomor ?? j.nomor}</b> · {j.item_name}{j.customer_name ? ` · ${j.customer_name}` : ''} <span className="pap-status neutral">{j.status}</span></li>)}</ul>
            </div>
          )}
        </form>
      )}
    </Modal>
  )
}
