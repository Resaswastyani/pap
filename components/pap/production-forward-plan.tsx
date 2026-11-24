'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock, CalendarDays, ClipboardList, FlaskConical, Package, Plus, Search, ShoppingCart, Wallet } from 'lucide-react'
import { AccurateSyncBar, formatNumber, formatRupiah } from './accurate'
import { api, confirmDialog, formatDate, Modal, Notice, Pager, RowActions, usePaged } from './ui'

// Rencana Produksi ke depan (CRUD): tanggal + Shift 1/2/3 + produk (dari pesanan atau produk Accurate) + jumlah + nilai

type Entry = {
  id: number; tanggal: string; shift: number; sumber: Sumber; job_id: number | null; sample_id: number | null; sample_item_id: number | null; item_accurate_id: number | null; item_no: string | null; item_name: string
  customer_name: string | null; so_number: string | null; due_date: string | null; quantity: number; unit: string | null; unit_price: number | null; nilai: number | null; catatan: string | null
  capacity_id: number | null; mesin: string | null
}
type Machine = { id: number; mesin: string; jenis_plastik: string; jumlah_mesin: number; lebar_min_cm: number | null; lebar_maks_cm: number | null }
type Job = {
  id: number; so_number: string | null; so_date: string | null; due_date: string | null; item_accurate_id: number | null; item_name: string; item_no: string | null; customer: string | null
  quantity: number; unit: string | null; unit_price: number | null; nilai: number | null; prioritas: string; terjadwal: number
}
type Sumber = 'pesanan' | 'produk' | 'sample'
type Sample = {
  id: number; item_id: number | null; nomor: string | null; status: string; tenggat: string | null; jadwal_produksi: string | null; customer: string | null
  nama: string; jumlah: string | null; spek: string | null; terjadwal: number; rencana: number
}
type PlanRes = { today: string; machines: Machine[]; units: string[]; samples: Sample[]; entries: Entry[]; jobs: Job[]; can: { plan: boolean } }
const sampleKey = (s: { id: number; item_id: number | null }) => `${s.id}:${s.item_id ?? 0}`
const SAMPLE_STATUS_LABEL: Record<string, string> = { diajukan: 'Diajukan', dijadwalkan: 'Disetujui & dijadwalkan', diproduksi: 'Diproduksi', revisi: 'Revisi spek' }
const SUMBER_LABEL: Record<Sumber, string> = { pesanan: 'dari pesanan', produk: 'dari produk Accurate', sample: 'pembuatan sample' }
type Product = { id: number; item_no: string | null; name: string; unit: string | null; price: number | null; price_source: string | null }

const RANGES = [7, 14, 30] as const
const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
const qty = (v: number | null | undefined, unit?: string | null) => (v === null || v === undefined ? '—' : `${formatNumber(v)}${unit ? ` ${unit}` : ''}`)
const shortRupiah = (v: number) =>
  v >= 1e9 ? `Rp ${(v / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M` : v >= 1e6 ? `Rp ${(v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt` : formatRupiah(v)
const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5)
const dayLabel = (ymd: string, today: string) => {
  const d = dayDiff(ymd, today)
  return `${d === 0 ? 'Hari ini · ' : d === 1 ? 'Besok · ' : ''}${DAYS[new Date(`${ymd}T00:00:00Z`).getUTCDay()]}, ${formatDate(ymd)}`
}
// Jumlah per satuan (kg dan Pcs tidak dicampur)
const unitText = (list: { quantity: number; unit: string | null }[]) => {
  const m = new Map<string, number>()
  for (const x of list) m.set(x.unit ?? '', (m.get(x.unit ?? '') ?? 0) + x.quantity)
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([u, v]) => qty(v, u)).join(' + ') || '—'
}
const round2 = (v: number) => Math.round(v * 100) / 100
function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}
const toNum = (v: string) => (v.trim() === '' ? 0 : Number(v.replace(',', '.')) || 0)

function DueBadge({ due, today }: { due: string | null; today: string }) {
  if (!due) return <span className="pap-muted">—</span>
  const d = dayDiff(due, today)
  return (
    <span className="pap-due">
      {formatDate(due)}
      <small className={d < 0 ? 'late' : d <= 3 ? 'soon' : ''}>{d < 0 ? `Lewat ${-d} hari` : d === 0 ? 'Kirim hari ini' : `H-${d}`}</small>
    </span>
  )
}

