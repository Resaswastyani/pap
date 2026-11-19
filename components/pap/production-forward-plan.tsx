'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock, CalendarDays, ClipboardList, Pencil, Plus, Search, Trash2, Wallet } from 'lucide-react'
import { AccurateSyncBar, formatNumber, formatRupiah } from './accurate'
import { api, formatDate, Modal, Notice, Pager, usePaged } from './ui'

// Rencana Produksi ke depan: pesanan (SO Accurate, barang "Diproduksi") dijadwalkan ke tanggal + Shift 1/2/3

type PlanShift = { id: number; tanggal: string; shift: number; quantity: number; nilai: number | null; catatan: string | null }
type PlanJob = {
  id: number; so_number: string | null; so_date: string | null; due_date: string | null; item_name: string; item_no: string | null; customer: string | null
  quantity: number; unit: string | null; unit_price: number | null; nilai: number | null; prioritas: string; so_status: string | null
  shifts: PlanShift[]; terjadwal: number
}
type PlanRes = { today: string; jobs: PlanJob[]; can: { plan: boolean } }

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
  const name = DAYS[new Date(`${ymd}T00:00:00Z`).getUTCDay()]
  return `${d === 0 ? 'Hari ini · ' : d === 1 ? 'Besok · ' : ''}${name}, ${formatDate(ymd)}`
}
// Jumlah per satuan (kg dan Pcs tidak dicampur)
const sumByUnit = (list: { quantity: number; unit: string | null }[]) => {
  const m = new Map<string, number>()
  for (const x of list) m.set(x.unit ?? '', (m.get(x.unit ?? '') ?? 0) + x.quantity)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}
const unitText = (list: { quantity: number; unit: string | null }[]) => sumByUnit(list).map(([u, v]) => qty(v, u)).join(' + ') || '—'

function DueBadge({ due, today }: { due: string | null; today: string }) {
  if (!due) return <span className="pap-muted">—</span>
  const d = dayDiff(due, today)
  return (
    <span className="pap-due">
      {formatDate(due)}
      <small className={d < 0 ? 'late' : d <= 3 ? 'soon' : ''}>{d < 0 ? `Terlambat ${-d} hari` : d === 0 ? 'Kirim hari ini' : `H-${d}`}</small>
    </span>
  )
}

