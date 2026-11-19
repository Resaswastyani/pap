'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Boxes, Copy, Download, FlaskConical, Layers, Plus, Save, Scale, Search, Trash2, TrendingUp, X } from 'lucide-react'
import { calcProjection, materialKey, type ProjComp, type ProjItem, type ProjPrice } from '@/lib/projection-calc'
import { formatNumber, formatRupiah } from './accurate'
import { api, confirmDialog, formatDate, Notice, RowActions } from './ui'

// Riset & Proyeksi bahan baku: simulasi produk rencana + komposisi bahan + harga -> kebutuhan bahan, nilai, HPP, GPF

type Summary = {
  id: number; kode: string; nama: string; tanggal_mulai: string | null; tanggal_selesai: string | null; catatan: string | null; updated_at: string; updated_by_name: string | null
  produk: number; totals: ReturnType<typeof calcProjection>['totals']
}
type Detail = { id: number; kode: string; nama: string; tanggal_mulai: string | null; tanggal_selesai: string | null; catatan: string | null; items: ProjItem[]; prices: ProjPrice[]; stock: Record<string, number | null> }
type Material = { item_accurate_id: number; key: string; name: string; item_no: string | null; unit: string | null; jenis: string; dipakai: number; stok: number | null; harga: number | null; harga_sumber: string | null }
type Product = { id: number; item_no: string | null; name: string; unit: string | null; price: number | null }
type BomRes = { harga_jual: number | null; bom: { number: string | null; unit: string | null; berat: number; komposisi: (ProjComp & { unit: string; harga: number | null; harga_sumber: string | null })[] } | null }

