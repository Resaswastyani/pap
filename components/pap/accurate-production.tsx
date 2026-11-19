'use client'

import { useCallback, useEffect, useState } from 'react'
import { CalendarRange, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Factory, Layers, PackageCheck, Pencil, Plus, Scale, Search, Trash2, Users, Wallet, X } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { AccurateSyncBar, formatNumber, formatRupiah } from './accurate'
import { BarList, ColumnChart } from './charts'
import { api, formatDate, Modal, Notice, Pager, Progress, usePaged } from './ui'

// Rencana Produksi (MP) dan Penyelesaian Barang Jadi (FGS) langsung dari Accurate Online (hanya baca)

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
export const monthLabel = (ym: string) => (ym ? `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` : '')
const shiftMonth = (ym: string, delta: number) => {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + delta, 1))
  return d.toISOString().slice(0, 7)
}
const qty = (v: number | null | undefined, unit?: string | null) => (v === null || v === undefined ? '—' : `${formatNumber(v)}${unit ? ` ${unit}` : ''}`)
const range = (a: string | null, b: string | null) => (!a && !b ? '—' : a === b || !b ? formatDate(a) : `${formatDate(a)} – ${formatDate(b)}`)

export function MonthNav({ periode, onChange }: { periode: string; onChange: (p: string) => void }) {
  return (
    <div className="pap-month-nav">
      <button className="pap-icon-button" onClick={() => onChange(shiftMonth(periode, -1))} aria-label="Bulan sebelumnya"><ChevronLeft /></button>
      <button className="pap-icon-button" onClick={() => onChange(shiftMonth(periode, 1))} aria-label="Bulan berikutnya"><ChevronRight /></button>
      <strong>{monthLabel(periode)}</strong>
    </div>
  )
}

export function useDebounced<T>(value: T, ms = 300) {
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
  unit_cost: number | null; nilai: number | null; shifts: PlanShift[]; shift_quantity: number
}
type PlanShift = { id: number; shift: number; tanggal: string | null; quantity: number; unit_price: number | null; nilai: number | null; catatan: string | null }
type ShiftSummary = { shift: number; formula: number; nilai: number; per_satuan: { satuan: string; kuantitas: number }[] }
type Plan = {
  id: number; number: string | null; name: string | null; trans_date: string | null; start_date: string | null; end_date: string | null
  status: string | null; status_name: string | null; progress: number | null; description: string | null; detail_synced: boolean; lines: PlanLine[]
}
type PlanStats = { rencana: number; formula: number; formula_berjalan: number; belum_lengkap: number; nilai: number; tanpa_harga: number; per_satuan: { satuan: string; kuantitas: number; kuantitas_jadi: number }[] }

const lineTone = (s: string | null) => (s === 'FINISHED' ? 'success' : s === 'ONPROCESS' || s === 'PROCESSED' ? 'info' : 'warning')

