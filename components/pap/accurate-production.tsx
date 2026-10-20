'use client'

import { useCallback, useEffect, useState } from 'react'
import { CalendarRange, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Factory, Layers, PackageCheck, Scale, Search, X } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { AccurateSyncBar, formatNumber } from './accurate'
import { BarList, ColumnChart } from './charts'
import { api, formatDate, Notice, Progress } from './ui'

// Rencana Produksi (MP) dan Penyelesaian Barang Jadi (FGS) langsung dari Accurate Online (hanya baca)

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const monthLabel = (ym: string) => (ym ? `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` : '')
const shiftMonth = (ym: string, delta: number) => {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + delta, 1))
  return d.toISOString().slice(0, 7)
}
const qty = (v: number | null | undefined, unit?: string | null) => (v === null || v === undefined ? '—' : `${formatNumber(v)}${unit ? ` ${unit}` : ''}`)
const range = (a: string | null, b: string | null) => (!a && !b ? '—' : a === b || !b ? formatDate(a) : `${formatDate(a)} – ${formatDate(b)}`)

function MonthNav({ periode, onChange }: { periode: string; onChange: (p: string) => void }) {
  return (
    <div className="pap-month-nav">
      <button className="pap-icon-button" onClick={() => onChange(shiftMonth(periode, -1))} aria-label="Bulan sebelumnya"><ChevronLeft /></button>
      <button className="pap-icon-button" onClick={() => onChange(shiftMonth(periode, 1))} aria-label="Bulan berikutnya"><ChevronRight /></button>
      <strong>{monthLabel(periode)}</strong>
    </div>
  )
}

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

// ---------- Rencana Produksi ----------
type PlanLine = {
  line_id: number; seq: number | null; item_no: string | null; item_name: string | null; bom_number: string | null; quantity: number | null; unit: string | null
  start_date: string | null; end_date: string | null; status: string | null; status_name: string | null; progress: number | null
  wo_quantity: number | null; fgs_quantity: number | null; material_percent: number | null; notes: string | null
}
type Plan = {
  id: number; number: string | null; name: string | null; trans_date: string | null; start_date: string | null; end_date: string | null
  status: string | null; status_name: string | null; progress: number | null; description: string | null; detail_synced: boolean; lines: PlanLine[]
}
type PlanStats = { rencana: number; formula: number; formula_berjalan: number; belum_lengkap: number; per_satuan: { satuan: string; kuantitas: number; kuantitas_jadi: number }[] }

const lineTone = (s: string | null) => (s === 'FINISHED' ? 'success' : s === 'ONPROCESS' || s === 'PROCESSED' ? 'info' : 'warning')

