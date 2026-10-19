'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, CalendarClock, ChevronLeft, ChevronRight, ClipboardList, Cog, ExternalLink, Factory, FileText, Flag, List, Loader2, Plus, Printer, Search, Trash2 } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { AccurateSyncBar, formatNumber } from './accurate'
import { AttachmentPanel } from './attachments'
import { api, formatDate, Modal, Notice, Progress, type UserOption } from './ui'

type JobStatus = 'menunggu' | 'dijadwalkan' | 'berjalan' | 'selesai' | 'batal'
type StageStatus = 'belum' | 'berjalan' | 'selesai' | 'dilewati'
type Job = {
  id: number
  nomor: string
  so_number: string | null
  so_date: string | null
  customer_id: number | null
  customer_name: string | null
  product_id: number | null
  item_name: string
  quantity: number | null
  unit: string | null
  due_date: string | null
  status: JobStatus
  prioritas: 'normal' | 'tinggi'
  catatan: string | null
  stage_count: number
  stage_done: number
  progress: number
  current_stage: string | null
  plan_start: string | null
  plan_end: string | null
}
type Stage = {
  id: number
  urutan: number
  tahap: string
  machine_id: number | null
  machine_name: string | null
  plan_start: string | null
  plan_end: string | null
  actual_start: string | null
  actual_end: string | null
  status: StageStatus
  progress: number
  pic_user_id: number | null
  pic_name: string | null
  catatan: string | null
  updated_by_name: string | null
}
type Machine = { id: number; kode: string; nama: string; tahap: string; status: string }
type ProductInfo = { id: number; nama: string; kode: string | null; jenis: string | null; spesifikasi: string | null; bahan: string | null; keterangan: string | null }
type ProductFile = { id: number; name: string; mime: string }
type Summary = { menunggu: number; dijadwalkan: number; berjalan: number; terlambat: number; selesai_minggu: number }

export const JOB_LABEL: Record<JobStatus, string> = { menunggu: 'Menunggu dijadwalkan', dijadwalkan: 'Dijadwalkan', berjalan: 'Berjalan', selesai: 'Selesai', batal: 'Batal' }
const JOB_TONE: Record<JobStatus, string> = { menunggu: 'warning', dijadwalkan: 'info', berjalan: 'info', selesai: 'success', batal: 'neutral' }
const STAGE_LABEL: Record<StageStatus, string> = { belum: 'Belum mulai', berjalan: 'Berjalan', selesai: 'Selesai', dilewati: 'Dilewati' }
const STAGE_TONE: Record<StageStatus, string> = { belum: 'neutral', berjalan: 'info', selesai: 'success', dilewati: 'neutral' }
const STAGES = ['Blow', 'Cetak', 'Bag making', 'Lainnya']

export const JobBadge = ({ value }: { value: JobStatus }) => <span className={`pap-status ${JOB_TONE[value]}`}>{JOB_LABEL[value]}</span>
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
const isLate = (job: Pick<Job, 'due_date' | 'status'>) => !!job.due_date && job.due_date < today() && !['selesai', 'batal'].includes(job.status)
const toInput = (v: string | null) => (v ? v.slice(0, 16).replace(' ', 'T') : '')
const qty = (q: number | null, unit: string | null) => (q === null ? '—' : `${formatNumber(q)} ${unit ?? ''}`)