type FormState = { mode: 'baru'; job?: Job; sample?: Sample } | { mode: 'ubah'; entry: Entry }

export function ForwardPlanView() {
  const [data, setData] = useState<PlanRes | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [days, setDays] = useState<number>(14)
  const [shiftFilter, setShiftFilter] = useState(0)
  const [q, setQ] = useState('')
  const [form, setForm] = useState<FormState | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await api<PlanRes>('/api/production/rencana'))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  // aislop-ignore-next-line react/set-state-in-effect -- memuat data dari server sekali saat halaman dibuka
  useEffect(() => { load() }, [load])
  // Tanggal hari ini (WIB) dihitung sekali, bukan di setiap render
  const [todayWib] = useState(() => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10))

  const today = data?.today ?? todayWib
  const end = addDays(today, days - 1)
  const query = q.trim().toLowerCase()
  const match = (...values: (string | null)[]) => !query || values.some((v) => v?.toLowerCase().includes(query))
  const can = data?.can.plan ?? false

  const entries = useMemo(() => (data?.entries ?? []).filter((e) => e.tanggal <= end && (!shiftFilter || e.shift === shiftFilter) && match(e.item_name, e.item_no, e.customer_name, e.so_number, e.catatan, e.mesin)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, end, shiftFilter, query])
  const byDate = useMemo(() => {
    const m = new Map<string, Entry[]>()
    for (const e of entries) m.set(e.tanggal, [...(m.get(e.tanggal) ?? []), e])
    return [...m.entries()]
  }, [entries])
  const pending = useMemo(() => (data?.jobs ?? []).filter((j) => j.quantity - j.terjadwal > 1e-6 && match(j.item_name, j.item_no, j.customer, j.so_number)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, query])
  const paged = usePaged(pending, [query])
  const pendingSamples = (data?.samples ?? []).filter((s) => !s.rencana && match(s.nama, s.nomor, s.customer, s.spek))

  const allJobs = data?.jobs ?? []
  const allPending = allJobs.filter((j) => j.quantity - j.terjadwal > 1e-6)
  const urgent = allPending.filter((j) => j.due_date && dayDiff(j.due_date, today) <= 3).length
  const inRange = (data?.entries ?? []).filter((e) => e.tanggal <= end)
  const rangeValue = inRange.reduce((a, e) => a + (e.nilai ?? 0), 0)
  const perShift = [1, 2, 3].map((shift) => {
    const list = inRange.filter((e) => e.shift === shift)
    return { shift, n: list.length, text: unitText(list), nilai: list.reduce((a, e) => a + (e.nilai ?? 0), 0) }
  })
  const tiles: [string, string, typeof ClipboardList, string, string][] = [
    [`Rencana ${days} hari`, `${inRange.length}`, ClipboardList, 'stat-1', `s.d. ${formatDate(end)}`],
    [`Jumlah ${days} hari`, unitText(inRange), CalendarClock, 'stat-1', `${new Set(inRange.map((e) => e.tanggal)).size} hari produksi`],
    [`Nilai rencana ${days} hari`, shortRupiah(rangeValue), Wallet, 'stat-0', 'Jumlah × harga per satuan'],
    ['Pesanan belum direncanakan', `${allPending.length}`, AlertTriangle, urgent ? 'stat-2' : 'stat-0', urgent ? `${urgent} kirim ≤ 3 hari lagi` : 'Tidak ada yang mendesak'],
  ]

  async function remove(e: Entry) {
    if (!(await confirmDialog({ title: 'Hapus rencana produksi?', message: `${dayLabel(e.tanggal, today)} · Shift ${e.shift}\n${e.item_name} · ${qty(e.quantity, e.unit)}\n\nData dipindah ke Data Terhapus dan bisa dipulihkan.`, confirmLabel: 'Hapus', tone: 'danger' }))) return
    try {
      await api(`/api/production/rencana/${e.id}`, { method: 'DELETE' })
      setNotice('Rencana produksi dihapus.')
      load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <>
      <AccurateSyncBar entities={['sales-order', 'sales-order-items']} canSync onSynced={load} />
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {notice && <Notice kind="success" onClose={() => setNotice('')}>{notice}</Notice>}
      <div className="pap-stat-grid four">
        {tiles.map(([label, value, Icon, tone, note]) => (
          <div key={label} className="pap-stat-card">
            <div><span>{label}</span><strong className="pap-stat-text">{value}</strong><small className="neutral">{note}</small></div>
            <div className={`pap-stat-icon ${tone}`}><Icon /></div>
          </div>
        ))}
      </div>

      <div className="pap-table-card">
        <div className="pap-card-head pap-plan-card-head">
          <div><h2>Jadwal rencana produksi</h2><p>Mulai hari ini sampai {days} hari ke depan, per tanggal dan shift.</p></div>
          <div className="pap-plan-head-actions">
            <div className="pap-segmented" role="tablist" aria-label="Rentang hari">
              {RANGES.map((r) => <button key={r} role="tab" aria-selected={days === r} className={days === r ? 'active' : ''} onClick={() => setDays(r)}>{r} hari</button>)}
            </div>
            {can && <button className="pap-primary-button" onClick={() => setForm({ mode: 'baru' })}><Plus /> Rencana baru</button>}
          </div>
        </div>
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari produk, customer, nomor SO..." /></label>
          <select className="pap-select" value={shiftFilter} onChange={(e) => setShiftFilter(Number(e.target.value))} aria-label="Filter shift">
            <option value={0}>Semua shift</option><option value={1}>Shift 1</option><option value={2}>Shift 2</option><option value={3}>Shift 3</option>
          </select>
        </div>
        <div className="pap-shift-summary" aria-label="Ringkasan per shift">
          {perShift.map((s) => (
            <div key={s.shift} className={`pap-shift-sum s${s.shift}`}>
              <span className="pap-shift-tag">Shift {s.shift}</span>
              <strong>{s.text}</strong>
              <small>{s.n} rencana · {formatRupiah(s.nilai)}</small>
            </div>
          ))}
        </div>
        <div className="pap-table-wrap">
          <table className="pap-plan-table">
            <thead><tr><th>Shift</th><th>Produk</th><th>Customer / SO</th><th className="pap-num">Jumlah</th><th className="pap-num">Nilai</th><th>Tanggal kirim</th>{can && <th aria-label="Aksi" />}</tr></thead>
            <tbody>
              {byDate.flatMap(([tanggal, list]) => [
                <tr key={`d${tanggal}`} className="pap-group-row pap-plan-head">
                  <td colSpan={can ? 7 : 6}>
                    <div className="pap-plan-title">
                      <span><CalendarDays className="pap-inline-icon" /> <b>{dayLabel(tanggal, today)}</b></span>
                      <span className="pap-cell-sub">{list.length} rencana · {unitText(list)} · {formatRupiah(list.reduce((a, e) => a + (e.nilai ?? 0), 0))}</span>
                    </div>
                  </td>
                </tr>,
                ...list.map((e) => (
                  <tr key={e.id}>
                    <td><span className={`pap-shift-chip s${e.shift}`}><b>Shift {e.shift}</b></span>{e.mesin ? <div className="pap-cell-sub">{e.mesin}</div> : <div className="pap-cell-sub pap-text-warning">Mesin belum dipilih</div>}{e.catatan && <div className="pap-cell-sub">{e.catatan}</div>}</td>
                    <td><div className="pap-cell-title pap-plan-item">{e.item_name}</div><div className="pap-cell-sub">{[e.item_no, SUMBER_LABEL[e.sumber] ?? e.sumber].filter(Boolean).join(' · ')}</div></td>
                    <td><div>{e.customer_name ?? '—'}</div>{e.so_number && <div className="pap-cell-sub">{e.so_number}</div>}</td>
                    <td className="pap-num pap-nowrap"><strong>{qty(e.quantity, e.unit)}</strong></td>
                    <td className="pap-num pap-nowrap"><strong>{formatRupiah(e.nilai)}</strong>{e.unit_price !== null && <div className="pap-cell-sub">@ {formatRupiah(e.unit_price)}</div>}</td>
                    <td className="pap-nowrap"><DueBadge due={e.due_date} today={today} /></td>
                    {can && <td><RowActions label={e.item_name} onEdit={() => setForm({ mode: 'ubah', entry: e })} onDelete={() => remove(e)} /></td>}
                  </tr>
                )),
              ])}
            </tbody>
          </table>
          {data && !byDate.length && <div className="pap-empty">Belum ada rencana produksi dari hari ini sampai {formatDate(end)}{shiftFilter ? ` untuk Shift ${shiftFilter}` : ''}.{can ? ' Klik "Rencana baru" atau rencanakan pesanan di bawah.' : ''}</div>}
          {!data && !error && <div className="pap-empty">Memuat rencana produksi...</div>}
        </div>
      </div>

      <div className="pap-table-card pap-plan-pending">
        <div className="pap-card-head">
          <div><h2>Pesanan belum direncanakan</h2><p>Pesanan Accurate (barang diproduksi) dengan tanggal kirim mulai hari ini yang belum seluruhnya punya rencana. Urut tanggal kirim terdekat.</p></div>
        </div>
        <div className="pap-table-wrap">
          <table className="pap-plan-table">
            <thead><tr><th>Produk</th><th>Customer / SO</th><th>Tanggal kirim</th><th className="pap-num">Pesanan</th><th className="pap-num">Belum direncanakan</th><th className="pap-num">Nilai pesanan</th>{can && <th aria-label="Aksi" />}</tr></thead>
            <tbody>
              {paged.items.map((job) => (
                <tr key={job.id}>
                  <td><div className="pap-cell-title pap-plan-item">{job.item_name}</div><div className="pap-cell-sub">{job.item_no ?? ''}{job.prioritas === 'tinggi' ? ' · Prioritas tinggi' : ''}</div></td>
                  <td><div>{job.customer ?? '—'}</div><div className="pap-cell-sub">{job.so_number ?? ''}{job.so_date ? ` · ${formatDate(job.so_date)}` : ''}</div></td>
                  <td className="pap-nowrap"><DueBadge due={job.due_date} today={today} /></td>
                  <td className="pap-num pap-nowrap">{qty(job.quantity, job.unit)}</td>
                  <td className="pap-num pap-nowrap"><strong>{qty(job.quantity - job.terjadwal, job.unit)}</strong>{job.terjadwal > 0 && <div className="pap-cell-sub">{qty(job.terjadwal, job.unit)} direncanakan</div>}</td>
                  <td className="pap-num pap-nowrap">{formatRupiah(job.nilai)}</td>
                  {can && <td><button type="button" className="pap-primary-button pap-plan-btn" onClick={() => setForm({ mode: 'baru', job })}><CalendarClock /> Rencanakan</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
          {data && !pending.length && <div className="pap-empty">{query ? 'Tidak ada pesanan yang cocok.' : 'Tidak ada pesanan dengan tanggal kirim mulai hari ini yang belum direncanakan.'}</div>}
          <Pager {...paged.pager} noun="pesanan" />
        </div>
      </div>
      <div className="pap-table-card pap-plan-pending">
        <div className="pap-card-head">
          <div><h2>Sample belum direncanakan</h2><p>Request sample yang masih perlu dibuat (diajukan, dijadwalkan, diproduksi, revisi) dan belum punya rencana produksi. Urut tenggat terdekat.</p></div>
        </div>
        <div className="pap-table-wrap">
          <table className="pap-plan-table">
            <thead><tr><th>Sample</th><th>Customer / nomor</th><th>Tenggat</th><th>Jumlah diminta</th><th>Status</th>{can && <th aria-label="Aksi" />}</tr></thead>
            <tbody>
              {pendingSamples.map((s) => (
                <tr key={sampleKey(s)}>
                  <td><div className="pap-cell-title pap-plan-item">{s.nama}</div>{s.spek && <div className="pap-cell-sub">{s.spek}</div>}</td>
                  <td><div>{s.customer ?? '—'}</div><div className="pap-cell-sub">{s.nomor ?? ''}</div></td>
                  <td className="pap-nowrap"><DueBadge due={s.tenggat} today={today} /></td>
                  <td>{s.jumlah ?? '—'}</td>
                  <td>{SAMPLE_STATUS_LABEL[s.status] ?? s.status}</td>
                  {can && <td><button type="button" className="pap-primary-button pap-plan-btn" onClick={() => setForm({ mode: 'baru', sample: s })}><CalendarClock /> Rencanakan</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
          {data && !pendingSamples.length && <div className="pap-empty">{query ? 'Tidak ada sample yang cocok.' : 'Tidak ada request sample yang menunggu direncanakan.'}</div>}
        </div>
      </div>
      {form && data && (
        <PlanForm state={form} today={today} jobs={data.jobs} samples={data.samples ?? []} units={data.units ?? ['kg', 'Pcs']} machines={data.machines ?? []} onClose={() => setForm(null)}
          onSaved={(msg) => { setForm(null); setNotice(msg); load() }} />
      )}
    </>
  )
}

// Form tambah / ubah rencana: sumber produk (pesanan / produk Accurate), tanggal, shift, jumlah, harga, catatan
function PlanForm({ state, today, jobs, samples, units, machines, onClose, onSaved }: { state: FormState; today: string; jobs: Job[]; samples: Sample[]; units: string[]; machines: Machine[]; onClose: () => void; onSaved: (msg: string) => void }) {
  const edit = state.mode === 'ubah' ? state.entry : null
  const preJob = state.mode === 'baru' ? state.job : undefined
  const preSample = state.mode === 'baru' ? state.sample : undefined
  const [sumber, setSumber] = useState<Sumber>(edit?.sumber ?? (preSample ? 'sample' : preJob ? 'pesanan' : jobs.length ? 'pesanan' : 'produk'))
  const [sKey, setSKey] = useState(edit?.sample_id ? `${edit.sample_id}:${edit.sample_item_id ?? 0}` : preSample ? sampleKey(preSample) : '')
  const [sampleFilter, setSampleFilter] = useState('')
  const [jobId, setJobId] = useState<number | null>(edit?.job_id ?? preJob?.id ?? null)
  const [jobFilter, setJobFilter] = useState('')
  const [product, setProduct] = useState<Product | null>(edit && edit.sumber === 'produk' && edit.item_accurate_id
    ? { id: edit.item_accurate_id, item_no: edit.item_no, name: edit.item_name, unit: edit.unit, price: edit.unit_price, price_source: null } : null)
  const [productQ, setProductQ] = useState('')
  const productQuery = useDebounced(productQ)
  const [products, setProducts] = useState<Product[]>([])
  const [searching, setSearching] = useState(false)
  const [tanggal, setTanggal] = useState(edit?.tanggal ?? today)
  // Jumlah per shift langsung diisi; shift yang jumlahnya kosong / 0 tidak disimpan
  const [shifts, setShifts] = useState<Record<number, string>>(() => ({ 1: '', 2: '', 3: '', ...(edit ? { [edit.shift]: String(edit.quantity) } : {}) }))
  const [capacityId, setCapacityId] = useState(edit?.capacity_id ? String(edit.capacity_id) : '')
  const [customer, setCustomer] = useState(edit?.sumber === 'produk' ? edit.customer_name ?? '' : '')
  const [unit, setUnit] = useState(edit && edit.sumber !== 'pesanan' ? edit.unit ?? '' : preSample ? 'Pcs' : '')
  const [catatan, setCatatan] = useState(edit?.catatan ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const job = jobs.find((j) => j.id === jobId)
  const sample = samples.find((s) => sampleKey(s) === sKey)
  const shownSamples = samples.filter((s) => sampleKey(s) === sKey || !sampleFilter.trim() || [s.nama, s.nomor, s.customer, s.spek].some((v) => v?.toLowerCase().includes(sampleFilter.trim().toLowerCase())))
  useEffect(() => {
    if (sumber !== 'produk') return
    let alive = true
    setSearching(true)
    api<{ items: Product[] }>(`/api/production/rencana/produk?q=${encodeURIComponent(productQuery)}`)
      .then((r) => alive && setProducts(r.items)).catch(() => alive && setProducts([])).finally(() => alive && setSearching(false))
    return () => { alive = false }
  }, [sumber, productQuery])

  const shownJobs = jobs.filter((j) => j.id === jobId || !jobFilter.trim() || [j.item_name, j.item_no, j.customer, j.so_number].some((v) => v?.toLowerCase().includes(jobFilter.trim().toLowerCase())))
  const defaultPrice = sumber === 'pesanan' ? job?.unit_price ?? (edit?.sumber === 'pesanan' ? edit.unit_price : null) ?? null : sumber === 'produk' ? product?.price ?? null : null
  const unitShown = sumber === 'pesanan' ? job?.unit ?? edit?.unit ?? '' : unit || (sumber === 'produk' ? product?.unit : 'Pcs') || ''
  const unitOptions = [...new Map([...units, unitShown].filter(Boolean).map((u) => [u.toLowerCase(), u])).values()]
  const effPrice = defaultPrice
  const selectedShifts = [1, 2, 3].filter((s) => toNum(shifts[s] ?? '') > 0)
  const total = selectedShifts.reduce((a, s) => a + toNum(shifts[s] ?? ''), 0)
  const afterDue = sumber === 'pesanan' && job?.due_date && tanggal > job.due_date

  function splitEven() {
    const base = sumber === 'pesanan' && job ? job.quantity - job.terjadwal + (edit?.quantity ?? 0) : total
    if (!base) return
    const part = Math.floor((base / 3) * 100) / 100
    setShifts({ 1: String(part), 2: String(part), 3: String(round2(base - part * 2)) })
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (sumber === 'pesanan' && !jobId) return setError('Pilih pesanan yang akan diproduksi.')
    if (sumber === 'produk' && !product) return setError('Pilih produk Accurate yang akan diproduksi.')
    if (sumber === 'sample' && !sample) return setError('Pilih request sample yang akan dibuat.')
    if (!selectedShifts.length) return setError('Isi jumlah minimal di satu shift (Shift 1, 2, atau 3).')
    if (edit && selectedShifts.length > 1) return setError('Saat mengubah rencana, isi jumlah di satu shift saja. Tambahkan shift lain lewat "Rencana baru".')
    if (sumber !== 'pesanan' && !unitShown) return setError('Pilih satuan.')
    if (!capacityId) return setError('Pilih mesin.')
    setBusy(true)
    const body = {
      sumber, job_id: sumber === 'pesanan' ? jobId : null, item_accurate_id: sumber === 'produk' ? product?.id : null,
      sample_id: sumber === 'sample' ? sample?.id : null, sample_item_id: sumber === 'sample' ? sample?.item_id : null,
      tanggal, capacity_id: Number(capacityId), customer_name: customer, unit: sumber === 'pesanan' ? '' : unitShown, catatan,
      ...(edit ? { shift: selectedShifts[0], quantity: toNum(shifts[selectedShifts[0]] ?? '') } : { rows: selectedShifts.map((s) => ({ shift: s, quantity: toNum(shifts[s] ?? '') })) }),
    }
    try {
      await api(edit ? `/api/production/rencana/${edit.id}` : '/api/production/rencana', { method: edit ? 'PUT' : 'POST', json: body })
      onSaved(edit ? 'Rencana produksi diperbarui.' : `${selectedShifts.length} rencana produksi ditambahkan.`)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal title={edit ? 'Ubah rencana produksi' : 'Rencana produksi baru'} subtitle="Pilih produk dari pesanan, daftar produk Accurate, atau request sample" wide onClose={onClose}
      footer={<>
        <div className="pap-shift-total">
          <span>Jumlah <b>{qty(total, unitShown)}</b></span>
          <span>Nilai <b>{effPrice !== null ? formatRupiah(total * effPrice) : '—'}</b></span>
        </div>
        <span className="pap-spacer" />
        <button type="button" className="pap-btn" onClick={onClose}>Batal</button>
        <button className="pap-primary-button" form="pap-plan-form" disabled={busy}>{busy ? 'Menyimpan...' : edit ? 'Simpan perubahan' : 'Simpan rencana'}</button>
      </>}>
      <form id="pap-plan-form" className="pap-shift-form" onSubmit={save}>
        {error && <Notice onClose={() => setError('')}>{error}</Notice>}
        <div className="pap-segmented pap-plan-source" role="radiogroup" aria-label="Sumber produk">
          <button type="button" role="radio" aria-checked={sumber === 'pesanan'} className={sumber === 'pesanan' ? 'active' : ''} onClick={() => setSumber('pesanan')}><ShoppingCart /> Dari pesanan</button>
          <button type="button" role="radio" aria-checked={sumber === 'produk'} className={sumber === 'produk' ? 'active' : ''} onClick={() => setSumber('produk')}><Package /> Dari produk Accurate</button>
          <button type="button" role="radio" aria-checked={sumber === 'sample'} className={sumber === 'sample' ? 'active' : ''} onClick={() => { setSumber('sample'); if (!unit) setUnit('Pcs') }}><FlaskConical /> Dari request sample</button>
        </div>

        {sumber === 'sample' ? (
          <div className="pap-field">
            <span>Request sample *</span>
            <input className="pap-input" value={sampleFilter} onChange={(e) => setSampleFilter(e.target.value)} placeholder="Saring: produk, customer, nomor sample..." />
            <select className="pap-select" value={sKey} onChange={(e) => setSKey(e.target.value)} required>
              <option value="">— Pilih request sample ({shownSamples.length}) —</option>
              {edit?.sample_id && !sample && <option value={sKey}>{edit.so_number} · {edit.item_name} (sample lama)</option>}
              {shownSamples.map((s) => (
                <option key={sampleKey(s)} value={sampleKey(s)}>{[s.nomor, s.nama, s.customer, s.tenggat ? `tenggat ${formatDate(s.tenggat)}` : null, s.rencana ? 'sudah ada rencana' : null].filter(Boolean).join(' · ')}</option>
              ))}
            </select>
            {sample && (
              <div className="pap-shift-info">
                <span>Customer <b>{sample.customer ?? '—'}</b></span>
                <span>Jumlah diminta <b>{sample.jumlah ?? '—'}</b></span>
                <span>Tenggat <b>{sample.tenggat ? formatDate(sample.tenggat) : '—'}</b></span>
                <span>Status <b>{SAMPLE_STATUS_LABEL[sample.status] ?? sample.status}</b></span>
                {sample.spek && <span>Spek <b>{sample.spek}</b></span>}
              </div>
            )}
            {!samples.length && <small className="pap-muted">Tidak ada request sample yang masih perlu dibuat.</small>}
            <label className="pap-field"><span>Satuan *</span>
              <select className="pap-select" value={unitShown} onChange={(e) => setUnit(e.target.value)}>{unitOptions.map((u) => <option key={u} value={u}>{u}</option>)}</select>
            </label>
          </div>
        ) : sumber === 'pesanan' ? (
          <div className="pap-field">
            <span>Pesanan *</span>
            <input className="pap-input" value={jobFilter} onChange={(e) => setJobFilter(e.target.value)} placeholder="Saring: produk, customer, nomor SO..." />
            <select className="pap-select" value={jobId ?? ''} onChange={(e) => setJobId(e.target.value ? Number(e.target.value) : null)} required>
              <option value="">— Pilih pesanan ({shownJobs.length}) —</option>
              {edit?.sumber === 'pesanan' && edit.job_id && !jobs.some((j) => j.id === edit.job_id) && <option value={edit.job_id}>{edit.so_number} · {edit.item_name} (pesanan lama)</option>}
              {shownJobs.map((j) => (
                <option key={j.id} value={j.id}>{[j.so_number, j.item_name, j.customer, j.due_date ? `kirim ${formatDate(j.due_date)}` : null, `sisa ${qty(round2(j.quantity - j.terjadwal), j.unit)}`].filter(Boolean).join(' · ')}</option>
              ))}
            </select>
            {job && (
              <div className="pap-shift-info">
                <span>Customer <b>{job.customer ?? '—'}</b></span>
                <span>Pesanan <b>{qty(job.quantity, job.unit)}</b></span>
                <span>Sudah direncanakan <b>{qty(job.terjadwal, job.unit)}</b></span>
                <span>Kirim <b>{job.due_date ? formatDate(job.due_date) : '—'}</b></span>
                <span>Harga jual <b>{job.unit_price !== null ? formatRupiah(job.unit_price) : '—'}</b></span>
              </div>
            )}
            {!jobs.length && <small className="pap-muted">Tidak ada pesanan terbuka dengan tanggal kirim mulai hari ini. Pakai "Dari produk Accurate".</small>}
          </div>
        ) : (
          <div className="pap-field">
            <span>Produk Accurate *</span>
            {product ? (
              <div className="pap-plan-picked">
                <div><b>{product.name}</b><small>{[product.item_no, product.unit, product.price !== null ? `${formatRupiah(product.price)}${product.price_source ? ` (${product.price_source})` : ''}` : null].filter(Boolean).join(' · ')}</small></div>
                <button type="button" className="pap-btn" onClick={() => setProduct(null)}>Ganti</button>
              </div>
            ) : (
              <>
                <label className="pap-filter-search"><Search /><input value={productQ} onChange={(e) => setProductQ(e.target.value)} placeholder="Cari nama / kode produk..." autoFocus /></label>
                <div className="pap-plan-results" role="listbox" aria-label="Hasil pencarian produk">
                  {products.map((p) => (
                    <button type="button" role="option" aria-selected={false} key={p.id} onClick={() => { setProduct(p); setUnit(p.unit ?? '') }}>
                      <b>{p.name}</b><small>{[p.item_no, p.unit, p.price !== null ? formatRupiah(p.price) : null].filter(Boolean).join(' · ')}</small>
                    </button>
                  ))}
                  {!searching && !products.length && <p className="pap-muted">Produk tidak ditemukan.</p>}
                  {searching && !products.length && <p className="pap-muted">Mencari...</p>}
                </div>
              </>
            )}
            <div className="pap-form-grid">
              <label className="pap-field"><span>Customer (opsional)</span><input className="pap-input" maxLength={255} value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="mis. stok / nama customer" /></label>
              <label className="pap-field"><span>Satuan *</span>
                <select className="pap-select" value={unitShown} onChange={(e) => setUnit(e.target.value)}>
                  {!unitShown && <option value="">— Pilih satuan —</option>}
                  {unitOptions.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </label>
            </div>
          </div>
        )}

        <div className="pap-form-grid">
          <label className="pap-field"><span>Tanggal produksi *</span><input className="pap-input" type="date" required min={edit && edit.tanggal < today ? edit.tanggal : today} value={tanggal} onChange={(e) => setTanggal(e.target.value)} /></label>
          <label className="pap-field">
            <span>Mesin *</span>
            <select className="pap-select" required value={capacityId} onChange={(e) => setCapacityId(e.target.value)}>
              <option value="">— Pilih mesin —</option>
              {machines.map((m) => <option key={m.id} value={m.id}>{m.jumlah_mesin > 1 ? `${m.jumlah_mesin} ` : ''}{m.mesin} · {m.jenis_plastik}{m.lebar_maks_cm !== null ? ` · lebar ${m.lebar_min_cm !== null ? `${m.lebar_min_cm}–` : 's/d '}${m.lebar_maks_cm} cm` : ''}</option>)}
            </select>
            {!machines.length && <small className="pap-muted">Belum ada mesin. Tambahkan dulu di menu Kapasitas Produksi.</small>}
          </label>
        </div>
        {afterDue && <Notice>Tanggal produksi setelah tanggal kirim pesanan ({formatDate(job?.due_date)}). Pastikan pengiriman masih terkejar.</Notice>}

        <div className="pap-field">
          <span>Shift & jumlah *<small className="pap-muted"> {edit ? '(isi satu shift; pindahkan jumlahnya untuk ganti shift)' : '(isi jumlah di shift yang dipakai; boleh lebih dari satu, kosongkan yang tidak dipakai)'}</small></span>
          <div className="pap-plan-shifts">
            {[1, 2, 3].map((s) => (
              <label key={s} className={`pap-plan-shift ${toNum(shifts[s] ?? '') > 0 ? 'on' : ''}`}>
                <span className={`pap-shift-chip s${s}`}><b>Shift {s}</b></span>
                <input className="pap-input" inputMode="decimal" aria-label={`Jumlah Shift ${s}`} value={shifts[s] ?? ''} onChange={(e) => setShifts({ ...shifts, [s]: e.target.value.replace(/[^\d.,]/g, '') })} placeholder={`0 ${unitShown}`} />
              </label>
            ))}
          </div>
          {!edit && <div className="pap-inline-actions"><button type="button" className="pap-btn" onClick={splitEven}>Bagi rata 3 shift</button></div>}
        </div>
        <label className="pap-field"><span>Catatan khusus (opsional)</span><textarea className="pap-input" rows={2} maxLength={255} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="mis. warna khusus, prioritas kirim pagi, regu / operator" /></label>
      </form>
    </Modal>
  )
}