export function ForwardPlanView() {
  const [data, setData] = useState<PlanRes | null>(null)
  const [error, setError] = useState('')
  const [days, setDays] = useState<number>(14)
  const [shiftFilter, setShiftFilter] = useState(0)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<PlanJob | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await api<PlanRes>('/api/production/rencana'))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const today = data?.today ?? new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
  const end = addDays(today, days - 1)
  const query = q.trim().toLowerCase()
  const jobs = useMemo(() => (data?.jobs ?? []).filter((j) => !query || [j.item_name, j.item_no, j.customer, j.so_number].some((v) => v?.toLowerCase().includes(query))), [data, query])

  // Jadwal di rentang hari ini .. +N hari, dikelompokkan per tanggal
  const scheduled = useMemo(() => jobs.flatMap((job) => job.shifts.filter((s) => s.tanggal >= today && s.tanggal <= end && (!shiftFilter || s.shift === shiftFilter)).map((s) => ({ job, s }))), [jobs, today, end, shiftFilter])
  const byDate = useMemo(() => {
    const m = new Map<string, typeof scheduled>()
    for (const x of [...scheduled].sort((a, b) => a.s.tanggal.localeCompare(b.s.tanggal) || a.s.shift - b.s.shift)) m.set(x.s.tanggal, [...(m.get(x.s.tanggal) ?? []), x])
    return [...m.entries()]
  }, [scheduled])
  // Belum (lengkap) dijadwalkan: sisa = pesanan - jadwal ke depan & yang sudah lewat
  const pending = useMemo(() => jobs.filter((j) => j.quantity - j.terjadwal > 1e-6), [jobs])
  const paged = usePaged(pending, [query, days])

  const allJobs = data?.jobs ?? []
  // Mendesak: tanggal kirim <= 3 hari lagi dan belum seluruhnya dijadwalkan
  const late = allJobs.filter((j) => j.due_date && dayDiff(j.due_date, today) <= 3 && j.quantity - j.terjadwal > 1e-6).length
  const totalValue = allJobs.reduce((a, j) => a + (j.nilai ?? 0), 0)
  const rangeValue = scheduled.reduce((a, x) => a + (x.s.nilai ?? 0), 0)
  const perShift = [1, 2, 3].map((shift) => {
    const list = jobs.flatMap((job) => job.shifts.filter((s) => s.shift === shift && s.tanggal >= today && s.tanggal <= end).map((s) => ({ quantity: s.quantity, unit: job.unit, nilai: s.nilai ?? 0 })))
    return { shift, n: list.length, text: unitText(list), nilai: list.reduce((a, x) => a + x.nilai, 0) }
  })
  const can = data?.can.plan ?? false

  const tiles: [string, string, typeof ClipboardList, string, string][] = [
    ['Pesanan perlu diproduksi', `${allJobs.length}`, ClipboardList, 'stat-1', `Nilai ${shortRupiah(totalValue)}`],
    ['Belum dijadwalkan', `${allJobs.filter((j) => j.quantity - j.terjadwal > 1e-6).length}`, AlertTriangle, late ? 'stat-2' : 'stat-0', late ? `${late} kirim ≤ 3 hari lagi` : 'Tidak ada yang mendesak'],
    [`Terjadwal ${days} hari`, unitText(scheduled.map((x) => ({ quantity: x.s.quantity, unit: x.job.unit }))), CalendarClock, 'stat-2', `${scheduled.length} jadwal shift · s.d. ${formatDate(end)}`],
    [`Nilai rencana ${days} hari`, shortRupiah(rangeValue), Wallet, 'stat-2', 'Jumlah × harga jual pesanan'],
  ]

  return (
    <>
      <AccurateSyncBar entities={['sales-order', 'sales-order-items']} canSync onSynced={load} />
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-stat-grid four">
        {tiles.map(([label, value, Icon, tone, note]) => (
          <div key={label} className="pap-stat-card">
            <div><span>{label}</span><strong className="pap-stat-text">{value}</strong><small className="neutral">{note}</small></div>
            <div className={`pap-stat-icon ${tone}`}><Icon /></div>
          </div>
        ))}
      </div>

      <div className="pap-table-card">
        <div className="pap-card-head">
          <div><h2>Jadwal produksi</h2><p>Mulai hari ini sampai {days} hari ke depan · per tanggal dan shift. Nilai = jumlah × harga jual pesanan.</p></div>
          <div className="pap-segmented" role="tablist" aria-label="Rentang hari">
            {RANGES.map((r) => <button key={r} role="tab" aria-selected={days === r} className={days === r ? 'active' : ''} onClick={() => setDays(r)}>{r} hari</button>)}
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
              <small>{s.n} jadwal · {formatRupiah(s.nilai)}</small>
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
                      <span className="pap-cell-sub">{list.length} jadwal · {unitText(list.map((x) => ({ quantity: x.s.quantity, unit: x.job.unit })))} · {formatRupiah(list.reduce((a, x) => a + (x.s.nilai ?? 0), 0))}</span>
                    </div>
                  </td>
                </tr>,
                ...list.map(({ job, s }) => (
                  <tr key={`s${s.id}`}>
                    <td><span className={`pap-shift-chip s${s.shift}`}><b>Shift {s.shift}</b></span>{s.catatan && <div className="pap-cell-sub">{s.catatan}</div>}</td>
                    <td><div className="pap-cell-title pap-plan-item">{job.item_name}</div><div className="pap-cell-sub">{job.item_no ?? ''}{job.prioritas === 'tinggi' ? ' · Prioritas tinggi' : ''}</div></td>
                    <td><div>{job.customer ?? '—'}</div><div className="pap-cell-sub">{job.so_number ?? ''}</div></td>
                    <td className="pap-num pap-nowrap"><strong>{qty(s.quantity, job.unit)}</strong><div className="pap-cell-sub">dari {qty(job.quantity, job.unit)}</div></td>
                    <td className="pap-num pap-nowrap"><strong>{formatRupiah(s.nilai)}</strong>{job.unit_price !== null && <div className="pap-cell-sub">@ {formatRupiah(job.unit_price)}</div>}</td>
                    <td className="pap-nowrap"><DueBadge due={job.due_date} today={today} /></td>
                    {can && <td><button type="button" className="pap-link-button pap-shift-edit" onClick={() => setEditing(job)}><Pencil /> Ubah</button></td>}
                  </tr>
                )),
              ])}
            </tbody>
          </table>
          {data && !byDate.length && <div className="pap-empty">Belum ada jadwal produksi dari hari ini sampai {formatDate(end)}{shiftFilter ? ` untuk Shift ${shiftFilter}` : ''}.{can ? ' Jadwalkan pesanan di daftar "Belum dijadwalkan" di bawah.' : ''}</div>}
          {!data && !error && <div className="pap-empty">Memuat rencana produksi...</div>}
        </div>
      </div>

      <div className="pap-table-card pap-plan-pending">
        <div className="pap-card-head">
          <div><h2>Belum dijadwalkan</h2><p>Pesanan Accurate (barang diproduksi) dengan tanggal kirim mulai hari ini yang belum seluruhnya punya jadwal. Urut tanggal kirim terdekat.</p></div>
        </div>
        <div className="pap-table-wrap">
          <table className="pap-plan-table">
            <thead><tr><th>Produk</th><th>Customer / SO</th><th>Tanggal kirim</th><th className="pap-num">Pesanan</th><th className="pap-num">Belum dijadwalkan</th><th className="pap-num">Nilai pesanan</th>{can && <th aria-label="Aksi" />}</tr></thead>
            <tbody>
              {paged.items.map((job) => (
                <tr key={job.id}>
                  <td><div className="pap-cell-title pap-plan-item">{job.item_name}</div><div className="pap-cell-sub">{job.item_no ?? ''}{job.prioritas === 'tinggi' ? ' · Prioritas tinggi' : ''}</div></td>
                  <td><div>{job.customer ?? '—'}</div><div className="pap-cell-sub">{job.so_number ?? ''}{job.so_date ? ` · ${formatDate(job.so_date)}` : ''}</div></td>
                  <td className="pap-nowrap"><DueBadge due={job.due_date} today={today} /></td>
                  <td className="pap-num pap-nowrap">{qty(job.quantity, job.unit)}</td>
                  <td className="pap-num pap-nowrap"><strong>{qty(job.quantity - job.terjadwal, job.unit)}</strong>{job.terjadwal > 0 && <div className="pap-cell-sub">{qty(job.terjadwal, job.unit)} terjadwal</div>}</td>
                  <td className="pap-num pap-nowrap">{formatRupiah(job.nilai)}</td>
                  {can && <td><button type="button" className="pap-primary-button pap-plan-btn" onClick={() => setEditing(job)}><CalendarClock /> Jadwalkan</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
          {data && !pending.length && <div className="pap-empty">{query ? 'Tidak ada pesanan yang cocok.' : 'Tidak ada pesanan dengan tanggal kirim mulai hari ini yang belum dijadwalkan.'}</div>}
          <Pager {...paged.pager} noun="pesanan" />
        </div>
      </div>
      {editing && <JobPlanModal job={editing} today={today} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
    </>
  )
}

type Draft = { tanggal: string; shift: string; quantity: string; catatan: string }
const toNum = (v: string) => (v.trim() === '' ? 0 : Number(v.replace(',', '.')) || 0)
const round2 = (v: number) => Math.round(v * 100) / 100

// Form jadwal satu pesanan: tanggal produksi, shift yang mengerjakan, jumlah, regu/catatan
function JobPlanModal({ job, today, onClose, onSaved }: { job: PlanJob; today: string; onClose: () => void; onSaved: () => void }) {
  const unit = job.unit ?? ''
  const [rows, setRows] = useState<Draft[]>(() =>
    job.shifts.length
      ? job.shifts.map((s) => ({ tanggal: s.tanggal, shift: String(s.shift), quantity: String(s.quantity), catatan: s.catatan ?? '' }))
      : [{ tanggal: today, shift: '1', quantity: String(round2(job.quantity)), catatan: '' }],
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const update = (i: number, patch: Partial<Draft>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const total = rows.reduce((a, r) => a + toNum(r.quantity), 0)
  const sisa = job.quantity - total
  const nilai = job.unit_price === null ? null : total * job.unit_price
  const afterDue = job.due_date ? rows.some((r) => r.tanggal > job.due_date!) : false

  function splitEven() {
    const tanggal = rows[0]?.tanggal && rows[0].tanggal >= today ? rows[0].tanggal : today
    const part = Math.floor((job.quantity / 3) * 100) / 100
    setRows([1, 2, 3].map((s) => ({ tanggal, shift: String(s), quantity: String(s === 3 ? round2(job.quantity - part * 2) : part), catatan: '' })))
  }
  function addRow() {
    const last = rows[rows.length - 1]
    const next = last ? (Number(last.shift) < 3 ? { tanggal: last.tanggal, shift: String(Number(last.shift) + 1) } : { tanggal: addDays(last.tanggal, 1), shift: '1' }) : { tanggal: today, shift: '1' }
    setRows([...rows, { ...next, quantity: sisa > 0 ? String(round2(sisa)) : '', catatan: '' }])
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api(`/api/production/rencana/${job.id}`, { method: 'PUT', json: { rows: rows.map((r) => ({ tanggal: r.tanggal, shift: Number(r.shift), quantity: toNum(r.quantity), catatan: r.catatan })) } })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal title="Jadwalkan produksi" subtitle={`${job.so_number ?? ''} · ${job.item_name}`} wide onClose={onClose}
      footer={<>
        <div className="pap-shift-total">
          <span>Dijadwalkan <b>{qty(total, unit)}</b> dari {qty(job.quantity, unit)}{sisa > 1e-6 ? ` · sisa ${qty(sisa, unit)}` : sisa < -1e-6 ? ` · lebih ${qty(-sisa, unit)}` : ''}</span>
          <span>Nilai <b>{formatRupiah(nilai)}</b></span>
        </div>
        <span className="pap-spacer" />
        <button type="button" className="pap-btn" onClick={onClose}>Batal</button>
        <button className="pap-primary-button" form="pap-plan-form" disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan jadwal'}</button>
      </>}>
      <form id="pap-plan-form" className="pap-shift-form" onSubmit={save}>
        {error && <Notice onClose={() => setError('')}>{error}</Notice>}
        <div className="pap-shift-info">
          <span>Customer <b>{job.customer ?? '—'}</b></span>
          <span>Pesanan <b>{qty(job.quantity, unit)}</b></span>
          <span>Tanggal kirim <b>{job.due_date ? formatDate(job.due_date) : '—'}</b></span>
          <span>Harga jual <b>{job.unit_price !== null ? `${formatRupiah(job.unit_price)}/${unit || 'satuan'}` : '—'}</b></span>
        </div>
        {afterDue && <Notice kind="error">Ada jadwal setelah tanggal kirim {formatDate(job.due_date)}. Pastikan pengiriman masih terkejar.</Notice>}
        <div className="pap-shift-rows">
          {rows.map((r, i) => (
            <div key={i} className="pap-shift-row pap-plan-row">
              <label><span>Tanggal produksi *</span><input className="pap-input" type="date" required min={job.shifts.some((s) => s.tanggal === r.tanggal) ? undefined : today} value={r.tanggal} onChange={(e) => update(i, { tanggal: e.target.value })} /></label>
              <label><span>Shift *</span>
                <select className="pap-select" value={r.shift} onChange={(e) => update(i, { shift: e.target.value })}>
                  <option value="1">Shift 1</option><option value="2">Shift 2</option><option value="3">Shift 3</option>
                </select>
              </label>
              <label><span>Jumlah{unit ? ` (${unit})` : ''} *</span><input className="pap-input" inputMode="decimal" required value={r.quantity} onChange={(e) => update(i, { quantity: e.target.value.replace(/[^\d.,]/g, '') })} placeholder="0" /></label>
              <label className="pap-shift-note"><span>Regu / operator / mesin</span><input className="pap-input" maxLength={255} value={r.catatan} onChange={(e) => update(i, { catatan: e.target.value })} placeholder="opsional" /></label>
              <div className="pap-shift-row-end">
                <span className="pap-shift-row-value">{job.unit_price !== null ? formatRupiah(toNum(r.quantity) * job.unit_price) : '—'}</span>
                <button type="button" className="pap-icon-button" aria-label={`Hapus baris ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 /></button>
              </div>
            </div>
          ))}
          {!rows.length && <p className="pap-muted">Tidak ada jadwal. Simpan untuk mengosongkan jadwal pesanan ini.</p>}
        </div>
        <div className="pap-inline-actions">
          <button type="button" className="pap-btn" onClick={addRow} disabled={rows.length >= 60}><Plus /> Tambah jadwal</button>
          <button type="button" className="pap-btn" onClick={splitEven}>Bagi rata 3 shift</button>
        </div>
      </form>
    </Modal>
  )
}