export function ProductionPlanPage(_props: { user: UserProfile }) {
  const [periode, setPeriode] = useState('')
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const query = useDebounced(q)
  const [items, setItems] = useState<Plan[]>([])
  const [stats, setStats] = useState<PlanStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (periode) params.set('periode', periode)
      if (status) params.set('status', status)
      if (query) params.set('q', query)
      const res = await api<{ periode: string; items: Plan[]; stats: PlanStats }>(`/api/production/plans?${params}`)
      setPeriode(res.periode)
      setItems(res.items)
      setStats(res.stats)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [periode, status, query])
  useEffect(() => { load() }, [load])

  // Satuan utama (terbanyak) di angka besar; satuan lain disebut di catatan
  const [main, ...others] = stats?.per_satuan ?? []
  const otherText = (key: 'kuantitas' | 'kuantitas_jadi') => others.map((u) => `+ ${qty(u[key], u.satuan)}`).join(' · ')
  const tiles: [string, string, string, typeof Factory, string, string][] = [
    ['', 'Rencana produksi', `${stats?.rencana ?? 0}`, ClipboardList, 'stat-1', `${stats?.formula ?? 0} formula produksi`],
    ['berjalan', 'Formula berjalan', `${stats?.formula_berjalan ?? 0}`, Factory, stats?.formula_berjalan ? 'stat-2' : 'stat-0', 'Belum selesai diproduksi'],
    ['', 'Kuantitas rencana', qty(main?.kuantitas ?? 0, main?.satuan ?? 'kg'), Scale, 'stat-1', otherText('kuantitas') || monthLabel(periode)],
    ['selesai', 'Kuantitas jadi', qty(main?.kuantitas_jadi ?? 0, main?.satuan ?? 'kg'), PackageCheck, 'stat-0',
      main?.kuantitas ? `${Math.round((main.kuantitas_jadi / main.kuantitas) * 100)}% dari rencana${others.length ? ` · ${otherText('kuantitas_jadi')}` : ''}` : 'Penyelesaian barang jadi'],
  ]

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">PRODUKSI · ACCURATE</p>
          <h1>Rencana Produksi</h1>
          <span>Rencana produksi dan formula produksi (BOM) dari Accurate Online, lengkap dengan status, progres, jadwal, dan kuantitas produk jadi.</span>
        </div>
      </div>
      <AccurateSyncBar entities={['manufacture-order', 'manufacture-order-detail']} canSync onSynced={load} />
      <div className="pap-stat-grid four">
        {tiles.map(([key, label, value, Icon, tone, note]) => (
          <button key={label} className={`pap-stat-card pap-stat-button ${key && status === key ? 'active' : ''}`} onClick={() => key && setStatus(status === key ? '' : key)} disabled={!key}>
            <div><span>{label}</span><strong className="pap-stat-text">{value}</strong><small className="neutral">{note}</small></div>
            <div className={`pap-stat-icon ${tone}`}><Icon /></div>
          </button>
        ))}
      </div>
      <div className="pap-table-card">
        <div className="pap-card-head">
          <div><h2>Daftar rencana produksi</h2><p>Per dokumen MP · baris = formula produksi. Data hanya-baca; ubah di Accurate.</p></div>
          {periode && <MonthNav periode={periode} onChange={setPeriode} />}
        </div>
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nomor MP, nama, produk, BOM..." /></label>
          <select className="pap-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter status">
            <option value="">Semua status</option>
            <option value="berjalan">Masih berjalan</option>
            <option value="selesai">Selesai</option>
          </select>
        </div>
        {!!stats?.belum_lengkap && <div className="pap-card-notice"><Notice kind="success">{stats.belum_lengkap} rencana bulan ini belum lengkap baris formulanya; akan terisi pada sinkron berikutnya.</Notice></div>}
        {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <div className="pap-table-wrap">
          <table className="pap-plan-table">
            <thead><tr><th>Produk utama</th><th>Formula produksi</th><th className="pap-num">Kuantitas</th><th>Status</th><th>Progres</th><th>Jadwal produksi</th><th className="pap-num">Kts produk jadi</th></tr></thead>
            <tbody>
              {items.flatMap((p) => [
                <tr key={`mo${p.id}`} className="pap-group-row pap-plan-head">
                  <td colSpan={7}>
                    <div className="pap-plan-title">
                      <span><b>{p.number}</b>{p.name ? ` · ${p.name}` : ''}</span>
                      <span className="pap-cell-sub">{formatDate(p.trans_date)} · {p.lines.length} formula{p.status_name ? ` · ${p.status_name}` : ''}</span>
                    </div>
                  </td>
                </tr>,
                ...(p.lines.length ? p.lines.map((l) => (
                  <tr key={`l${p.id}-${l.line_id}`}>
                    <td><div className="pap-cell-title pap-plan-item">{l.item_name ?? '—'}</div><div className="pap-cell-sub">{l.item_no ?? ''}</div></td>
                    <td className="pap-nowrap">{l.bom_number ?? '—'}</td>
                    <td className="pap-num pap-nowrap">{qty(l.quantity, l.unit)}</td>
                    <td><span className={`pap-status ${lineTone(l.status)}`}>{l.status_name ?? l.status ?? '—'}</span></td>
                    <td><Progress value={Math.round(l.progress ?? 0)} /></td>
                    <td className="pap-nowrap">{range(l.start_date, l.end_date)}</td>
                    <td className="pap-num pap-nowrap"><strong>{qty(l.fgs_quantity, l.unit)}</strong></td>
                  </tr>
                )) : [
                  <tr key={`e${p.id}`}><td colSpan={7} className="pap-muted">{p.detail_synced ? 'Tidak ada formula produksi.' : 'Baris formula belum diambil dari Accurate.'}</td></tr>,
                ]),
              ])}
            </tbody>
          </table>
          {!loading && !items.length && <div className="pap-empty">{q || status ? 'Tidak ada rencana produksi yang cocok.' : `Belum ada rencana produksi di ${monthLabel(periode)}. Klik "Sinkron sekarang" untuk mengambil dari Accurate.`}</div>}
          {loading && !items.length && <div className="pap-empty">Memuat rencana produksi...</div>}
        </div>
      </div>
    </>
  )
}