export function ProductionPage({ user, focusId }: { user: UserProfile; focusId?: number | null }) {
  const [view, setView] = useState<'list' | 'machine'>('list')
  const [items, setItems] = useState<Job[]>([])
  const [summary, setSummary] = useState<Summary>({ menunggu: 0, dijadwalkan: 0, berjalan: 0, terlambat: 0, selesai_minggu: 0 })
  const [can, setCan] = useState({ manage: false, progress: false })
  const [maxAge, setMaxAge] = useState(30)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [status, setStatus] = useState('aktif')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [detailId, setDetailId] = useState<number | null>(focusId ?? null)
  const [reloadKey, setReloadKey] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page) })
      if (status) params.set('status', status)
      if (q.trim()) params.set('q', q.trim())
      const res = await api<{ items: Job[]; summary: Summary; total: number; pageSize: number; maxAgeDays: number; can: typeof can }>(`/api/production?${params}`)
      setItems(res.items)
      setSummary(res.summary)
      setTotal(res.total)
      setPageSize(res.pageSize)
      setMaxAge(res.maxAgeDays)
      setCan(res.can)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [page, status, q])
  useEffect(() => {
    const timer = setTimeout(load, q ? 300 : 0)
    return () => clearTimeout(timer)
  }, [load, q])
  useEffect(() => setPage(1), [status, q])

  const reloadAll = () => {
    load()
    setReloadKey((k) => k + 1)
  }
  const stats: [string, number, string, string, typeof Factory, string][] = [
    ['menunggu', summary.menunggu, 'Menunggu dijadwalkan', 'Pesanan baru dari Accurate', ClipboardList, 'stat-2'],
    ['dijadwalkan', summary.dijadwalkan, 'Dijadwalkan', 'Mesin & tanggal sudah diatur', CalendarClock, 'stat-1'],
    ['berjalan', summary.berjalan, 'Sedang diproduksi', `${summary.selesai_minggu} selesai 7 hari terakhir`, Factory, 'stat-0'],
    ['terlambat', summary.terlambat, 'Lewat tanggal kirim', 'Belum selesai, perlu perhatian', AlertTriangle, 'stat-2'],
  ]
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">PRODUKSI</p>
          <h1>Jadwal Produksi</h1>
          <span>Otomatis dari Sales Order Accurate berisi barang bertanda “Diproduksi”. Kepala PPIC / GM mengatur tahap & mesin, Produksi meng-update progress.</span>
        </div>
      </div>
      <AccurateSyncBar entities={['sales-order', 'sales-order-items', 'item-detail']} canSync={can.manage || user.role.isAdmin} onSynced={reloadAll} />
      <div className="pap-stat-grid four">
        {stats.map(([key, value, label, note, Icon, tone]) => (
          <button key={key} className={`pap-stat-card pap-stat-button ${status === key ? 'active' : ''}`} onClick={() => { setView('list'); setStatus((s) => (s === key ? 'aktif' : key)) }}>
            <div><span>{label}</span><strong>{value}</strong><small className="neutral">{note}</small></div>
            <div className={`pap-stat-icon ${tone}`}><Icon /></div>
          </button>
        ))}
      </div>
      <div className="pap-table-card">
        <div className="pap-card-head">
          <div>
            <h2>{view === 'list' ? 'Daftar job produksi' : 'Jadwal per mesin'}</h2>
            <p>{view === 'list' ? `Dari SO belum selesai dalam ${maxAge} hari terakhir & SO baru. Diurutkan dari tanggal kirim terdekat.` : 'Tahap produksi yang dijadwalkan per mesin dalam seminggu.'}</p>
          </div>
          <div className="pap-segmented" role="tablist" aria-label="Tampilan jadwal">
            <button role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}><List /> Daftar job</button>
            <button role="tab" aria-selected={view === 'machine'} className={view === 'machine' ? 'active' : ''} onClick={() => setView('machine')}><Cog /> Per mesin</button>
          </div>
        </div>
        {view === 'machine' ? (
          <MachineSchedule key={reloadKey} onOpen={setDetailId} />
        ) : (
          <>
            <div className="pap-filters">
              <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari produk, customer, no. SO / job..." /></label>
              <select className="pap-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter status">
                <option value="aktif">Belum selesai</option>
                <option value="terlambat">Terlambat</option>
                {Object.entries(JOB_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                <option value="">Semua</option>
              </select>
            </div>
            {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
            <div className="pap-table-wrap">
              <table>
                <thead><tr><th>Produk / Customer</th><th>Job / SO</th><th className="pap-num">Jumlah</th><th>Tgl kirim</th><th>Tahap</th><th>Status</th></tr></thead>
                <tbody>
                  {items.map((job) => (
                    <tr key={job.id} className="pap-row-link" onClick={() => setDetailId(job.id)}>
                      <td><div className="pap-cell-title">{job.prioritas === 'tinggi' && <Flag className="pap-inline-icon pap-flag" />}{job.item_name}</div><div className="pap-cell-sub">{job.customer_name ?? '—'}</div></td>
                      <td className="pap-nowrap"><div className="pap-cell-sub">{job.nomor}</div><div className="pap-cell-sub">{job.so_number}</div></td>
                      <td className="pap-num pap-nowrap">{qty(job.quantity, job.unit)}</td>
                      <td className="pap-nowrap">{formatDate(job.due_date)}{isLate(job) && <div><span className="pap-status danger">Terlambat</span></div>}</td>
                      <td><div className="pap-cell-sub">{job.current_stage ?? (job.status === 'selesai' ? 'Semua tahap selesai' : '—')}</div><Progress value={job.progress} /></td>
                      <td><JobBadge value={job.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!loading && !items.length && <div className="pap-empty">{q || status !== 'aktif' ? 'Tidak ada job yang cocok dengan filter.' : 'Belum ada job produksi. Job dibuat otomatis dari Sales Order berisi barang “Diproduksi”.'}</div>}
              {loading && !items.length && <div className="pap-empty">Memuat jadwal produksi...</div>}
            </div>
            {total > pageSize && (
              <div className="pap-pager">
                <span>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} dari {total}</span>
                <button className="pap-icon-button" aria-label="Sebelumnya" disabled={page <= 1} onClick={() => setPage((v) => v - 1)}><ChevronLeft /></button>
                <button className="pap-icon-button" aria-label="Berikutnya" disabled={page >= pageCount} onClick={() => setPage((v) => v + 1)}><ChevronRight /></button>
              </div>
            )}
          </>
        )}
      </div>
      {detailId && <JobDetail id={detailId} user={user} onClose={() => setDetailId(null)} onChanged={reloadAll} />}
    </>
  )
}

// ---------- Jadwal per mesin (mingguan) ----------
type ScheduleStage = { id: number; job_id: number; tahap: string; machine_id: number | null; plan_start: string; plan_end: string | null; status: StageStatus; progress: number; nomor: string; item_name: string; customer_name: string | null; prioritas: string }
const DAY = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']
const ymd = (d: Date) => d.toISOString().slice(0, 10)
function mondayOf(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d
}

function MachineSchedule({ onOpen }: { onOpen: (jobId: number) => void }) {
  const [start, setStart] = useState(() => mondayOf(today()))
  const [machines, setMachines] = useState<Machine[]>([])
  const [stages, setStages] = useState<ScheduleStage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * 864e5)), [start])

  useEffect(() => {
    setLoading(true)
    const to = new Date(start.getTime() + 7 * 864e5)
    api<{ machines: Machine[]; stages: ScheduleStage[] }>(`/api/production/schedule?from=${ymd(start)}&to=${ymd(to)}`)
      .then((res) => {
        setMachines(res.machines)
        setStages(res.stages)
        setError('')
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [start])

  // Tahap tampil di setiap hari yang dicakup rentang rencananya
  const cell = (machineId: number | null, day: string) =>
    stages.filter((s) => s.machine_id === machineId && s.plan_start.slice(0, 10) <= day && (s.plan_end ?? s.plan_start).slice(0, 10) >= day)
  const rows: (Machine | null)[] = [...machines, ...(stages.some((s) => !s.machine_id) ? [null] : [])]
  const shift = (n: number) => setStart((d) => new Date(d.getTime() + n * 7 * 864e5))
  const now = today()

  return (
    <div className="pap-machine-schedule">
      <div className="pap-calendar-bar">
        <div className="pap-calendar-nav">
          <button className="pap-icon-button" aria-label="Minggu sebelumnya" onClick={() => shift(-1)}><ChevronLeft /></button>
          <button className="pap-icon-button" aria-label="Minggu berikutnya" onClick={() => shift(1)}><ChevronRight /></button>
          <h3>{formatDate(ymd(days[0]))} – {formatDate(ymd(days[6]))}</h3>
        </div>
        <button className="pap-btn" onClick={() => setStart(mondayOf(today()))}>Minggu ini</button>
      </div>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {!loading && !machines.length && <div className="pap-empty">Belum ada data mesin. Tambahkan di menu Data Mesin agar tahap produksi bisa dijadwalkan per mesin.</div>}
      {machines.length > 0 && (
        <div className={`pap-gantt ${loading ? 'loading' : ''}`}>
          <div className="pap-gantt-head">Mesin</div>
          {days.map((d) => <div key={ymd(d)} className={`pap-gantt-head ${ymd(d) === now ? 'today' : ''}`}>{DAY[d.getUTCDay()]} {d.getUTCDate()}</div>)}
          {rows.map((m) => (
            <div key={m?.id ?? 'none'} className="pap-gantt-row">
              <div className="pap-gantt-machine"><strong>{m ? m.nama : 'Tanpa mesin'}</strong><small>{m ? `${m.kode} · ${m.tahap}${m.status === 'maintenance' ? ' · maintenance' : ''}` : 'Belum dipilih mesinnya'}</small></div>
              {days.map((d) => (
                <div key={ymd(d)} className={`pap-gantt-cell ${ymd(d) === now ? 'today' : ''}`}>
                  {cell(m?.id ?? null, ymd(d)).map((s) => (
                    <button key={s.id} className={`pap-gantt-chip ${s.status} ${s.prioritas === 'tinggi' ? 'priority' : ''}`} onClick={() => onOpen(s.job_id)} title={`${s.nomor} · ${s.tahap} · ${s.item_name} · ${s.customer_name ?? ''}`}>
                      <b>{s.tahap}</b> {s.item_name}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- Detail job ----------
type EditableStage = { key: string; id?: number; tahap: string; machine_id: string; plan_start: string; plan_end: string; pic_user_id: string; catatan: string }
const toEditable = (s: Stage): EditableStage => ({ key: String(s.id), id: s.id, tahap: s.tahap, machine_id: s.machine_id ? String(s.machine_id) : '', plan_start: toInput(s.plan_start), plan_end: toInput(s.plan_end), pic_user_id: s.pic_user_id ? String(s.pic_user_id) : '', catatan: s.catatan ?? '' })

const esc = (value: string | null | undefined) => (value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

// Surat Perintah Kerja (SPK) siap cetak: data job, tahap, spesifikasi produk
function printSpk(job: Job, stages: Stage[], product: ProductInfo | null) {
  const win = window.open('', '_blank')
  if (!win) return
  const block = (title: string, value: string | null | undefined) => `<h3>${title}</h3><div class="box">${value ? esc(value).replace(/\n/g, '<br>') : '<i>—</i>'}</div>`
  win.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8"><title>SPK ${esc(job.nomor)}</title>
<style>body{font:12.5px/1.5 system-ui,sans-serif;color:#111;margin:28px}h1{margin:0;font-size:19px}h3{margin:16px 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#555}
.head{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:10px}.head img{height:42px}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:6px 20px;margin-top:12px}
.meta span{display:block;color:#666;font-size:10.5px}.box{padding:9px 11px;border:1px solid #bbb;border-radius:6px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:6px 8px;text-align:left;font-size:12px}
th{background:#f2f2f2}.sign{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:36px;text-align:center}.sign div{padding-top:48px;border-bottom:1px solid #111}@media print{body{margin:10mm}}</style></head><body>
<div class="head"><div><h1>SURAT PERINTAH KERJA</h1><div>${esc(job.nomor)} · ${esc(job.so_number)}</div></div><img src="/logo-pap.png" alt=""></div>
<div class="meta"><div><span>Produk</span><b>${esc(job.item_name)}</b></div><div><span>Customer</span>${esc(job.customer_name) || '—'}</div><div><span>Jumlah</span><b>${esc(qty(job.quantity, job.unit))}</b></div>
<div><span>Tanggal SO</span>${esc(formatDate(job.so_date))}</div><div><span>Tanggal kirim</span><b>${esc(formatDate(job.due_date))}</b></div><div><span>Prioritas</span>${job.prioritas === 'tinggi' ? '<b>TINGGI</b>' : 'Normal'}</div></div>
<h3>Tahap produksi</h3><table><tr><th>#</th><th>Tahap</th><th>Mesin</th><th>Rencana mulai</th><th>Rencana selesai</th><th>PIC</th><th>Paraf</th></tr>
${stages.filter((s) => s.status !== 'dilewati').map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.tahap)}</td><td>${esc(s.machine_name) || '—'}</td><td>${esc(formatDate(s.plan_start, true))}</td><td>${esc(formatDate(s.plan_end, true))}</td><td>${esc(s.pic_name) || '—'}</td><td></td></tr>`).join('')}</table>
${block('Spesifikasi', product?.spesifikasi)}${block('Keterangan bahan', product?.bahan)}${block('Catatan PPIC', job.catatan)}
<div class="sign"><div>PPIC</div><div>Kepala Produksi</div><div>QC</div></div>
<p style="margin-top:18px;color:#777;font-size:10.5px">Dicetak dari PAP-MS · ${esc(new Date().toLocaleString('id-ID'))}</p>
<script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`)
  win.document.close()
}

function JobDetail({ id, user, onClose, onChanged }: { id: number; user: UserProfile; onClose: () => void; onChanged: () => void }) {
  const [job, setJob] = useState<Job | null>(null)
  const [stages, setStages] = useState<Stage[]>([])
  const [product, setProduct] = useState<ProductInfo | null>(null)
  const [files, setFiles] = useState<ProductFile[]>([])
  const [stock, setStock] = useState<{ qty: number | null; unit: string | null } | null>(null)
  const [can, setCan] = useState({ manage: false, progress: false })
  const [machines, setMachines] = useState<Machine[]>([])
  const [users, setUsers] = useState<UserOption[]>([])
  const [editing, setEditing] = useState<EditableStage[] | null>(null)
  const [catatan, setCatatan] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await api<{ item: Job; stages: Stage[]; product: ProductInfo | null; files: ProductFile[]; stock: typeof stock; can: typeof can }>(`/api/production/${id}`)
      setJob(res.item)
      setStages(res.stages)
      setProduct(res.product)
      setFiles(res.files)
      setStock(res.stock)
      setCan(res.can)
      setCatatan(res.item.catatan ?? '')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [id])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!can.manage) return
    api<{ items: Machine[] }>('/api/machines').then((res) => setMachines(res.items.filter((m) => m.status !== 'nonaktif'))).catch(() => {})
    api<{ items: UserOption[] }>('/api/users/options').then((res) => setUsers(res.items)).catch(() => {})
  }, [can.manage])

  async function run(action: () => Promise<unknown>, text?: string) {
    setBusy(true)
    setError('')
    try {
      await action()
      await load()
      onChanged()
      if (text) {
        setMessage(text)
        setTimeout(() => setMessage(''), 4000)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!job) return <Modal title="Detail job produksi" onClose={onClose}>{error ? <Notice>{error}</Notice> : <p className="pap-muted">Memuat...</p>}</Modal>

  const setRow = (index: number, key: keyof EditableStage, value: string) => setEditing((rows) => rows!.map((r, i) => (i === index ? { ...r, [key]: value } : r)))
  const move = (index: number, delta: number) => setEditing((rows) => {
    const next = [...rows!]
    const [row] = next.splice(index, 1)
    next.splice(index + delta, 0, row)
    return next
  })
  const saveSchedule = () => run(async () => {
    await api(`/api/production/${job.id}/stages`, {
      method: 'PUT',
      json: { stages: editing!.map((s) => ({ id: s.id, tahap: s.tahap, machine_id: s.machine_id || null, plan_start: s.plan_start || null, plan_end: s.plan_end || null, pic_user_id: s.pic_user_id || null, catatan: s.catatan })) },
    })
    setEditing(null)
  }, 'Jadwal tahap disimpan.')

  return (
    <Modal
      wide
      title={job.item_name}
      subtitle={`${job.nomor} · ${job.so_number ?? ''}${job.customer_name ? ` · ${job.customer_name}` : ''}`}
      onClose={onClose}
      footer={
        <>
          {can.manage && (job.status === 'batal'
            ? <button className="pap-btn" disabled={busy} onClick={() => run(() => api(`/api/production/${job.id}`, { method: 'PATCH', json: { batal: false } }), 'Job diaktifkan kembali.')}>Aktifkan lagi</button>
            : <button className="pap-btn danger" disabled={busy} onClick={() => window.confirm('Batalkan job produksi ini?') && run(() => api(`/api/production/${job.id}`, { method: 'PATCH', json: { batal: true } }), 'Job dibatalkan.')}><Trash2 /> Batalkan</button>)}
          <span className="pap-spacer" />
          {can.manage && <button className="pap-btn" disabled={busy} onClick={() => run(() => api(`/api/production/${job.id}`, { method: 'PATCH', json: { prioritas: job.prioritas === 'tinggi' ? 'normal' : 'tinggi' } }))}><Flag /> {job.prioritas === 'tinggi' ? 'Prioritas normal' : 'Prioritas tinggi'}</button>}
          <button className="pap-btn" onClick={() => printSpk(job, stages, product)}><Printer /> Cetak SPK</button>
        </>
      }
    >
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      <div className="pap-detail-badges">
        <JobBadge value={job.status} />
        {job.prioritas === 'tinggi' && <span className="pap-status danger">Prioritas tinggi</span>}
        {isLate(job) && <span className="pap-status danger">Lewat tanggal kirim</span>}
      </div>
      <dl className="pap-detail-grid">
        <div><dt>Jumlah pesanan</dt><dd><strong>{qty(job.quantity, job.unit)}</strong></dd></div>
        <div><dt>Tanggal kirim</dt><dd>{formatDate(job.due_date)}</dd></div>
        <div><dt>Sales Order</dt><dd>{job.so_number} · {formatDate(job.so_date)}</dd></div>
        <div><dt>Stok barang jadi saat ini</dt><dd>{stock ? qty(stock.qty, stock.unit) : '—'}</dd></div>
      </dl>

      <section className="pap-detail-section">
        <div className="pap-section-head">
          <h3>Tahap produksi</h3>
          {can.manage && !editing && job.status !== 'batal' && <button className="pap-btn" onClick={() => setEditing(stages.map(toEditable))}><CalendarClock /> Atur jadwal & mesin</button>}
        </div>
        {editing ? (
          <div className="pap-stage-editor">
            {editing.map((s, index) => (
              <div key={s.key} className="pap-stage-edit">
                <div className="pap-stage-edit-head">
                  <span className="pap-stage-no">{index + 1}</span>
                  <input className="pap-input" list="pap-stage-names" value={s.tahap} onChange={(e) => setRow(index, 'tahap', e.target.value)} placeholder="Tahap" aria-label="Nama tahap" />
                  <button className="pap-icon-button" aria-label="Naik" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp /></button>
                  <button className="pap-icon-button" aria-label="Turun" disabled={index === editing.length - 1} onClick={() => move(index, 1)}><ArrowDown /></button>
                  <button className="pap-icon-button" aria-label="Hapus tahap" disabled={editing.length === 1} onClick={() => setEditing((rows) => rows!.filter((_, i) => i !== index))}><Trash2 /></button>
                </div>
                <div className="pap-stage-edit-grid">
                  <label>Mesin
                    <select className="pap-select" value={s.machine_id} onChange={(e) => setRow(index, 'machine_id', e.target.value)}>
                      <option value="">— Pilih mesin —</option>
                      {machines.filter((m) => m.tahap === s.tahap).map((m) => <option key={m.id} value={m.id}>{m.nama} ({m.kode}){m.status === 'maintenance' ? ' · maintenance' : ''}</option>)}
                      {machines.filter((m) => m.tahap !== s.tahap).length > 0 && <optgroup label="Mesin tahap lain">{machines.filter((m) => m.tahap !== s.tahap).map((m) => <option key={m.id} value={m.id}>{m.nama} ({m.tahap})</option>)}</optgroup>}
                    </select>
                  </label>
                  <label>Rencana mulai<input className="pap-input" type="datetime-local" value={s.plan_start} onChange={(e) => setRow(index, 'plan_start', e.target.value)} /></label>
                  <label>Rencana selesai<input className="pap-input" type="datetime-local" min={s.plan_start} value={s.plan_end} onChange={(e) => setRow(index, 'plan_end', e.target.value)} /></label>
                  <label>PIC
                    <select className="pap-select" value={s.pic_user_id} onChange={(e) => setRow(index, 'pic_user_id', e.target.value)}>
                      <option value="">— Pilih PIC —</option>
                      {users.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.division_name}</option>)}
                    </select>
                  </label>
                  <label className="full">Catatan tahap<input className="pap-input" maxLength={1000} value={s.catatan} onChange={(e) => setRow(index, 'catatan', e.target.value)} placeholder="Instruksi khusus, warna tinta, ukuran potong, dll." /></label>
                </div>
              </div>
            ))}
            <datalist id="pap-stage-names">{STAGES.map((t) => <option key={t} value={t} />)}</datalist>
            {!machines.length && <p className="pap-hint">Belum ada data mesin. Tambahkan di menu Data Mesin.</p>}
            <div className="pap-inline-actions">
              <button className="pap-btn" onClick={() => setEditing((rows) => [...rows!, { key: `new-${Date.now()}`, tahap: 'Lainnya', machine_id: '', plan_start: '', plan_end: '', pic_user_id: '', catatan: '' }])}><Plus /> Tambah tahap</button>
              <span className="pap-spacer" />
              <button className="pap-btn" onClick={() => setEditing(null)}>Batal</button>
              <button className="pap-primary-button" disabled={busy} onClick={saveSchedule}>{busy ? <Loader2 className="pap-spin" /> : null} Simpan jadwal</button>
            </div>
          </div>
        ) : (
          <ol className="pap-stage-list">
            {stages.map((s) => <StageRow key={`${s.id}-${s.status}-${s.progress}`} stage={s} user={user} canProgress={can.progress && job.status !== 'batal'} busy={busy} run={run} />)}
          </ol>
        )}
      </section>

      <section className="pap-detail-section">
        <h3>Spesifikasi produk</h3>
        {product ? (
          <div className="pap-spec-grid">
            <div><span>Spesifikasi</span><p className="pap-prewrap">{product.spesifikasi || <span className="pap-muted">Belum diisi Marketing / PPIC.</span>}</p></div>
            <div><span>Keterangan bahan</span><p className="pap-prewrap">{product.bahan || <span className="pap-muted">Belum diisi.</span>}</p></div>
          </div>
        ) : <p className="pap-muted">Produk belum terhubung ke Data Produk.</p>}
        {files.length > 0 && (
          <ul className="pap-file-list">
            {files.map((f) => (
              <li key={f.id}>
                <FileText />
                <div><a href={`/api/products/files/${f.id}`} target="_blank" rel="noopener noreferrer">{f.name} <ExternalLink className="pap-inline-icon" /></a><span>Desain · klik untuk lihat & cetak</span></div>
                <a className="pap-icon-button" href={`/api/products/files/${f.id}`} target="_blank" rel="noopener noreferrer" aria-label={`Cetak ${f.name}`}><Printer /></a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="pap-detail-section">
        <h3>Catatan PPIC</h3>
        {can.manage ? (
          <div className="pap-result-editor">
            <textarea className="pap-input" rows={3} maxLength={5000} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Catatan untuk produksi, bahan yang perlu disiapkan Purchasing, dll." />
            <div className="pap-inline-actions"><span className="pap-spacer" /><button className="pap-primary-button" disabled={busy || catatan === (job.catatan ?? '')} onClick={() => run(() => api(`/api/production/${job.id}`, { method: 'PATCH', json: { catatan } }), 'Catatan disimpan.')}>Simpan catatan</button></div>
          </div>
        ) : <p className="pap-prewrap">{job.catatan || <span className="pap-muted">Tidak ada catatan.</span>}</p>}
      </section>
      <AttachmentPanel title="Lampiran catatan PPIC" basePath={`/api/notes/job/${job.id}/attachments`} fileBase="/api/notes/attachments" canAdd={can.manage} currentUserId={user.id} isAdmin={user.role.isAdmin} />
    </Modal>
  )
}

function StageRow({ stage, user, canProgress, busy, run }: { stage: Stage; user: UserProfile; canProgress: boolean; busy: boolean; run: (action: () => Promise<unknown>, text?: string) => Promise<void> }) {
  const [progress, setProgress] = useState(stage.progress)
  const [status, setStatus] = useState<StageStatus>(stage.status)
  const [catatan, setCatatan] = useState(stage.catatan ?? '')
  const changed = progress !== stage.progress || status !== stage.status || catatan !== (stage.catatan ?? '')
  return (
    <li className={`pap-stage ${stage.status}`}>
      <div className="pap-stage-top">
        <span className="pap-stage-no">{stage.urutan}</span>
        <div className="pap-stage-main">
          <strong>{stage.tahap}</strong>
          <small>{stage.machine_name ?? 'Mesin belum dipilih'} · {stage.plan_start ? `${formatDate(stage.plan_start, true)} – ${formatDate(stage.plan_end, true)}` : 'Belum dijadwalkan'}{stage.pic_name ? ` · PIC ${stage.pic_name}` : ''}</small>
          {(stage.actual_start || stage.actual_end) && <small>Aktual: {formatDate(stage.actual_start, true)}{stage.actual_end ? ` – ${formatDate(stage.actual_end, true)}` : ' – sekarang'}</small>}
        </div>
        <span className={`pap-status ${STAGE_TONE[stage.status]}`}>{STAGE_LABEL[stage.status]}</span>
      </div>
      {canProgress ? (
        <div className="pap-stage-progress">
          <input type="range" min={0} max={100} step={5} value={progress} onChange={(e) => {
            const v = Number(e.target.value)
            setProgress(v)
            setStatus(v >= 100 ? 'selesai' : v > 0 ? 'berjalan' : status === 'dilewati' ? 'dilewati' : 'belum')
          }} aria-label={`Progress ${stage.tahap}`} />
          <span className="pap-stage-pct">{progress}%</span>
          <select className="pap-select" value={status} onChange={(e) => {
            const v = e.target.value as StageStatus
            setStatus(v)
            if (v === 'selesai') setProgress(100)
          }} aria-label={`Status ${stage.tahap}`}>
            {Object.entries(STAGE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <input className="pap-input" value={catatan} maxLength={1000} onChange={(e) => setCatatan(e.target.value)} placeholder="Catatan produksi" aria-label={`Catatan ${stage.tahap}`} />
          <button className="pap-primary-button" disabled={busy || !changed} onClick={() => run(() => api(`/api/production/stages/${stage.id}`, { method: 'PATCH', json: { progress, status, catatan } }), `Progress ${stage.tahap} disimpan.`)}>Simpan</button>
        </div>
      ) : (
        <>
          <Progress value={stage.progress} />
          {stage.catatan && <p className="pap-hint">{stage.catatan}</p>}
        </>
      )}
      <div className="pap-stage-attach">
        <AttachmentPanel title="Lampiran catatan tahap" basePath={`/api/notes/stage/${stage.id}/attachments`} fileBase="/api/notes/attachments" canAdd={canProgress} currentUserId={user.id} isAdmin={user.role.isAdmin} />
      </div>
    </li>
  )
}