const kg = (v: number | null | undefined, unit: string | null = 'kg') => (v === null || v === undefined ? '—' : `${formatNumber(v, Math.abs(v) >= 100 ? 0 : 2)}${unit ? ` ${unit}` : ''}`)
const short = (v: number | null | undefined) => {
  if (v === null || v === undefined) return '—'
  const a = Math.abs(v)
  return `Rp ${a >= 1e9 ? `${(v / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M` : a >= 1e6 ? `${(v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt` : Math.round(v).toLocaleString('id-ID')}`
}
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`)
const marginTone = (m: number | null) => (m === null ? 'neutral' : m < 0 ? 'danger' : m < 10 ? 'warning' : 'success')
// Angka gaya Indonesia: 29.549,5 / 1,051 / 1.5 (titik = ribuan hanya bila berkelompok 3 digit)
const toNum = (v: string) => {
  const t = v.trim()
  if (!t) return null
  const n = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
const fmtInput = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(Math.round(v * 10000) / 10000).replace('.', ','))

// Komposisi standar dari Excel "Proyeksi Produksi" (campuran HD Jinjing, dll.)
const PRESETS: { label: string; parts: [string, number][] }[] = [
  { label: 'HD Jinjing (HD 60 · HD KW 30 · PE 5 · Kalsium 5)', parts: [['HD', 60], ['HD KW', 30], ['PE', 5], ['Kalsium', 5]] },
  { label: 'HD 85 · Kalsium 15', parts: [['HD', 85], ['Kalsium', 15]] },
  { label: 'HD 90 · PE 10', parts: [['HD', 90], ['PE', 10]] },
  { label: 'PP 100', parts: [['PP', 100]] },
  { label: 'PE 70 · PE KW 30', parts: [['PE', 70], ['PE KW', 30]] },
]

export function ProjectionView() {
  const [data, setData] = useState<{ items: Summary[]; can: { edit: boolean } } | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<{ detail: Detail | null; copy?: boolean } | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await api('/api/production/riset'))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => { load() }, [load])

  async function open(id: number, copy = false) {
    try {
      const res = await api<{ item: Detail }>(`/api/production/riset/${id}`)
      setEditing({ detail: copy ? { ...res.item, id: 0, kode: '', nama: `${res.item.nama} (salinan)` } : res.item, copy })
    } catch (e) {
      setError((e as Error).message)
    }
  }
  async function remove(s: Summary) {
    if (!(await confirmDialog({ title: 'Hapus riset?', message: `${s.kode} · ${s.nama}\n\nRiset dipindah ke Data Terhapus dan bisa dipulihkan.`, confirmLabel: 'Hapus', tone: 'danger' }))) return
    try {
      await api(`/api/production/riset/${s.id}`, { method: 'DELETE' })
      setNotice(`Riset ${s.kode} dihapus.`)
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (editing) {
    return <ProjectionEditor detail={editing.detail} canEdit={data?.can.edit ?? false}
      onClose={() => setEditing(null)} onSaved={(msg) => { setEditing(null); setNotice(msg); load() }} />
  }

  const items = (data?.items ?? []).filter((s) => !q.trim() || `${s.kode} ${s.nama} ${s.catatan ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {notice && <Notice kind="success" onClose={() => setNotice('')}>{notice}</Notice>}
      <section className="pap-table-card">
        <div className="pap-card-head">
          <div><h2>Riset & proyeksi bahan baku</h2><p>Simulasi kebutuhan bahan, nilai Rupiah, HPP bahan, dan GPF untuk rencana produksi baru: tentukan produk, jumlah, komposisi bahan, dan harga sendiri.</p></div>
          {data?.can.edit && <button className="pap-primary-button" onClick={() => setEditing({ detail: null })}><Plus /> Riset baru</button>}
        </div>
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari kode atau nama riset..." /></label>
        </div>
        <div className="pap-proj-list">
          {items.map((s) => (
            <article key={s.id} className="pap-proj-card" onClick={() => open(s.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && open(s.id)}>
              <header>
                <div>
                  <span className="pap-proj-kode">{s.kode}</span>
                  <h3>{s.nama}</h3>
                  <small className="pap-muted">{s.tanggal_mulai || s.tanggal_selesai ? `${formatDate(s.tanggal_mulai)} – ${formatDate(s.tanggal_selesai)} · ` : ''}{s.produk} produk · diubah {formatDate(s.updated_at, true)}{s.updated_by_name ? ` oleh ${s.updated_by_name}` : ''}</small>
                </div>
                <div className="pap-proj-actions" onClick={(e) => e.stopPropagation()}>
                  {data?.can.edit && <button type="button" className="pap-row-action" title="Duplikat" aria-label={`Duplikat ${s.nama}`} onClick={() => open(s.id, true)}><Copy /><span>Duplikat</span></button>}
                  <RowActions label={s.nama} onEdit={data?.can.edit ? () => open(s.id) : undefined} onDelete={data?.can.edit ? () => remove(s) : undefined} />
                </div>
              </header>
              <dl className="pap-proj-metrics">
                <div><dt>Bahan</dt><dd>{kg(s.totals.bahan_kg)}</dd></div>
                <div><dt>HPP bahan</dt><dd>{short(s.totals.hpp)}</dd></div>
                <div><dt>Nilai jual</dt><dd>{short(s.totals.nilai)}</dd></div>
                <div><dt>GPF</dt><dd className={s.totals.gpf < 0 ? 'pap-ma-neg' : ''}>{short(s.totals.gpf)} <span className={`pap-ma-margin ${marginTone(s.totals.margin)}`}>{pct(s.totals.margin)}</span></dd></div>
              </dl>
            </article>
          ))}
        </div>
        {data && !items.length && <div className="pap-empty">{q ? 'Tidak ada riset yang cocok.' : data.can.edit ? 'Belum ada riset. Klik "Riset baru" untuk membuat proyeksi kebutuhan bahan baku.' : 'Belum ada riset bahan baku.'}</div>}
        {!data && !error && <div className="pap-empty">Memuat riset...</div>}
      </section>
    </>
  )
}

// ---------- Editor ----------
type Draft = { uid: number; item_accurate_id: number | null; item_no: string | null; nama: string; satuan: string; quantity: string; harga_jual: string; berat: string; waste: string; komposisi: { key: string; item_accurate_id: number | null; name: string; persen: string }[]; bom_number: string | null; catatan: string }
let uidSeq = 1
const toDraft = (it: ProjItem): Draft => ({
  uid: uidSeq++, item_accurate_id: it.item_accurate_id, item_no: it.item_no ?? null, nama: it.nama, satuan: it.satuan ?? 'kg', quantity: fmtInput(it.quantity), harga_jual: fmtInput(it.harga_jual),
  berat: fmtInput(it.berat), waste: fmtInput(it.waste), komposisi: it.komposisi.map((k) => ({ ...k, persen: fmtInput(k.persen) })), bom_number: it.bom_number, catatan: it.catatan ?? '',
})
const blankDraft = (): Draft => ({ uid: uidSeq++, item_accurate_id: null, item_no: null, nama: '', satuan: 'kg', quantity: '', harga_jual: '', berat: '1', waste: '5', komposisi: [], bom_number: null, catatan: '' })
const fromDraft = (d: Draft): ProjItem => ({
  item_accurate_id: d.item_accurate_id, item_no: d.item_no, nama: d.nama, satuan: d.satuan || 'kg', quantity: toNum(d.quantity) ?? 0, harga_jual: toNum(d.harga_jual),
  berat: toNum(d.berat) ?? 0, waste: toNum(d.waste) ?? 0, komposisi: d.komposisi.filter((k) => k.key && k.name.trim()).map((k) => ({ key: k.key, item_accurate_id: k.item_accurate_id, name: k.name, persen: toNum(k.persen) ?? 0 })),
  bom_number: d.bom_number, catatan: d.catatan || null,
})

function ProjectionEditor({ detail, canEdit, onClose, onSaved }: { detail: Detail | null; canEdit: boolean; onClose: () => void; onSaved: (msg: string) => void }) {
  const isNew = !detail?.id
  const [nama, setNama] = useState(detail?.nama ?? '')
  const [mulai, setMulai] = useState(detail?.tanggal_mulai ?? '')
  const [selesai, setSelesai] = useState(detail?.tanggal_selesai ?? '')
  const [catatan, setCatatan] = useState(detail?.catatan ?? '')
  const [drafts, setDrafts] = useState<Draft[]>(() => (detail?.items.length ? detail.items.map(toDraft) : [blankDraft()]))
  const [prices, setPrices] = useState<Record<string, { item_accurate_id: number | null; name: string; unit: string | null; harga: string; sumber: string | null }>>(() =>
    Object.fromEntries((detail?.prices ?? []).map((p) => [p.key, { item_accurate_id: p.item_accurate_id, name: p.name, unit: p.unit, harga: fmtInput(p.harga), sumber: p.sumber ?? null }])))
  const [stock, setStock] = useState<Record<string, number | null>>(detail?.stock ?? {})
  const [catalog, setCatalog] = useState<Material[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const readOnly = !canEdit

  useEffect(() => {
    api<{ items: Material[] }>('/api/production/riset/bahan').then((r) => setCatalog(r.items)).catch(() => {})
  }, [])

  // Harga & stok bahan saat bahan dipilih (sekali; harga boleh diubah)
  const rememberMaterial = useCallback((m: { key: string; item_accurate_id: number | null; name: string; unit?: string | null; harga?: number | null; harga_sumber?: string | null; stok?: number | null }) => {
    setPrices((p) => (p[m.key] ? p : { ...p, [m.key]: { item_accurate_id: m.item_accurate_id, name: m.name, unit: m.unit ?? 'kg', harga: fmtInput(m.harga ?? null), sumber: m.harga_sumber ?? (m.item_accurate_id ? null : 'Manual') } }))
    if (m.stok !== undefined) setStock((s) => (m.key in s ? s : { ...s, [m.key]: m.stok ?? null }))
  }, [])

  const items = drafts.map(fromDraft)
  const priceList: ProjPrice[] = Object.entries(prices).map(([key, p]) => ({ key, item_accurate_id: p.item_accurate_id, name: p.name, unit: p.unit, harga: toNum(p.harga), sumber: p.sumber }))
  const result = useMemo(() => calcProjection(items, priceList, stock), [drafts, prices, stock]) // eslint-disable-line react-hooks/exhaustive-deps
  const usedKeys = new Set(items.flatMap((i) => i.komposisi.map((k) => k.key)))
  const t = result.totals

  const update = (uid: number, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.uid === uid ? { ...d, ...patch } : d)))

  async function save() {
    setError('')
    if (!nama.trim()) return setError('Isi nama riset.')
    const bad = drafts.findIndex((d) => !d.nama.trim())
    if (bad >= 0) return setError(`Produk ${bad + 1}: isi nama produk.`)
    setBusy(true)
    try {
      const body = { nama, tanggal_mulai: mulai || null, tanggal_selesai: selesai || null, catatan, items, prices: priceList.filter((p) => usedKeys.has(p.key)) }
      if (isNew) {
        const res = await api<{ kode: string }>('/api/production/riset', { method: 'POST', json: body })
        onSaved(`Riset ${res.kode} disimpan.`)
      } else {
        await api(`/api/production/riset/${detail!.id}`, { method: 'PUT', json: body })
        onSaved(`Riset ${detail!.kode} diperbarui.`)
      }
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="pap-proj-editor">
      <div className="pap-proj-topbar">
        <button type="button" className="pap-btn" onClick={onClose}><ArrowLeft /> Kembali</button>
        <div className="pap-proj-title">
          <span className="pap-proj-kode">{isNew ? 'Riset baru' : detail!.kode}</span>
          <strong>{nama || 'Tanpa nama'}</strong>
        </div>
        {!isNew && <a className="pap-btn" href={`/api/production/riset/${detail!.id}/export`} download><Download /> Excel</a>}
      </div>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}

      <section className="pap-table-card pap-proj-section">
        <h3 className="pap-proj-h"><FlaskConical /> Informasi riset</h3>
        <div className="pap-proj-info">
          <label className="pap-field pap-proj-span2"><span>Nama riset *</span><input className="pap-input" maxLength={200} value={nama} onChange={(e) => setNama(e.target.value)} placeholder="mis. Proyeksi kebutuhan biji Desember 2026" disabled={readOnly} /></label>
          <label className="pap-field"><span>Periode mulai</span><input className="pap-input" type="date" value={mulai} max={selesai || undefined} onChange={(e) => setMulai(e.target.value)} disabled={readOnly} /></label>
          <label className="pap-field"><span>Periode selesai</span><input className="pap-input" type="date" value={selesai} min={mulai || undefined} onChange={(e) => setSelesai(e.target.value)} disabled={readOnly} /></label>
          <label className="pap-field pap-proj-span4"><span>Catatan / asumsi</span><textarea className="pap-input" rows={2} maxLength={3000} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="mis. harga biji per 13/11/26 termasuk PPN, target order online + offline" disabled={readOnly} /></label>
        </div>
      </section>

      <div className="pap-stat-grid four">
        <ResultTile label="Total bahan" value={kg(t.bahan_kg)} note={`${t.produk} produk · termasuk waste`} icon={Scale} tone="stat-1" />
        <ResultTile label="HPP bahan" value={short(t.hpp)} note={t.hpp_kg ? `${formatRupiah(t.hpp_kg)} per kg bahan` : 'Kebutuhan × harga bahan'} icon={Boxes} tone="stat-2" />
        <ResultTile label="Nilai jual" value={short(t.nilai)} note="Jumlah × harga jual" icon={Layers} tone="stat-1" />
        <ResultTile label="GPF (laba kotor)" value={short(t.gpf)} note={`Margin ${pct(t.margin)}`} icon={TrendingUp} tone={t.gpf < 0 ? 'stat-2' : 'stat-0'} />
      </div>
      {(t.komposisi_salah > 0 || t.tanpa_komposisi > 0 || t.harga_kosong > 0) && (
        <div className="pap-ma-issues" role="status">
          <span aria-hidden>⚠</span>
          <div>{[t.tanpa_komposisi ? `${t.tanpa_komposisi} produk belum ada komposisi bahan` : '', t.komposisi_salah ? `${t.komposisi_salah} produk komposisinya belum 100%` : '', t.harga_kosong ? `${t.harga_kosong} bahan belum ada harga` : ''].filter(Boolean).join(' · ')}.</div>
        </div>
      )}

      <section className="pap-proj-section">
        <div className="pap-proj-section-head">
          <h3 className="pap-proj-h"><Layers /> Produk yang diproyeksikan ({drafts.length})</h3>
          {!readOnly && <button type="button" className="pap-primary-button" onClick={() => setDrafts([...drafts, blankDraft()])}><Plus /> Tambah produk</button>}
        </div>
        <div className="pap-proj-products">
          {drafts.map((d, i) => (
            <ProductCard key={d.uid} index={i} draft={d} calc={result.items[i]} catalog={catalog} prices={prices} readOnly={readOnly}
              onChange={(patch) => update(d.uid, patch)} onRemove={drafts.length > 1 ? () => setDrafts(drafts.filter((x) => x.uid !== d.uid)) : undefined}
              onMaterial={rememberMaterial} />
          ))}
        </div>
      </section>

      <section className="pap-table-card pap-proj-section">
        <div className="pap-card-head"><div><h2>Harga bahan</h2><p>Harga per satuan bahan yang dipakai di riset ini (terisi dari harga acuan / rata-rata Accurate, bisa diubah, mis. harga supplier terbaru termasuk PPN).</p></div></div>
        <div className="pap-table-wrap">
          <table className="pap-ma-table">
            <thead><tr><th>Bahan</th><th className="pap-num">Kebutuhan</th><th className="pap-num">Harga per satuan (Rp)</th><th className="pap-num">Nilai</th><th className="pap-num">Stok Accurate</th><th className="pap-num">Kurang</th></tr></thead>
            <tbody>
              {result.materials.map((m) => {
                const p = prices[m.key]
                return (
                  <tr key={m.key}>
                    <td><div className="pap-cell-title">{m.name}</div><div className="pap-cell-sub">{p?.sumber ?? (m.item_accurate_id ? 'Accurate' : 'Bahan manual')} · {m.produk} produk</div></td>
                    <td className="pap-num pap-nowrap"><strong>{kg(m.kebutuhan, m.unit)}</strong></td>
                    <td className="pap-num">
                      <input className="pap-input pap-proj-price" inputMode="decimal" value={p?.harga ?? ''} disabled={readOnly} aria-label={`Harga ${m.name}`} placeholder="isi harga"
                        onChange={(e) => setPrices({ ...prices, [m.key]: { ...(p ?? { item_accurate_id: m.item_accurate_id, name: m.name, unit: m.unit, sumber: null }), harga: e.target.value.replace(/[^\d.,]/g, ''), sumber: 'Diisi di riset' } })} />
                    </td>
                    <td className="pap-num pap-nowrap"><strong>{formatRupiah(m.nilai)}</strong></td>
                    <td className="pap-num pap-nowrap">{kg(m.stok, m.unit)}</td>
                    <td className="pap-num pap-nowrap">{m.kurang ? <span className="pap-ma-short">{kg(m.kurang, m.unit)}</span> : m.stok === null ? '—' : <span className="pap-ma-ok">Cukup</span>}</td>
                  </tr>
                )
              })}
            </tbody>
            {!!result.materials.length && <tfoot><tr><td><b>Total</b></td><td className="pap-num"><b>{kg(result.materials.filter((m) => !m.unit || /^kg$/i.test(m.unit)).reduce((a, m) => a + m.kebutuhan, 0))}</b></td><td /><td className="pap-num"><b>{formatRupiah(result.materials.reduce((a, m) => a + m.nilai, 0))}</b></td><td colSpan={2} /></tr></tfoot>}
          </table>
          {!result.materials.length && <div className="pap-empty">Tambahkan komposisi bahan pada produk untuk melihat kebutuhan bahan.</div>}
        </div>
      </section>

      <section className="pap-table-card pap-proj-section">
        <div className="pap-card-head"><div><h2>HPP & GPF per produk</h2><p>HPP bahan = biaya bahan termasuk waste. GPF = nilai jual − HPP bahan (belum termasuk tenaga kerja & overhead).</p></div></div>
        <div className="pap-table-wrap">
          <table className="pap-ma-table">
            <thead><tr><th>Produk</th><th className="pap-num">Jumlah</th><th className="pap-num">Bahan</th><th className="pap-num">HPP/satuan</th><th className="pap-num">HPP bahan</th><th className="pap-num">Nilai jual</th><th className="pap-num">GPF</th><th className="pap-num">Margin</th></tr></thead>
            <tbody>
              {result.items.map((r, i) => (
                <tr key={drafts[i]?.uid ?? i}>
                  <td><div className="pap-cell-title">{r.nama || `Produk ${i + 1}`}</div>{r.komposisi.length > 0 && Math.abs(r.persen_total - 100) > 0.01 && <div className="pap-ma-flags"><span>Komposisi {pct(r.persen_total)}</span></div>}</td>
                  <td className="pap-num pap-nowrap">{kg(r.quantity, r.satuan)}</td>
                  <td className="pap-num pap-nowrap">{kg(r.bahan_kg)}</td>
                  <td className="pap-num pap-nowrap">{formatRupiah(r.hpp_unit)}</td>
                  <td className="pap-num pap-nowrap"><strong>{formatRupiah(r.hpp)}</strong></td>
                  <td className="pap-num pap-nowrap">{formatRupiah(r.nilai)}</td>
                  <td className={`pap-num pap-nowrap ${r.gpf !== null && r.gpf < 0 ? 'pap-ma-neg' : ''}`}><strong>{formatRupiah(r.gpf)}</strong></td>
                  <td className="pap-num"><span className={`pap-ma-margin ${marginTone(r.margin)}`}>{pct(r.margin)}</span></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td><b>Total</b></td><td /><td className="pap-num"><b>{kg(t.bahan_kg)}</b></td><td /><td className="pap-num"><b>{formatRupiah(t.hpp)}</b></td><td className="pap-num"><b>{formatRupiah(t.nilai)}</b></td><td className="pap-num"><b>{formatRupiah(t.gpf)}</b></td><td className="pap-num"><span className={`pap-ma-margin ${marginTone(t.margin)}`}>{pct(t.margin)}</span></td></tr></tfoot>
          </table>
        </div>
      </section>

      <div className="pap-proj-savebar">
        <div className="pap-proj-savebar-info"><span>HPP <b>{short(t.hpp)}</b></span><span>Nilai <b>{short(t.nilai)}</b></span><span>GPF <b className={t.gpf < 0 ? 'pap-ma-neg' : ''}>{short(t.gpf)}</b> ({pct(t.margin)})</span></div>
        <span className="pap-spacer" />
        <button type="button" className="pap-btn" onClick={onClose}>{readOnly ? 'Tutup' : 'Batal'}</button>
        {!readOnly && <button type="button" className="pap-primary-button" disabled={busy} onClick={save}><Save /> {busy ? 'Menyimpan...' : 'Simpan riset'}</button>}
      </div>
    </div>
  )
}

function ResultTile({ label, value, note, icon: Icon, tone }: { label: string; value: string; note: string; icon: typeof Scale; tone: string }) {
  return (
    <div className="pap-stat-card">
      <div><span>{label}</span><strong className="pap-stat-text">{value}</strong><small className="neutral">{note}</small></div>
      <div className={`pap-stat-icon ${tone}`}><Icon /></div>
    </div>
  )
}

type CalcRow = ReturnType<typeof calcProjection>['items'][number]
type MaterialPick = { key: string; item_accurate_id: number | null; name: string; unit?: string | null; harga?: number | null; harga_sumber?: string | null; stok?: number | null }

// Satu produk: identitas, jumlah & harga jual, berat bahan per satuan & waste, komposisi bahan
function ProductCard({ index, draft: d, calc, catalog, prices, readOnly, onChange, onRemove, onMaterial }: {
  index: number; draft: Draft; calc: CalcRow | undefined; catalog: Material[]; prices: Record<string, { harga: string }>; readOnly: boolean
  onChange: (patch: Partial<Draft>) => void; onRemove?: () => void; onMaterial: (m: MaterialPick) => void
}) {
  const [loadingBom, setLoadingBom] = useState(false)
  const [msg, setMsg] = useState('')
  const total = d.komposisi.reduce((a, k) => a + (toNum(k.persen) ?? 0), 0)

  async function fromBom(itemId = d.item_accurate_id) {
    if (!itemId) return
    setLoadingBom(true)
    setMsg('')
    try {
      const r = await api<BomRes>(`/api/production/riset/bom?item=${itemId}`)
      const patch: Partial<Draft> = {}
      if (r.harga_jual !== null && !d.harga_jual) patch.harga_jual = fmtInput(r.harga_jual)
      if (r.bom) {
        r.bom.komposisi.forEach((k) => onMaterial(k))
        Object.assign(patch, { komposisi: r.bom.komposisi.map((k) => ({ key: k.key, item_accurate_id: k.item_accurate_id, name: k.name, persen: fmtInput(k.persen) })), berat: fmtInput(r.bom.berat), waste: '0', bom_number: r.bom.number })
        setMsg(`Komposisi dari ${r.bom.number ?? 'BOM'} (sudah termasuk waste, jadi waste 0%).`)
      } else setMsg('Produk ini belum punya BOM di Accurate. Isi komposisi manual atau pakai komposisi standar.')
      onChange(patch)
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setLoadingBom(false)
    }
  }
  function applyPreset(label: string) {
    const preset = PRESETS.find((p) => p.label === label)
    if (!preset) return
    const comps = preset.parts.map(([name, persen]) => {
      const m = catalog.find((c) => c.name.trim().toLowerCase() === name.toLowerCase())
      const pick: MaterialPick = m ? m : { key: materialKey(null, name), item_accurate_id: null, name, unit: 'kg', harga: null, harga_sumber: 'Manual' }
      onMaterial(pick)
      return { key: pick.key, item_accurate_id: pick.item_accurate_id, name: pick.name, persen: String(persen) }
    })
    onChange({ komposisi: comps, bom_number: null, ...(d.waste === '0' ? { waste: '5', berat: '1' } : {}) })
  }

  return (
    <article className="pap-table-card pap-proj-product">
      <header className="pap-proj-product-head">
        <span className="pap-proj-num">{index + 1}</span>
        <ProductPicker draft={d} readOnly={readOnly} onPick={(p) => { onChange({ item_accurate_id: p.id, item_no: p.item_no, nama: p.name, satuan: p.unit ?? 'kg', harga_jual: p.price !== null ? fmtInput(p.price) : d.harga_jual }); fromBom(p.id) }}
          onText={(nama) => onChange({ nama, item_accurate_id: null, item_no: null })} />
        {onRemove && !readOnly && <button type="button" className="pap-icon-button" aria-label={`Hapus produk ${index + 1}`} onClick={onRemove}><Trash2 /></button>}
      </header>
      <div className="pap-proj-fields">
        <label className="pap-field"><span>Jumlah *</span><div className="pap-proj-unit"><input className="pap-input" inputMode="decimal" value={d.quantity} disabled={readOnly} onChange={(e) => onChange({ quantity: e.target.value.replace(/[^\d.,]/g, '') })} placeholder="0" /><input className="pap-input" value={d.satuan} disabled={readOnly} maxLength={40} aria-label="Satuan" onChange={(e) => onChange({ satuan: e.target.value })} /></div></label>
        <label className="pap-field"><span>Harga jual / {d.satuan || 'satuan'} (Rp)</span><input className="pap-input" inputMode="decimal" value={d.harga_jual} disabled={readOnly} onChange={(e) => onChange({ harga_jual: e.target.value.replace(/[^\d.,]/g, '') })} placeholder="opsional" /></label>
        <label className="pap-field"><span>Berat bahan / {d.satuan || 'satuan'} (kg)</span><input className="pap-input" inputMode="decimal" value={d.berat} disabled={readOnly} onChange={(e) => onChange({ berat: e.target.value.replace(/[^\d.,]/g, '') })} placeholder="1" /></label>
        <label className="pap-field"><span>Waste & BS (%)</span><input className="pap-input" inputMode="decimal" value={d.waste} disabled={readOnly} onChange={(e) => onChange({ waste: e.target.value.replace(/[^\d.,]/g, '') })} placeholder="5" /></label>
      </div>

      <div className="pap-proj-komp">
        <div className="pap-proj-komp-head">
          <b>Komposisi bahan</b>
          <span className={`pap-ma-margin ${Math.abs(total - 100) <= 0.01 ? 'success' : d.komposisi.length ? 'warning' : 'neutral'}`}>{pct(total)}</span>
          {d.bom_number && <small className="pap-muted">dari {d.bom_number}</small>}
          {!readOnly && (
            <div className="pap-proj-komp-tools">
              {d.item_accurate_id && <button type="button" className="pap-btn" disabled={loadingBom} onClick={() => fromBom()}>{loadingBom ? 'Mengambil...' : 'Ambil dari BOM'}</button>}
              <select className="pap-select" value="" onChange={(e) => applyPreset(e.target.value)} aria-label="Komposisi standar">
                <option value="">Komposisi standar…</option>
                {PRESETS.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
              </select>
            </div>
          )}
        </div>
        {msg && <small className="pap-muted pap-proj-msg">{msg}</small>}
        <div className="pap-proj-komp-rows">
          {d.komposisi.map((k, ki) => {
            const need = calc ? calc.bahan_kg * ((toNum(k.persen) ?? 0) / 100) : 0
            const harga = toNum(prices[k.key]?.harga ?? '')
            return (
              <div key={`${k.key}-${ki}`} className="pap-proj-komp-row">
                <MaterialPicker value={k} catalog={catalog} readOnly={readOnly} onPick={(m) => { onMaterial(m); onChange({ komposisi: d.komposisi.map((x, xi) => (xi === ki ? { ...x, key: m.key, item_accurate_id: m.item_accurate_id, name: m.name } : x)), bom_number: null }) }} />
                <div className="pap-proj-pct"><input className="pap-input" inputMode="decimal" value={k.persen} disabled={readOnly} aria-label={`Persen ${k.name}`} onChange={(e) => onChange({ komposisi: d.komposisi.map((x, xi) => (xi === ki ? { ...x, persen: e.target.value.replace(/[^\d.,]/g, '') } : x)) })} /><span>%</span></div>
                <span className="pap-proj-komp-need">{kg(need)}</span>
                <span className="pap-proj-komp-cost">{harga === null ? <span className="pap-muted">harga?</span> : formatRupiah(need * harga)}</span>
                {!readOnly && <button type="button" className="pap-icon-button" aria-label={`Hapus bahan ${k.name}`} onClick={() => onChange({ komposisi: d.komposisi.filter((_, xi) => xi !== ki), bom_number: null })}><X /></button>}
              </div>
            )
          })}
          {!d.komposisi.length && <p className="pap-muted pap-proj-empty">Belum ada bahan. {readOnly ? '' : 'Pilih produk Accurate (komposisi BOM terisi otomatis), pakai komposisi standar, atau tambah bahan satu per satu.'}</p>}
        </div>
        {!readOnly && <button type="button" className="pap-link-button pap-shift-edit" onClick={() => onChange({ komposisi: [...d.komposisi, { key: '', item_accurate_id: null, name: '', persen: d.komposisi.length ? String(Math.max(0, Math.round((100 - total) * 100) / 100)) : '100' }] })}><Plus /> Tambah bahan</button>}
      </div>

      {calc && (
        <footer className="pap-proj-product-foot">
          <span>Bahan <b>{kg(calc.bahan_kg)}</b></span>
          <span>HPP <b>{formatRupiah(calc.hpp)}</b> ({formatRupiah(calc.hpp_unit)}/{d.satuan || 'satuan'})</span>
          <span>Nilai <b>{formatRupiah(calc.nilai)}</b></span>
          <span>GPF <b className={calc.gpf !== null && calc.gpf < 0 ? 'pap-ma-neg' : ''}>{formatRupiah(calc.gpf)}</b> <span className={`pap-ma-margin ${marginTone(calc.margin)}`}>{pct(calc.margin)}</span></span>
        </footer>
      )}
    </article>
  )
}

// Pilih produk Accurate (cari) atau ketik nama produk baru
function ProductPicker({ draft: d, readOnly, onPick, onText }: { draft: Draft; readOnly: boolean; onPick: (p: Product) => void; onText: (nama: string) => void }) {
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<Product[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function search(q: string) {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      api<{ items: Product[] }>(`/api/production/rencana/produk?q=${encodeURIComponent(q)}`).then((r) => setResults(r.items)).catch(() => setResults([]))
    }, 250)
  }
  return (
    <div className="pap-proj-picker pap-proj-product-picker">
      <input className="pap-input" value={d.nama} disabled={readOnly} placeholder="Cari produk Accurate atau ketik nama produk baru..." aria-label="Nama produk"
        onFocus={() => { setOpen(true); search(d.nama) }} onBlur={() => setTimeout(() => setOpen(false), 180)}
        onChange={(e) => { onText(e.target.value); setOpen(true); search(e.target.value) }} />
      {d.item_accurate_id ? <small className="pap-proj-tag">Accurate{d.item_no ? ` · ${d.item_no}` : ''}</small> : d.nama ? <small className="pap-proj-tag manual">Produk baru / manual</small> : null}
      {open && !readOnly && !!results.length && (
        <div className="pap-proj-drop" role="listbox">
          {results.slice(0, 12).map((p) => (
            <button type="button" role="option" aria-selected={false} key={p.id} onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(p); setOpen(false) }}>
              <b>{p.name}</b><small>{[p.item_no, p.unit, p.price !== null ? formatRupiah(p.price) : null].filter(Boolean).join(' · ')}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Pilih bahan dari daftar bahan Accurate (biji plastik & bahan BOM) atau ketik bahan baru
function MaterialPicker({ value, catalog, readOnly, onPick }: { value: { key: string; name: string; item_accurate_id: number | null }; catalog: Material[]; readOnly: boolean; onPick: (m: MaterialPick) => void }) {
  const [text, setText] = useState(value.name)
  const [open, setOpen] = useState(false)
  const [remote, setRemote] = useState<Material[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => setText(value.name), [value.name])
  const q = text.trim().toLowerCase()
  const list = [...catalog, ...remote.filter((r) => !catalog.some((c) => c.key === r.key))].filter((m) => !q || m.name.toLowerCase().includes(q) || (m.item_no ?? '').toLowerCase().includes(q)).slice(0, 12)
  function search(v: string) {
    if (timer.current) clearTimeout(timer.current)
    if (!v.trim()) return
    timer.current = setTimeout(() => {
      api<{ items: Material[] }>(`/api/production/riset/bahan?q=${encodeURIComponent(v)}`).then((r) => setRemote(r.items)).catch(() => {})
    }, 250)
  }
  return (
    <div className="pap-proj-picker">
      <input className="pap-input" value={text} disabled={readOnly} placeholder="Pilih bahan (HD, HD KW, PE, Kalsium...)" aria-label="Bahan"
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 180)}
        onChange={(e) => { setText(e.target.value); setOpen(true); search(e.target.value) }} />
      {open && !readOnly && (
        <div className="pap-proj-drop" role="listbox">
          {list.map((m) => (
            <button type="button" role="option" aria-selected={m.key === value.key} key={m.key} onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(m); setText(m.name); setOpen(false) }}>
              <b>{m.name}</b><small>{[m.jenis, m.harga !== null ? `${formatRupiah(m.harga)}/${m.unit ?? 'kg'}` : 'tanpa harga', m.stok !== null ? `stok ${kg(m.stok, m.unit)}` : null].filter(Boolean).join(' · ')}</small>
            </button>
          ))}
          {text.trim() && !list.some((m) => m.name.toLowerCase() === q) && (
            <button type="button" role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick({ key: materialKey(null, text.trim()), item_accurate_id: null, name: text.trim(), unit: 'kg', harga: null, harga_sumber: 'Manual' }); setOpen(false) }}>
              <b>Pakai bahan baru “{text.trim()}”</b><small>Harga diisi manual di tabel Harga bahan</small>
            </button>
          )}
          {!list.length && !text.trim() && <p className="pap-muted">Memuat daftar bahan...</p>}
        </div>
      )}
    </div>
  )
}

