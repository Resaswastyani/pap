'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Boxes, Download, FlaskConical, Pencil, Scale, Search, TrendingUp } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { formatNumber, formatRupiah } from './accurate'
import { BarList, ColumnChart, type ColumnDatum } from './charts'
import { api, formatDate, Modal, Notice, Pager, usePaged } from './ui'

// Analisis Bahan Baku: kebutuhan bahan (HD, HD KW, PE, PP, Kalsium, bahan pendukung) dari BOM Accurate,
// nilai Rupiah, HPP bahan per produk, nilai jual, dan GPF (laba kotor) per periode.

type Sumber = 'realisasi' | 'rencana' | 'pesanan'
type Material = {
  id: string; item_accurate_id: number | null; item_no: string | null; name: string; unit: string | null; jenis: string; kelompok: 'baku' | 'pendukung'
  kebutuhan: number; harga: number | null; harga_sumber: 'acuan' | 'rata' | 'po' | null; nilai: number; produk: number; stok: number | null; kurang: number | null
  harga_rata: number | null; harga_po: number | null; harga_po_tanggal: string | null; acuan: number | null; acuan_catatan: string | null; acuan_at: string | null
}
type Product = {
  key: string; item_no: string | null; name: string; unit: string | null; jenis: string; quantity: number; kg: number; baris: number; bom_number: string | null; bom_qty: number; bom_unit: string | null
  komposisi: { name: string; jenis: string; per_unit: number; harga: number | null }[]
  hpp: number; hpp_per_unit: number | null; hpp_per_kg: number | null; nilai: number | null; harga_jual: number | null; nilai_lengkap: boolean; gpf: number | null; margin: number | null
  masalah: string[]; refs: string[]; customers: string[]
}
type Analysis = {
  options: { sumber: Sumber; from: string; to: string; harga: 'rata' | 'po'; ppn: boolean }
  totals: { baris: number; produk: number; bahan: number; produksi_kg: number; bahan_baku_kg: number; nilai_bahan_baku: number; nilai_bahan_pendukung: number; hpp: number; nilai: number; gpf: number; margin: number | null; hpp_per_kg: number | null; kurang: number }
  issues: { tanpa_bom: number; satuan_beda: number; tanpa_harga_bahan: number; tanpa_harga_jual: number }
  materials: Material[]; products: Product[]; jenis: { jenis: string; kebutuhan: number; nilai: number; kelompok: string }[]
  days: { tanggal: string; kg: number; hpp: number; nilai: number }[]
  can: { price: boolean }
}

const SUMBER: { key: Sumber; label: string; hint: string }[] = [
  { key: 'realisasi', label: 'Realisasi (MP)', hint: 'Produksi yang sudah berjalan dari Rencana Produksi (MP) Accurate' },
  { key: 'rencana', label: 'Rencana produksi', hint: 'Rencana per tanggal & shift di menu Rencana Produksi' },
  { key: 'pesanan', label: 'Pesanan terbuka', hint: 'Pesanan Accurate (barang diproduksi) menurut tanggal kirim' },
]
const MASALAH: Record<string, string> = { tanpa_bom: 'Belum ada BOM', satuan_beda: 'Satuan beda dgn BOM', tanpa_harga_bahan: 'Bahan tanpa harga' }
const HARGA_SUMBER: Record<string, string> = { acuan: 'Acuan', rata: 'Rata-rata', po: 'PO terakhir' }