export function ProductionPlanPage(_props: { user: UserProfile }) {
  const [periode, setPeriode] = useState('')
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const query = useDebounced(q)
  const [items, setItems] = useState<Plan[]>([])
  const [stats, setStats] = useState<PlanStats | null>(null)
  const [summary, setSummary] = useState<ShiftSummary[]>([])
  const [canShift, setCanShift] = useState(false)
  const [editing, setEditing] = useState<{ plan: Plan; line: PlanLine } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (periode) params.set('periode', periode)
      if (status) params.set('status', status)
      if (query) params.set('q', query)
      const res = await api<{ periode: string; items: Plan[]; stats: PlanStats; shift_summary: ShiftSummary[]; can: { shift: boolean } }>(`/api/production/plans?${params}`)
      setPeriode(res.periode)
      setItems(res.items)
      setStats(res.stats)
      setSummary(res.shift_summary)
      setCanShift(res.can.shift)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [periode, status, query])
  useEffect(() => { load() }, [load])
  // Paginasi per dokumen MP (baris formula ikut dokumennya)
  const paged = usePaged(items, [periode, status, query])

  // Satuan utama (terbanyak) di angka besar; satuan lain disebut di catatan
  const [main, ...others] = stats?.per_satuan ?? []
  const otherText = (key: 'kuantitas' | 'kuantitas_jadi') => others.map((u) => `+ ${qty(u[key], u.satuan)}`).join(' · ')
  const tiles: [string, string, string, typeof Factory, string, string][] = [
    ['', 'Rencana produksi', `${stats?.rencana ?? 0}`, ClipboardList, 'stat-1', `${stats?.formula ?? 0} formula produksi`],
    ['berjalan', 'Formula berjalan', `${stats?.formula_berjalan ?? 0}`, Factory, stats?.formula_berjalan ? 'stat-2' : 'stat-0', 'Belum selesai diproduksi'],
    ['', 'Kuantitas rencana', qty(main?.kuantitas ?? 0, main?.satuan ?? 'kg'), Scale, 'stat-1', otherText('kuantitas') || monthLabel(periode)],
    ['selesai', 'Kuantitas jadi', qty(main?.kuantitas_jadi ?? 0, main?.satuan ?? 'kg'), PackageCheck, 'stat-0',
      main?.kuantitas ? `${Math.round((main.kuantitas_jadi / main.kuantitas) * 100)}% dari rencana${others.length ? ` · ${otherText('kuantitas_jadi')}` : ''}` : 'Penyelesaian barang jadi'],
    ['', 'Nilai rencana', shortRupiah(stats?.nilai ?? 0), Wallet, 'stat-2', stats?.tanpa_harga ? `${stats.tanpa_harga} formula belum ada harga` : 'Kuantitas × harga per satuan'],
  ]
  const hasSummary = summary.some((s) => s.formula > 0)

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
      <div className="pap-stat-grid four five">
        {tiles.map(([key, label, value, Icon, tone, note]) => (
          <button key={label} className={`pap-stat-card pap-stat-button ${key && status === key ? 'active' : ''}`} onClick={() => key && setStatus(status === key ? '' : key)} disabled={!key}>
            <div><span>{label}</span><strong className="pap-stat-text">{value}</strong><small className="neutral">{note}</small></div>
            <div className={`pap-stat-icon ${tone}`}><Icon /></div>
          </button>
        ))}
      </div>
      <div className="pap-table-card">
        <div className="pap-card-head">
          <div><h2>Daftar rencana produksi</h2><p>Per dokumen MP · baris = formula produksi dari Accurate. Pembagian shift, jumlah, dan nilai diatur di SIMPAP.</p></div>
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
        {hasSummary && (
          <div className="pap-shift-summary" aria-label="Ringkasan pembagian shift bulan ini">
            {summary.map((s) => (
              <div key={s.shift} className={`pap-shift-sum s${s.shift}`}>
                <span className="pap-shift-tag">Shift {s.shift}</span>
                <strong>{s.per_satuan.length ? s.per_satuan.map((u) => qty(u.kuantitas, u.satuan)).join(' + ') : '—'}</strong>
                <small>{s.formula} formula · {formatRupiah(s.nilai)}</small>
              </div>
            ))}
          </div>
        )}
        {!!stats?.belum_lengkap && <div className="pap-card-notice"><Notice kind="success">{stats.belum_lengkap} rencana bulan ini belum lengkap baris formulanya; akan terisi pada sinkron berikutnya.</Notice></div>}
        {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <div className="pap-table-wrap">
          <table className="pap-plan-table">
            <thead><tr><th>Produk utama</th><th className="pap-num">Kuantitas</th><th>Pengerjaan shift</th><th className="pap-num">Nilai</th><th>Status</th><th>Progres</th><th>Jadwal produksi</th><th className="pap-num">Kts produk jadi</th></tr></thead>
            <tbody>
              {paged.items.flatMap((p) => {
                const planValue = p.lines.reduce((a, l) => a + (l.nilai ?? 0), 0)
                return [
                <tr key={`mo${p.id}`} className="pap-group-row pap-plan-head">
                  <td colSpan={8}>
                    <div className="pap-plan-title">
                      <span><b>{p.number}</b>{p.name ? ` · ${p.name}` : ''}</span>
                      <span className="pap-cell-sub">{formatDate(p.trans_date)} · {p.lines.length} formula{planValue ? ` · ${formatRupiah(planValue)}` : ''}{p.status_name ? ` · ${p.status_name}` : ''}</span>
                    </div>
                  </td>
                </tr>,
                ...(p.lines.length ? p.lines.map((l) => {
                  const price = l.shifts.length === 1 && l.shifts[0].unit_price !== null ? l.shifts[0].unit_price : l.unit_cost
                  return (
                  <tr key={`l${p.id}-${l.line_id}`}>
                    <td>
                      <div className="pap-cell-title pap-plan-item">{l.item_name ?? '—'}</div>
                      <div className="pap-cell-sub">{[l.item_no, l.bom_number].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="pap-num pap-nowrap">{qty(l.quantity, l.unit)}</td>
                    <td><ShiftCell line={l} canEdit={canShift} onEdit={() => setEditing({ plan: p, line: l })} /></td>
                    <td className="pap-num pap-nowrap">
                      <strong>{formatRupiah(l.nilai)}</strong>
                      <div className="pap-cell-sub">{price ? `@ ${formatRupiah(price)}/${l.unit ?? 'satuan'}` : 'harga belum ada'}</div>
                    </td>
                    <td><span className={`pap-status ${lineTone(l.status)}`}>{l.status_name ?? l.status ?? '—'}</span></td>
                    <td><Progress value={Math.round(l.progress ?? 0)} /></td>
                    <td className="pap-nowrap">{range(l.start_date, l.end_date)}</td>
                    <td className="pap-num pap-nowrap"><strong>{qty(l.fgs_quantity, l.unit)}</strong></td>
                  </tr>
                  )
                }) : [
                  <tr key={`e${p.id}`}><td colSpan={8} className="pap-muted">{p.detail_synced ? 'Tidak ada formula produksi.' : 'Baris formula belum diambil dari Accurate.'}</td></tr>,
                ]),
              ]
              })}
            </tbody>
          </table>
          {!loading && !items.length && <div className="pap-empty">{q || status ? 'Tidak ada rencana produksi yang cocok.' : `Belum ada rencana produksi di ${monthLabel(periode)}. Klik "Sinkron sekarang" untuk mengambil dari Accurate.`}</div>}
          {loading && !items.length && <div className="pap-empty">Memuat rencana produksi...</div>}
          <Pager {...paged.pager} noun="rencana produksi" />
        </div>
      </div>
      {editing && <ShiftModal plan={editing.plan} line={editing.line} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
    </>
  )
}

// Rupiah ringkas untuk kartu statistik: Rp 1,2 M / Rp 350 jt
const shortRupiah = (v: number) =>
  v >= 1e9 ? `Rp ${(v / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M` : v >= 1e6 ? `Rp ${(v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt` : formatRupiah(v)

// Sel "Pengerjaan shift": shift yang mengerjakan + jumlahnya; sisa yang belum dibagi ditandai
function ShiftCell({ line, canEdit, onEdit }: { line: PlanLine; canEdit: boolean; onEdit: () => void }) {
  const sisa = (line.quantity ?? 0) - line.shift_quantity
  return (
    <div className="pap-shift-cell">
      {line.shifts.length ? (
        <>
          <div className="pap-shift-chips">
            {line.shifts.map((s) => (
              <span key={s.id} className={`pap-shift-chip s${s.shift}`} title={[s.tanggal ? formatDate(s.tanggal) : '', s.catatan ?? ''].filter(Boolean).join(' · ') || undefined}>
                <b>S{s.shift}</b> {qty(s.quantity, line.unit)}
              </span>
            ))}
          </div>
          {line.quantity !== null && Math.abs(sisa) > 1e-6 && (
            <small className={sisa > 0 ? 'pap-shift-rest' : 'pap-shift-over'}>{sisa > 0 ? `Sisa ${qty(sisa, line.unit)} belum dibagi` : `Lebih ${qty(-sisa, line.unit)} dari rencana`}</small>
          )}
        </>
      ) : <span className="pap-muted">Belum dibagi</span>}
      {canEdit && (
        <button type="button" className="pap-link-button pap-shift-edit" onClick={onEdit}>
          {line.shifts.length ? <><Pencil /> Ubah</> : <><Users /> Atur shift</>}
        </button>
      )}
    </div>
  )
}

type ShiftDraft = { shift: string; tanggal: string; quantity: string; unit_price: string; catatan: string }
const toNum = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))