// ---------- Hasil Produksi (Penyelesaian Barang Jadi) ----------
type Finished = {
  id: number; number: string | null; trans_date: string | null; wo_number: string | null; mo_number: string | null; mo_name: string | null; description: string | null
  line_id: number | null; item_no: string | null; item_name: string | null; quantity: number | null; unit: string | null; warehouse: string | null; detail_synced: boolean
}
type FinishedRes = {
  periode: string; tanggal: string; today: string; satuan: string; items: Finished[]
  perDay: { tanggal: string; dokumen: number; kuantitas: number }[]; top: { item_name: string; kuantitas: number }[]
  stats: { dokumen: number; kuantitas: number; hari_ini_dokumen: number; hari_ini_kuantitas: number; belum_lengkap: number }
}

export function FinishedGoodsPage(_props: { user: UserProfile }) {
  const [periode, setPeriode] = useState('')
  const [tanggal, setTanggal] = useState('')
  const [q, setQ] = useState('')
  const query = useDebounced(q)
  const [data, setData] = useState<FinishedRes | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (tanggal) params.set('tanggal', tanggal)
      else if (periode) params.set('periode', periode)
      if (query) params.set('q', query)
      const res = await api<FinishedRes>(`/api/production/finished?${params}`)
      setPeriode(res.periode)
      setData(res)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [periode, tanggal, query])
  useEffect(() => { load() }, [load])

  const satuan = data?.satuan ?? 'kg'
  const s = data?.stats
  // Semua tanggal dalam bulan (hari tanpa penyelesaian bernilai 0), sampai hari ini untuk bulan berjalan
  const chart = (() => {
    if (!data) return []
    const [y, m] = data.periode.split('-').map(Number)
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const byDay = new Map(data.perDay.map((d) => [d.tanggal, d]))
    const upto = data.today.startsWith(data.periode) ? Number(data.today.slice(8, 10)) : last
    return Array.from({ length: upto }, (_, i) => {
      const key = `${data.periode}-${String(i + 1).padStart(2, '0')}`
      const d = byDay.get(key)
      return { key, label: String(i + 1), value: d?.kuantitas ?? 0, partial: key === data.today, detail: <span>{d?.dokumen ?? 0} penyelesaian</span> }
    })
  })()
  const tiles: [string, string, typeof Factory, string, string][] = [
    ['Hari ini', qty(s?.hari_ini_kuantitas ?? 0, satuan), PackageCheck, 'stat-0', `${s?.hari_ini_dokumen ?? 0} penyelesaian barang jadi`],
    [`Bulan ${monthLabel(periode).split(' ')[0] ?? ''}`, qty(s?.kuantitas ?? 0, satuan), Scale, 'stat-1', `${s?.dokumen ?? 0} penyelesaian`],
    ['Rata-rata per hari', qty(chart.length ? Math.round(((s?.kuantitas ?? 0) / Math.max(1, chart.filter((c) => c.value > 0).length)) * 10) / 10 : 0, satuan), CalendarRange, 'stat-1', 'Hari dengan produksi'],
    ['Produk terbanyak', data?.top[0] ? qty(data.top[0].kuantitas, satuan) : '—', Layers, 'stat-1', data?.top[0]?.item_name ?? 'Belum ada data'],
  ]

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">PRODUKSI · ACCURATE</p>
          <h1>Hasil Produksi</h1>
          <span>Penyelesaian barang jadi dari Accurate Online: barang, kuantitas, perintah kerja, dan rencana produksi asalnya.</span>
        </div>
      </div>
      <AccurateSyncBar entities={['finished-good-slip', 'finished-good-slip-detail']} canSync onSynced={load} />
      <div className="pap-stat-grid four">
        {tiles.map(([label, value, Icon, tone, note]) => (
          <div key={label} className="pap-stat-card">
            <div><span>{label}</span><strong className="pap-stat-text">{value}</strong><small className="neutral">{note}</small></div>
            <div className={`pap-stat-icon ${tone}`}><Icon /></div>
          </div>
        ))}
      </div>
      <div className="pap-dash-grid pap-fgs-grid">
        <section className="pap-table-card pap-dash-card">
          <div className="pap-card-head">
            <div><h2>Barang jadi per hari</h2><p>Kuantitas ({satuan}) penyelesaian barang jadi · {monthLabel(periode)}</p></div>
            {periode && <MonthNav periode={periode} onChange={(p) => { setTanggal(''); setPeriode(p) }} />}
          </div>
          {chart.length ? <ColumnChart ariaLabel={`Kuantitas barang jadi per hari ${monthLabel(periode)}`} format={(v) => `${formatNumber(v, 1)}`} data={chart} /> : <div className="pap-empty">Belum ada data.</div>}
        </section>
        <section className="pap-table-card pap-dash-card">
          <div className="pap-card-head"><div><h2>Produk terbanyak</h2><p>{monthLabel(periode)} · {satuan}</p></div></div>
          <div className="pap-dash-body">
            {data?.top.length ? <BarList items={data.top.map((t) => ({ key: t.item_name, label: t.item_name, value: t.kuantitas, display: qty(t.kuantitas, satuan) }))} /> : <p className="pap-muted">Belum ada penyelesaian bulan ini.</p>}
          </div>
        </section>
      </div>
      <div className="pap-table-card">
        <div className="pap-card-head">
          <div><h2>Penyelesaian barang jadi</h2><p>{tanggal ? formatDate(tanggal) : monthLabel(periode)} · data hanya-baca dari Accurate</p></div>
        </div>
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nomor FGS, WO, MP, barang..." /></label>
          <input className="pap-input pap-date-input" type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} aria-label="Filter tanggal" />
          {tanggal && <button className="pap-btn" onClick={() => setTanggal('')}><X /> Semua tanggal</button>}
        </div>
        {!!s?.belum_lengkap && <div className="pap-card-notice"><Notice kind="success">{s.belum_lengkap} penyelesaian bulan ini belum lengkap barangnya; akan terisi pada sinkron berikutnya.</Notice></div>}
        {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <div className="pap-table-wrap">
          <table className="pap-plan-table">
            <thead><tr><th>Barang jadi</th><th>No. penyelesaian</th><th>Tanggal</th><th className="pap-num">Kuantitas</th><th>Perintah kerja</th><th>Rencana produksi</th><th>Gudang</th></tr></thead>
            <tbody>
              {(data?.items ?? []).map((r) => (
                <tr key={`${r.id}-${r.line_id ?? 0}`}>
                  <td><div className="pap-cell-title">{r.item_name ?? (r.detail_synced ? '—' : 'Belum diambil dari Accurate')}</div><div className="pap-cell-sub">{r.item_no ?? ''}</div></td>
                  <td className="pap-nowrap"><CheckCircle2 className="pap-inline-icon pap-ok-icon" /> {r.number}</td>
                  <td className="pap-nowrap">{formatDate(r.trans_date)}</td>
                  <td className="pap-num pap-nowrap"><strong>{qty(r.quantity, r.unit)}</strong></td>
                  <td className="pap-nowrap">{r.wo_number ?? '—'}</td>
                  <td>{r.mo_number ? <><div className="pap-nowrap">{r.mo_number}</div>{r.mo_name && <div className="pap-cell-sub">{r.mo_name}</div>}</> : '—'}</td>
                  <td>{r.warehouse ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !data?.items.length && <div className="pap-empty">{q || tanggal ? 'Tidak ada penyelesaian yang cocok.' : `Belum ada penyelesaian barang jadi di ${monthLabel(periode)}. Klik "Sinkron sekarang" untuk mengambil dari Accurate.`}</div>}
          {loading && !data && <div className="pap-empty">Memuat hasil produksi...</div>}
        </div>
      </div>
    </>
  )
}