const todayWib = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
const shift = (ymd: string, days: number) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10) }
const monthStart = (ymd: string, delta = 0) => { const d = new Date(`${ymd.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + delta); return d.toISOString().slice(0, 10) }
const monthEnd = (ymd: string) => shift(monthStart(ymd, 1), -1)
const kg = (v: number | null | undefined, unit: string | null = 'kg') => (v === null || v === undefined ? '—' : `${formatNumber(v, v >= 100 ? 0 : 2)}${unit ? ` ${unit}` : ''}`)
const short = (v: number) => {
  const a = Math.abs(v)
  const s = a >= 1e9 ? `${(v / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M` : a >= 1e6 ? `${(v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt` : Math.round(v).toLocaleString('id-ID')
  return `Rp ${s}`
}
const pct = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`)
const marginTone = (m: number | null) => (m === null ? 'neutral' : m < 0 ? 'danger' : m < 10 ? 'warning' : 'success')

function presets(today: string): { key: string; label: string; from: string; to: string; sumber?: Sumber }[] {
  return [
    { key: 'bulan-ini', label: 'Bulan ini', from: monthStart(today), to: monthEnd(today) },
    { key: 'bulan-lalu', label: 'Bulan lalu', from: monthStart(today, -1), to: shift(monthStart(today), -1) },
    { key: '7-depan', label: '7 hari ke depan', from: today, to: shift(today, 6) },
    { key: '30-depan', label: '30 hari ke depan', from: today, to: shift(today, 29) },
    { key: 'tahun-ini', label: 'Tahun ini', from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` },
  ]
}

export function MaterialAnalysisPage(_props: { user: UserProfile }) {
  const today = todayWib()
  const [sumber, setSumber] = useState<Sumber>('realisasi')
  const [from, setFrom] = useState(monthStart(today))
  const [to, setTo] = useState(monthEnd(today))
  const [harga, setHarga] = useState<'rata' | 'po'>('rata')
  const [ppn, setPpn] = useState(false)
  const [data, setData] = useState<Analysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'bahan' | 'produk' | 'harga'>('bahan')
  const [detail, setDetail] = useState<Product | null>(null)
  const [editPrice, setEditPrice] = useState<Material | null>(null)

  const query = useMemo(() => new URLSearchParams({ sumber, from, to, harga, ...(ppn ? { ppn: '1' } : {}) }).toString(), [sumber, from, to, harga, ppn])
  const load = useCallback(async () => {
    if (!from || !to) return
    setLoading(true)
    try {
      setData(await api<Analysis>(`/api/production/analisis-bahan?${query}`))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [query, from, to])
  useEffect(() => { load() }, [load])

  // Sumber "rencana" & "pesanan" umumnya ke depan, "realisasi" ke belakang: pindah sumber menyesuaikan periode bawaan
  function pickSumber(s: Sumber) {
    setSumber(s)
    if (s === 'realisasi' && from > today) { setFrom(monthStart(today)); setTo(monthEnd(today)) }
    if (s !== 'realisasi' && to < today) { setFrom(today); setTo(shift(today, 29)) }
  }
  const activePreset = presets(today).find((p) => p.from === from && p.to === to)?.key
  const t = data?.totals
  const issues = data?.issues
  const issueText = issues ? [
    issues.tanpa_bom ? `${issues.tanpa_bom} baris produk belum punya BOM` : '',
    issues.satuan_beda ? `${issues.satuan_beda} baris satuannya beda dengan BOM` : '',
    issues.tanpa_harga_bahan ? `${issues.tanpa_harga_bahan} pemakaian bahan tanpa harga` : '',
    issues.tanpa_harga_jual ? `${issues.tanpa_harga_jual} baris tanpa harga jual` : '',
  ].filter(Boolean) : []

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">PRODUKSI · ANALISIS</p>
          <h1>Analisis Bahan Baku</h1>
          <span>Kebutuhan bahan baku (HD, HD KW, PE, PP, Kalsium) dan bahan pendukung dari formula produksi (BOM) Accurate, lengkap dengan nilai Rupiah, HPP bahan, nilai jual, dan GPF (laba kotor).</span>
        </div>
        <a className="pap-primary-button pap-ma-export" href={`/api/production/analisis-bahan/export?${query}`} download><Download /> Unduh Excel</a>
      </div>

      <section className="pap-table-card pap-ma-controls" aria-label="Pengaturan analisis">
        <div className="pap-ma-control">
          <span className="pap-ma-label">Sumber data</span>
          <div className="pap-segmented pap-ma-seg" role="radiogroup" aria-label="Sumber data">
            {SUMBER.map((s) => <button key={s.key} type="button" role="radio" aria-checked={sumber === s.key} title={s.hint} className={sumber === s.key ? 'active' : ''} onClick={() => pickSumber(s.key)}>{s.label}</button>)}
          </div>
          <small className="pap-muted">{SUMBER.find((s) => s.key === sumber)?.hint}</small>
        </div>
        <div className="pap-ma-control">
          <span className="pap-ma-label">Periode</span>
          <div className="pap-chip-tabs pap-ma-presets">
            {presets(today).map((p) => <button key={p.key} type="button" className={activePreset === p.key ? 'active' : ''} onClick={() => { setFrom(p.from); setTo(p.to) }}>{p.label}</button>)}
          </div>
          <div className="pap-ma-dates">
            <input className="pap-input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="Dari tanggal" />
            <span className="pap-muted">s.d.</span>
            <input className="pap-input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="Sampai tanggal" />
          </div>
        </div>
        <div className="pap-ma-control">
          <span className="pap-ma-label">Harga bahan</span>
          <select className="pap-select" value={harga} onChange={(e) => setHarga(e.target.value as 'rata' | 'po')} aria-label="Dasar harga bahan">
            <option value="rata">Harga pokok rata-rata (Accurate)</option>
            <option value="po">Harga beli terakhir (PO Accurate)</option>
          </select>
          <label className="pap-ma-check"><input type="checkbox" checked={ppn} onChange={(e) => setPpn(e.target.checked)} /> Tambah PPN 11%</label>
          <small className="pap-muted">Harga acuan yang diisi di tab "Harga bahan" selalu diutamakan.</small>
        </div>
      </section>

      {error && <Notice onClose={() => setError('')}>{error}</Notice>}

      <div className="pap-stat-grid four">
        <Tile label="Total produksi" value={kg(t?.produksi_kg)} note={t ? `${t.produk} produk · ${t.baris} baris` : '—'} icon={Scale} tone="stat-1" />
        <Tile label="Kebutuhan bahan baku" value={kg(t?.bahan_baku_kg)} note={t ? `${short(t.nilai_bahan_baku)} · pendukung ${short(t.nilai_bahan_pendukung)}` : '—'} icon={Boxes} tone="stat-1" />
        <Tile label="HPP bahan" value={t ? short(t.hpp) : '—'} note={t?.hpp_per_kg ? `${formatRupiah(t.hpp_per_kg)} per kg` : 'Biaya bahan dari BOM'} icon={FlaskConical} tone="stat-2" />
        <Tile label="GPF (laba kotor)" value={t ? short(t.gpf) : '—'} note={t ? `Margin ${pct(t.margin)} · nilai jual ${short(t.nilai)}` : '—'} icon={TrendingUp} tone={t && t.gpf < 0 ? 'stat-2' : 'stat-0'} />
      </div>

      {!!issueText.length && (
        <div className="pap-ma-issues" role="status">
          <AlertTriangle />
          <div><b>Perlu dicek agar hitungan lengkap:</b> {issueText.join(' · ')}. Lengkapi BOM / harga di Accurate atau isi harga acuan di tab "Harga bahan".</div>
        </div>
      )}

      {data && (
        <div className="pap-ma-grid">
          <section className="pap-table-card pap-ma-card">
            <div className="pap-card-head"><div><h2>Komposisi biaya bahan</h2><p>Nilai bahan per jenis · total {short(t!.nilai_bahan_baku + t!.nilai_bahan_pendukung)}</p></div></div>
            <div className="pap-ma-card-body">
              {data.jenis.length ? (
                <BarList items={data.jenis.map((j, i) => ({
                  key: j.jenis, label: j.jenis, value: j.nilai, tone: (['s1', 's2', 's3', 's4', 's5'] as const)[i % 5],
                  display: `${short(j.nilai)}${j.kebutuhan ? ` · ${kg(j.kebutuhan)}` : ''}`,
                }))} />
              ) : <p className="pap-muted">Belum ada pemakaian bahan pada periode ini.</p>}
            </div>
          </section>
          <section className="pap-table-card pap-ma-card">
            <div className="pap-card-head"><div><h2>HPP bahan & GPF</h2><p>{data.days.length > 45 ? 'Per bulan' : 'Per hari'} · batang = nilai jual (HPP bahan + GPF)</p></div></div>
            <div className="pap-ma-card-body pap-viz-host">
              {data.days.length ? <ColumnChart data={trend(data.days)} format={(v) => short(v)} axisFormat={(v) => short(v).replace('Rp ', '')} ariaLabel="HPP bahan dan GPF" /> : <p className="pap-muted">Belum ada data pada periode ini.</p>}
              <div className="pap-viz-legend pap-ma-legend"><span><i className="swatch s1" />HPP bahan</span><span><i className="swatch s2" />GPF (laba kotor)</span></div>
            </div>
          </section>
        </div>
      )}

      <div className="pap-segmented pap-page-tabs" role="tablist" aria-label="Rincian analisis">
        <button role="tab" aria-selected={tab === 'bahan'} className={tab === 'bahan' ? 'active' : ''} onClick={() => setTab('bahan')}>Kebutuhan bahan{data ? ` (${data.materials.length})` : ''}</button>
        <button role="tab" aria-selected={tab === 'produk'} className={tab === 'produk' ? 'active' : ''} onClick={() => setTab('produk')}>HPP & GPF produk{data ? ` (${data.products.length})` : ''}</button>
        <button role="tab" aria-selected={tab === 'harga'} className={tab === 'harga' ? 'active' : ''} onClick={() => setTab('harga')}>Harga bahan</button>
      </div>
      {loading && !data && <div className="pap-table-card"><div className="pap-empty">Menghitung kebutuhan bahan...</div></div>}
      {data && tab === 'bahan' && <MaterialTable data={data} loading={loading} />}
      {data && tab === 'produk' && <ProductTable data={data} onOpen={setDetail} />}
      {data && tab === 'harga' && <PriceTable data={data} onEdit={setEditPrice} />}
      {detail && <ProductDetail product={detail} onClose={() => setDetail(null)} />}
      {editPrice && <PriceForm material={editPrice} onClose={() => setEditPrice(null)} onSaved={() => { setEditPrice(null); load() }} />}
    </>
  )
}

function Tile({ label, value, note, icon: Icon, tone }: { label: string; value: string; note: string; icon: typeof Scale; tone: string }) {
  return (
    <div className="pap-stat-card">
      <div><span>{label}</span><strong className="pap-stat-text">{value}</strong><small className="neutral">{note}</small></div>
      <div className={`pap-stat-icon ${tone}`}><Icon /></div>
    </div>
  )
}

// Grafik: per hari, atau per bulan bila periodenya panjang
function trend(days: Analysis['days']): ColumnDatum[] {
  const byMonth = days.length > 45
  const m = new Map<string, { hpp: number; nilai: number }>()
  for (const d of days) {
    const k = byMonth ? d.tanggal.slice(0, 7) : d.tanggal
    const x = m.get(k) ?? { hpp: 0, nilai: 0 }
    x.hpp += d.hpp
    x.nilai += d.nilai
    m.set(k, x)
  }
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
  return [...m.entries()].map(([k, x]) => {
    const gpf = Math.max(0, x.nilai - x.hpp)
    const label = byMonth ? `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}` : k === 'tanpa tanggal' ? '—' : `${Number(k.slice(8, 10))}/${Number(k.slice(5, 7))}`
    return {
      key: k, label, value: x.hpp + gpf,
      detail: <><b>{byMonth ? label : formatDate(k)}</b><br />HPP bahan {formatRupiah(x.hpp)}<br />Nilai jual {formatRupiah(x.nilai)}<br />GPF {formatRupiah(x.nilai - x.hpp)}</>,
      segments: [{ key: 'hpp', value: x.hpp, tone: 's1' }, { key: 'gpf', value: gpf, tone: 's2' }],
    }
  })
}

function MaterialTable({ data, loading }: { data: Analysis; loading: boolean }) {
  const [kelompok, setKelompok] = useState<'' | 'baku' | 'pendukung'>('')
  const [q, setQ] = useState('')
  const total = data.materials.reduce((a, m) => a + m.nilai, 0)
  const items = data.materials.filter((m) => (!kelompok || m.kelompok === kelompok) && (!q.trim() || `${m.name} ${m.item_no ?? ''} ${m.jenis}`.toLowerCase().includes(q.trim().toLowerCase())))
  const paged = usePaged(items, [kelompok, q, data])
  return (
    <section className="pap-table-card">
      <div className="pap-card-head"><div><h2>Kebutuhan bahan</h2><p>Jumlah bahan = kuantitas produksi ÷ kuantitas BOM × pemakaian bahan di BOM. Stok dari Accurate saat ini.</p></div></div>
      <div className="pap-filters">
        <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari bahan, kode, jenis..." /></label>
        <select className="pap-select" value={kelompok} onChange={(e) => setKelompok(e.target.value as '' | 'baku' | 'pendukung')} aria-label="Kelompok bahan">
          <option value="">Semua bahan</option><option value="baku">Bahan baku (biji plastik & kalsium)</option><option value="pendukung">Bahan pendukung</option>
        </select>
      </div>
      <div className="pap-table-wrap">
        <table className={`pap-ma-table ${loading ? 'pap-ma-loading' : ''}`}>
          <thead><tr><th>Bahan</th><th className="pap-num">Kebutuhan</th><th className="pap-num">Harga/satuan</th><th className="pap-num">Nilai</th><th>Porsi nilai</th><th className="pap-num">Stok</th><th className="pap-num">Kurang</th></tr></thead>
          <tbody>
            {paged.items.map((m) => {
              const share = total ? (m.nilai / total) * 100 : 0
              return (
                <tr key={m.id}>
                  <td><div className="pap-cell-title">{m.name}</div><div className="pap-cell-sub"><span className={`pap-ma-jenis ${m.kelompok}`}>{m.jenis}</span>{m.item_no ? ` ${m.item_no}` : ''} · {m.produk} produk</div></td>
                  <td className="pap-num pap-nowrap"><strong>{kg(m.kebutuhan, m.unit)}</strong></td>
                  <td className="pap-num pap-nowrap">{formatRupiah(m.harga)}{m.harga_sumber && <div className="pap-cell-sub">{HARGA_SUMBER[m.harga_sumber]}</div>}</td>
                  <td className="pap-num pap-nowrap"><strong>{formatRupiah(m.nilai)}</strong></td>
                  <td><div className="pap-ma-share"><span style={{ width: `${Math.max(share > 0 ? 2 : 0, share)}%` }} /></div><small className="pap-muted">{pct(share)}</small></td>
                  <td className="pap-num pap-nowrap">{kg(m.stok, m.unit)}</td>
                  <td className="pap-num pap-nowrap">{m.kurang ? <span className="pap-ma-short">{kg(m.kurang, m.unit)}</span> : <span className="pap-ma-ok">Cukup</span>}</td>
                </tr>
              )
            })}
          </tbody>
          {!!items.length && (
            <tfoot><tr><td><b>Total {kelompok === 'baku' ? 'bahan baku' : kelompok === 'pendukung' ? 'bahan pendukung' : 'semua bahan'}</b></td><td className="pap-num"><b>{kg(items.filter((m) => !m.unit || /^kg$/i.test(m.unit)).reduce((a, m) => a + m.kebutuhan, 0))}</b></td><td /><td className="pap-num"><b>{formatRupiah(items.reduce((a, m) => a + m.nilai, 0))}</b></td><td colSpan={3} /></tr></tfoot>
          )}
        </table>
        {!items.length && <div className="pap-empty">{data.materials.length ? 'Tidak ada bahan yang cocok.' : 'Belum ada pemakaian bahan pada periode & sumber ini.'}</div>}
        <Pager {...paged.pager} noun="bahan" />
      </div>
    </section>
  )
}

const SORTS = { nilai: 'Nilai jual terbesar', hpp: 'HPP bahan terbesar', gpf: 'GPF terbesar', margin_rendah: 'Margin terendah', masalah: 'Perlu dicek dulu' } as const

function ProductTable({ data, onOpen }: { data: Analysis; onOpen: (p: Product) => void }) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<keyof typeof SORTS>('nilai')
  const items = data.products
    .filter((p) => !q.trim() || `${p.name} ${p.item_no ?? ''} ${p.bom_number ?? ''} ${p.customers.join(' ')} ${p.refs.join(' ')}`.toLowerCase().includes(q.trim().toLowerCase()))
    .slice()
    .sort((a, b) => sort === 'hpp' ? b.hpp - a.hpp : sort === 'gpf' ? (b.gpf ?? -Infinity) - (a.gpf ?? -Infinity)
      : sort === 'margin_rendah' ? (a.margin ?? Infinity) - (b.margin ?? Infinity) : sort === 'masalah' ? b.masalah.length - a.masalah.length || (b.nilai ?? 0) - (a.nilai ?? 0) : (b.nilai ?? b.hpp) - (a.nilai ?? a.hpp))
  const paged = usePaged(items, [q, sort, data])
  return (
    <section className="pap-table-card">
      <div className="pap-card-head"><div><h2>HPP bahan & GPF per produk</h2><p>HPP bahan = biaya bahan dari BOM. GPF = nilai jual − HPP bahan (belum termasuk tenaga kerja & overhead). Klik produk untuk komposisi bahannya.</p></div></div>
      <div className="pap-filters">
        <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari produk, kode, BOM, customer, nomor..." /></label>
        <select className="pap-select" value={sort} onChange={(e) => setSort(e.target.value as keyof typeof SORTS)} aria-label="Urutkan">
          {Object.entries(SORTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      <div className="pap-table-wrap">
        <table className="pap-ma-table">
          <thead><tr><th>Produk</th><th className="pap-num">Kuantitas</th><th className="pap-num">HPP/satuan</th><th className="pap-num">HPP bahan</th><th className="pap-num">Harga jual</th><th className="pap-num">Nilai jual</th><th className="pap-num">GPF</th><th className="pap-num">Margin</th></tr></thead>
          <tbody>
            {paged.items.map((p) => (
              <tr key={p.key} className="pap-clickable" onClick={() => onOpen(p)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(p)}>
                <td>
                  <div className="pap-cell-title pap-plan-item">{p.name}</div>
                  <div className="pap-cell-sub">{[p.item_no, p.bom_number].filter(Boolean).join(' · ') || '—'}</div>
                  {!!p.masalah.length && <div className="pap-ma-flags">{p.masalah.map((m) => <span key={m}>{MASALAH[m] ?? m}</span>)}</div>}
                </td>
                <td className="pap-num pap-nowrap">{kg(p.quantity, p.unit)}{p.unit && !/^kg$/i.test(p.unit) && p.kg > 0 && <div className="pap-cell-sub">≈ {kg(p.kg)}</div>}</td>
                <td className="pap-num pap-nowrap">{formatRupiah(p.hpp_per_unit)}{p.hpp_per_kg !== null && p.unit && !/^kg$/i.test(p.unit) && <div className="pap-cell-sub">{formatRupiah(p.hpp_per_kg)}/kg</div>}</td>
                <td className="pap-num pap-nowrap"><strong>{formatRupiah(p.hpp)}</strong></td>
                <td className="pap-num pap-nowrap">{formatRupiah(p.harga_jual)}</td>
                <td className="pap-num pap-nowrap">{formatRupiah(p.nilai)}{!p.nilai_lengkap && p.nilai !== null && <div className="pap-cell-sub">sebagian</div>}</td>
                <td className={`pap-num pap-nowrap ${p.gpf !== null && p.gpf < 0 ? 'pap-ma-neg' : ''}`}><strong>{formatRupiah(p.gpf)}</strong></td>
                <td className="pap-num"><span className={`pap-ma-margin ${marginTone(p.margin)}`}>{pct(p.margin)}</span></td>
              </tr>
            ))}
          </tbody>
          {!!items.length && (
            <tfoot><tr><td><b>Total</b></td><td className="pap-num"><b>{kg(items.reduce((a, p) => a + p.kg, 0))}</b></td><td /><td className="pap-num"><b>{formatRupiah(items.reduce((a, p) => a + p.hpp, 0))}</b></td><td /><td className="pap-num"><b>{formatRupiah(items.reduce((a, p) => a + (p.nilai ?? 0), 0))}</b></td><td className="pap-num"><b>{formatRupiah(items.reduce((a, p) => a + (p.gpf ?? 0), 0))}</b></td><td /></tr></tfoot>
          )}
        </table>
        {!items.length && <div className="pap-empty">{data.products.length ? 'Tidak ada produk yang cocok.' : 'Belum ada produksi pada periode & sumber ini.'}</div>}
        <Pager {...paged.pager} noun="produk" />
      </div>
    </section>
  )
}

function ProductDetail({ product: p, onClose }: { product: Product; onClose: () => void }) {
  const totalPer = p.komposisi.reduce((a, k) => a + k.per_unit, 0)
  const costPer = p.komposisi.reduce((a, k) => a + k.per_unit * (k.harga ?? 0), 0)
  return (
    <Modal title={p.name} subtitle={[p.item_no, p.bom_number ? `BOM ${p.bom_number}` : 'Belum ada BOM'].filter(Boolean).join(' · ')} wide onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Tutup</button></>}>
      <div className="pap-ma-detail">
        <div className="pap-ma-detail-stats">
          <div><span>Kuantitas</span><b>{kg(p.quantity, p.unit)}</b>{p.unit && !/^kg$/i.test(p.unit) && <small>≈ {kg(p.kg)}</small>}</div>
          <div><span>HPP bahan</span><b>{formatRupiah(p.hpp)}</b><small>{formatRupiah(p.hpp_per_unit)}/{p.unit ?? 'satuan'}</small></div>
          <div><span>Nilai jual</span><b>{formatRupiah(p.nilai)}</b><small>{formatRupiah(p.harga_jual)}/{p.unit ?? 'satuan'}</small></div>
          <div><span>GPF</span><b className={p.gpf !== null && p.gpf < 0 ? 'pap-ma-neg' : ''}>{formatRupiah(p.gpf)}</b><small>Margin {pct(p.margin)}</small></div>
        </div>
        {!!p.masalah.length && <Notice>{p.masalah.map((m) => MASALAH[m] ?? m).join(' · ')}{p.masalah.includes('satuan_beda') ? ` — satuan produksi ${p.unit ?? '?'} sedangkan BOM per ${p.bom_qty} ${p.bom_unit ?? '?'}.` : '.'}</Notice>}
        <h3 className="pap-ma-h3">Komposisi bahan per {p.bom_unit ?? p.unit ?? 'satuan'} produk</h3>
        {p.komposisi.length ? (
          <div className="pap-table-wrap pap-ma-inner">
            <table className="pap-ma-table">
              <thead><tr><th>Bahan</th><th className="pap-num">Pemakaian</th><th className="pap-num">Komposisi</th><th className="pap-num">Harga</th><th className="pap-num">Biaya</th></tr></thead>
              <tbody>
                {p.komposisi.map((k) => (
                  <tr key={k.name}>
                    <td><div className="pap-cell-title">{k.name}</div><div className="pap-cell-sub">{k.jenis}</div></td>
                    <td className="pap-num pap-nowrap">{formatNumber(k.per_unit, 4)}</td>
                    <td className="pap-num">{pct(totalPer ? (k.per_unit / totalPer) * 100 : null)}</td>
                    <td className="pap-num pap-nowrap">{formatRupiah(k.harga)}</td>
                    <td className="pap-num pap-nowrap">{k.harga === null ? '—' : formatRupiah(k.per_unit * k.harga)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td><b>Total per {p.bom_unit ?? p.unit ?? 'satuan'}</b></td><td className="pap-num"><b>{formatNumber(totalPer, 4)}</b></td><td className="pap-num"><b>100%</b></td><td /><td className="pap-num"><b>{formatRupiah(costPer)}</b></td></tr></tfoot>
            </table>
          </div>
        ) : <p className="pap-muted">Produk ini belum punya formula produksi (BOM) di Accurate, jadi kebutuhan bahannya belum bisa dihitung.</p>}
        {(!!p.customers.length || !!p.refs.length) && <p className="pap-muted pap-ma-refs">{p.customers.length ? `Customer: ${p.customers.join(', ')}. ` : ''}{p.refs.length ? `Dokumen: ${p.refs.join(', ')}${p.baris > p.refs.length ? ', …' : ''}` : ''}</p>}
      </div>
    </Modal>
  )
}

function PriceTable({ data, onEdit }: { data: Analysis; onEdit: (m: Material) => void }) {
  const items = data.materials.filter((m) => m.item_accurate_id)
  const paged = usePaged(items, [data])
  return (
    <section className="pap-table-card">
      <div className="pap-card-head"><div><h2>Harga bahan</h2><p>Bandingkan harga pokok rata-rata dan harga beli terakhir dari Accurate. Isi harga acuan (mis. harga supplier terbaru termasuk PPN) bila ingin dipakai di analisis; data Accurate tidak berubah.</p></div></div>
      <div className="pap-table-wrap">
        <table className="pap-ma-table">
          <thead><tr><th>Bahan</th><th className="pap-num">Rata-rata Accurate</th><th className="pap-num">Beli terakhir (PO)</th><th className="pap-num">Harga acuan</th><th className="pap-num">Dipakai</th>{data.can.price && <th aria-label="Aksi" />}</tr></thead>
          <tbody>
            {paged.items.map((m) => (
              <tr key={m.id}>
                <td><div className="pap-cell-title">{m.name}</div><div className="pap-cell-sub"><span className={`pap-ma-jenis ${m.kelompok}`}>{m.jenis}</span>{m.item_no ? ` ${m.item_no}` : ''} · per {m.unit ?? 'satuan'}</div></td>
                <td className="pap-num pap-nowrap">{formatRupiah(m.harga_rata)}</td>
                <td className="pap-num pap-nowrap">{formatRupiah(m.harga_po)}{m.harga_po_tanggal && <div className="pap-cell-sub">{formatDate(m.harga_po_tanggal)}</div>}</td>
                <td className="pap-num pap-nowrap">{m.acuan !== null ? <><strong>{formatRupiah(m.acuan)}</strong>{m.acuan_catatan && <div className="pap-cell-sub">{m.acuan_catatan}</div>}</> : <span className="pap-muted">—</span>}</td>
                <td className="pap-num pap-nowrap"><strong>{formatRupiah(m.harga)}</strong>{m.harga_sumber && <div className="pap-cell-sub">{HARGA_SUMBER[m.harga_sumber]}{m.harga_sumber !== 'acuan' && data.options.ppn ? ' + PPN' : ''}</div>}</td>
                {data.can.price && <td><button type="button" className="pap-link-button pap-shift-edit" onClick={() => onEdit(m)}><Pencil /> {m.acuan !== null ? 'Ubah' : 'Isi acuan'}</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <div className="pap-empty">Belum ada bahan pada periode & sumber ini.</div>}
        <Pager {...paged.pager} noun="bahan" />
      </div>
    </section>
  )
}

function PriceForm({ material: m, onClose, onSaved }: { material: Material; onClose: () => void; onSaved: () => void }) {
  const [harga, setHarga] = useState(m.acuan !== null ? String(m.acuan) : '')
  const [catatan, setCatatan] = useState(m.acuan_catatan ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(value: string | null) {
    setBusy(true)
    setError('')
    try {
      await api('/api/production/analisis-bahan', { method: 'PUT', json: { item_accurate_id: m.item_accurate_id, harga: value === null ? null : Number(value.replace(',', '.')), catatan } })
      onSaved()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }
  return (
    <Modal title="Harga acuan bahan" subtitle={`${m.name}${m.item_no ? ` · ${m.item_no}` : ''}`} onClose={onClose}
      footer={<>
        {m.acuan !== null && <button type="button" className="pap-btn danger" disabled={busy} onClick={() => save(null)}>Hapus acuan</button>}
        <span className="pap-spacer" />
        <button type="button" className="pap-btn" onClick={onClose}>Batal</button>
        <button className="pap-primary-button" form="pap-ma-price" disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan'}</button>
      </>}>
      <form id="pap-ma-price" className="pap-shift-form" onSubmit={(e) => { e.preventDefault(); save(harga) }}>
        {error && <Notice onClose={() => setError('')}>{error}</Notice>}
        <div className="pap-shift-info">
          <span>Rata-rata Accurate <b>{formatRupiah(m.harga_rata)}</b></span>
          <span>Beli terakhir <b>{formatRupiah(m.harga_po)}</b>{m.harga_po_tanggal ? ` (${formatDate(m.harga_po_tanggal)})` : ''}</span>
          <span>+ PPN 11% dari rata-rata <b>{m.harga_rata !== null ? formatRupiah(m.harga_rata * 1.11) : '—'}</b></span>
        </div>
        <label className="pap-field"><span>Harga acuan per {m.unit ?? 'satuan'} (Rp) *</span><input className="pap-input" inputMode="decimal" required autoFocus value={harga} onChange={(e) => setHarga(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="mis. 33966" /></label>
        <label className="pap-field"><span>Catatan</span><input className="pap-input" maxLength={255} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="mis. per 13/11/26, Panca Budi, incl PPN" /></label>
        <small className="pap-muted">Harga acuan dipakai di semua analisis menggantikan harga Accurate (tanpa tambahan PPN lagi). Hapus acuan untuk kembali ke harga Accurate.</small>
      </form>
    </Modal>
  )
}