// Form pembagian shift satu formula: siapa (shift) mengerjakan berapa, tanggal, dan nilainya
function ShiftModal({ plan, line, onClose, onSaved }: { plan: Plan; line: PlanLine; onClose: () => void; onSaved: () => void }) {
  const unit = line.unit ?? ''
  const defaultDate = line.start_date?.slice(0, 10) ?? ''
  const blank = (shift: number, quantity = ''): ShiftDraft => ({ shift: String(shift), tanggal: defaultDate, quantity, unit_price: '', catatan: '' })
  const [rows, setRows] = useState<ShiftDraft[]>(() =>
    line.shifts.length
      ? line.shifts.map((s) => ({ shift: String(s.shift), tanggal: s.tanggal ?? '', quantity: String(s.quantity), unit_price: s.unit_price === null ? '' : String(s.unit_price), catatan: s.catatan ?? '' }))
      : [blank(1, line.quantity ? String(line.quantity) : '')],
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const update = (i: number, patch: Partial<ShiftDraft>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const total = rows.reduce((a, r) => a + (toNum(r.quantity) ?? 0), 0)
  const nilai = rows.reduce((a, r) => a + (toNum(r.quantity) ?? 0) * (toNum(r.unit_price) ?? line.unit_cost ?? 0), 0)
  const sisa = (line.quantity ?? 0) - total
  const hasPrice = rows.some((r) => toNum(r.unit_price) !== null) || line.unit_cost !== null

  // Bagi rata kuantitas rencana ke Shift 1, 2, 3
  function splitEven() {
    const q = line.quantity ?? 0
    const part = Math.floor((q / 3) * 100) / 100
    setRows([1, 2, 3].map((s) => blank(s, String(s === 3 ? Math.round((q - part * 2) * 100) / 100 : part))))
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api(`/api/production/plans/${plan.id}/lines/${line.line_id}`, {
        method: 'PUT',
        json: { rows: rows.map((r) => ({ shift: Number(r.shift), tanggal: r.tanggal || null, quantity: toNum(r.quantity), unit_price: toNum(r.unit_price), catatan: r.catatan })) },
      })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal title="Pembagian shift" subtitle={`${plan.number ?? ''} · ${line.item_name ?? ''}`} wide onClose={onClose}
      footer={<>
        <div className="pap-shift-total">
          <span>Dibagi <b>{qty(total, unit)}</b> dari {qty(line.quantity, unit)}{sisa > 1e-6 ? ` · sisa ${qty(sisa, unit)}` : sisa < -1e-6 ? ` · lebih ${qty(-sisa, unit)}` : ''}</span>
          <span>Nilai <b>{hasPrice ? formatRupiah(nilai) : '—'}</b></span>
        </div>
        <span className="pap-spacer" />
        <button type="button" className="pap-btn" onClick={onClose}>Batal</button>
        <button className="pap-primary-button" form="pap-shift-form" disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan'}</button>
      </>}>
      <form id="pap-shift-form" className="pap-shift-form" onSubmit={save}>
        {error && <Notice onClose={() => setError('')}>{error}</Notice>}
        <div className="pap-shift-info">
          <span>Rencana <b>{qty(line.quantity, unit)}</b></span>
          <span>Jadwal <b>{range(line.start_date, line.end_date)}</b></span>
          <span>Harga pokok <b>{line.unit_cost ? `${formatRupiah(line.unit_cost)}/${unit || 'satuan'}` : 'belum ada di Accurate'}</b></span>
        </div>
        <div className="pap-shift-rows">
          {rows.map((r, i) => {
            const rowValue = (toNum(r.quantity) ?? 0) * (toNum(r.unit_price) ?? line.unit_cost ?? 0)
            return (
              <div key={i} className="pap-shift-row">
                <label><span>Shift</span>
                  <select className="pap-select" value={r.shift} onChange={(e) => update(i, { shift: e.target.value })}>
                    <option value="1">Shift 1</option><option value="2">Shift 2</option><option value="3">Shift 3</option>
                  </select>
                </label>
                <label><span>Tanggal</span><input className="pap-input" type="date" value={r.tanggal} onChange={(e) => update(i, { tanggal: e.target.value })} /></label>
                <label><span>Jumlah{unit ? ` (${unit})` : ''} *</span><input className="pap-input" inputMode="decimal" required value={r.quantity} onChange={(e) => update(i, { quantity: e.target.value.replace(/[^\d.,]/g, '') })} placeholder="0" /></label>
                <label><span>Harga/{unit || 'satuan'} (Rp)</span><input className="pap-input" inputMode="decimal" value={r.unit_price} onChange={(e) => update(i, { unit_price: e.target.value.replace(/[^\d.,]/g, '') })} placeholder={line.unit_cost ? String(Math.round(line.unit_cost)) : 'isi harga'} /></label>
                <label className="pap-shift-note"><span>Regu / operator / catatan</span><input className="pap-input" maxLength={255} value={r.catatan} onChange={(e) => update(i, { catatan: e.target.value })} placeholder="opsional" /></label>
                <div className="pap-shift-row-end">
                  <span className="pap-shift-row-value">{hasPrice ? formatRupiah(rowValue) : '—'}</span>
                  <button type="button" className="pap-icon-button" aria-label={`Hapus baris ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 /></button>
                </div>
              </div>
            )
          })}
          {!rows.length && <p className="pap-muted">Belum ada pembagian. Simpan dalam keadaan kosong untuk menghapus pembagian shift.</p>}
        </div>
        <div className="pap-inline-actions">
          <button type="button" className="pap-btn" onClick={() => setRows([...rows, blank(Math.min(3, rows.length + 1), sisa > 0 ? String(Math.round(sisa * 100) / 100) : '')])} disabled={rows.length >= 30}><Plus /> Tambah shift</button>
          {!!line.quantity && <button type="button" className="pap-btn" onClick={splitEven}>Bagi rata 3 shift</button>}
        </div>
        <p className="pap-muted pap-shift-hint">Harga kosong memakai harga pokok rata-rata barang dari Accurate. Data Accurate tidak diubah.</p>
      </form>
    </Modal>
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
  const paged = usePaged(data?.items ?? [], [periode, tanggal, query])

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
              {paged.items.map((r) => (
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
          <Pager {...paged.pager} noun="penyelesaian" />
        </div>
      </div>
    </>
  )
}
