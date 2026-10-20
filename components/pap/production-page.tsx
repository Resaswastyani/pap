'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, CalendarClock, ChevronLeft, ChevronRight, ClipboardList, Cog, ExternalLink, Factory, FilePlus2, FileText, Flag, List, Loader2, Plus, Printer, Search, Stamp, Trash2 } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { AccurateSyncBar, formatNumber } from './accurate'
import { AttachmentPanel } from './attachments'
import { QcForm, ResultForm, ResultsTable, type Result } from './results-page'
import { FormulaBar, formulaSnapshot, type Formulation } from './formulation-page'
import { api, Field, formatDate, Modal, Notice, Progress, type UserOption } from './ui'

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
  target_qty: number | null
  hasil_baik: number | null
  spk_nomor: string | null
  spk_terbit_at: string | null
  spk_terbit_name: string | null
  spk_revisi: number
  spk_ditarik_at: string | null
  spk_ditarik_name: string | null
  spk_alasan_tarik: string | null
  formulasi: string | null
  formulasi_id: number | null
  formulasi_kode: string | null
  formulasi_versi: number | null
  tingkat_kualitas: string | null
  acuan_kerja: string | null
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
  target_qty: number | null
  target_unit: string | null
  hasil_baik: number | null
  jumlah_reject: number | null
  laporan: number
  pic_user_id: number | null
  pic_name: string | null
  catatan: string | null
  updated_by_name: string | null
}
type Machine = { id: number; kode: string; nama: string; tahap: string; status: string }
type ProductInfo = { id: number; nama: string; kode: string | null; jenis: string | null; spesifikasi: string | null; bahan: string | null; keterangan: string | null }
type ProductFile = { id: number; name: string; mime: string }
type Summary = { menunggu: number; dijadwalkan: number; berjalan: number; terlambat: number; selesai_minggu: number; spk_aktif: number; spk_belum: number }

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
// Target SPK: kosong = jumlah pesanan
const targetOf = (job: Pick<Job, 'target_qty' | 'quantity'>) => job.target_qty ?? job.quantity

// mode 'spk': menu SPK (Surat Perintah Kerja) memakai data job yang sama, fokus ke penerbitan SPK & hasil terhadap target
export function ProductionPage({ user, focusId, mode = 'jadwal' }: { user: UserProfile; focusId?: number | null; mode?: 'jadwal' | 'spk' }) {
  const isSpk = mode === 'spk'
  const [view, setView] = useState<'list' | 'machine'>('list')
  const [items, setItems] = useState<Job[]>([])
  const [summary, setSummary] = useState<Summary>({ menunggu: 0, dijadwalkan: 0, berjalan: 0, terlambat: 0, selesai_minggu: 0, spk_aktif: 0, spk_belum: 0 })
  const [spk, setSpk] = useState('')
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
      if (spk) params.set('spk', spk)
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
  }, [page, status, spk, q])
  useEffect(() => {
    const timer = setTimeout(load, q ? 300 : 0)
    return () => clearTimeout(timer)
  }, [load, q])
  useEffect(() => setPage(1), [status, spk, q])

  const reloadAll = () => {
    load()
    setReloadKey((k) => k + 1)
  }
  const spkStats: [string, number, string, string, typeof Factory, string][] = [
    ['terbit', summary.spk_aktif, 'SPK aktif', 'Sudah terbit, belum selesai', Stamp, 'stat-1'],
    ['belum', summary.spk_belum, 'SPK belum terbit', 'Job aktif menunggu PPIC', FilePlus2, 'stat-2'],
    ['berjalan', summary.berjalan, 'Sedang diproduksi', `${summary.selesai_minggu} selesai 7 hari terakhir`, Factory, 'stat-0'],
    ['terlambat', summary.terlambat, 'Lewat tanggal kirim', 'Belum selesai, perlu perhatian', AlertTriangle, 'stat-2'],
  ]
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
          <h1>{isSpk ? 'SPK (Surat Perintah Kerja)' : 'Jadwal Produksi'}</h1>
          <span>{isSpk
            ? 'PPIC menerbitkan SPK dari job produksi: target jumlah, formulasi bahan, tingkat kualitas, dan acuan kerja untuk KA Shift. Hasil baik dihitung dari laporan hasil produksi per shift.'
            : 'Otomatis dari Sales Order Accurate berisi barang bertanda “Diproduksi”. Kepala PPIC / GM mengatur tahap & mesin, Produksi meng-update progress.'}</span>
        </div>
      </div>
      <AccurateSyncBar entities={['sales-order', 'sales-order-items', 'item-detail']} canSync={can.manage || user.role.isAdmin} onSynced={reloadAll} />
      <div className="pap-stat-grid four">
        {(isSpk ? spkStats : stats).map(([key, value, label, note, Icon, tone]) => (
          <button key={key} className={`pap-stat-card pap-stat-button ${(isSpk && (key === 'terbit' || key === 'belum') ? spk === key && status === 'aktif' : status === key) ? 'active' : ''}`} onClick={() => {
            setView('list')
            if (isSpk && (key === 'terbit' || key === 'belum')) {
              setStatus('aktif')
              setSpk((v) => (v === key ? '' : key))
            } else setStatus((s) => (s === key ? 'aktif' : key))
          }}>
            <div><span>{label}</span><strong>{value}</strong><small className="neutral">{note}</small></div>
            <div className={`pap-stat-icon ${tone}`}><Icon /></div>
          </button>
        ))}
      </div>
      <div className="pap-table-card">
        <div className="pap-card-head">
          <div>
            <h2>{isSpk ? 'Daftar SPK' : view === 'list' ? 'Daftar job produksi' : 'Jadwal per mesin'}</h2>
            <p>{view === 'list' ? `Dari SO belum selesai dalam ${maxAge} hari terakhir & SO baru. Diurutkan dari tanggal kirim terdekat.` : 'Tahap produksi yang dijadwalkan per mesin dalam seminggu.'}</p>
          </div>
          {!isSpk && <div className="pap-segmented" role="tablist" aria-label="Tampilan jadwal">
            <button role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}><List /> Daftar job</button>
            <button role="tab" aria-selected={view === 'machine'} className={view === 'machine' ? 'active' : ''} onClick={() => setView('machine')}><Cog /> Per mesin</button>
          </div>}
        </div>
        {view === 'machine' && !isSpk ? (
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
              <select className="pap-select" value={spk} onChange={(e) => setSpk(e.target.value)} aria-label="Filter SPK">
                <option value="">SPK: semua</option>
                <option value="terbit">SPK sudah terbit</option>
                <option value="belum">SPK belum terbit</option>
              </select>
            </div>
            {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
            <div className="pap-table-wrap">
              <table>
                <thead><tr><th>Produk / Customer</th><th>{isSpk ? 'SPK / SO' : 'Job / SO'}</th><th className="pap-num">{isSpk ? 'Target' : 'Jumlah'}</th>{isSpk && <th className="pap-num">Hasil baik</th>}<th>Tgl kirim</th><th>Tahap</th><th>Status</th></tr></thead>
                <tbody>
                  {items.map((job) => (
                    <tr key={job.id} className="pap-row-link" onClick={() => setDetailId(job.id)}>
                      <td><div className="pap-cell-title">{job.prioritas === 'tinggi' && <Flag className="pap-inline-icon pap-flag" />}{job.item_name}</div><div className="pap-cell-sub">{job.customer_name ?? '—'}</div></td>
                      <td className="pap-nowrap">{job.spk_nomor ? <div className="pap-cell-title">{job.spk_nomor}</div> : <div className="pap-cell-sub">{job.nomor}{isSpk && <div><span className="pap-status warning">SPK belum terbit</span></div>}</div>}<div className="pap-cell-sub">{job.so_number}</div></td>
                      <td className="pap-num pap-nowrap">{qty(isSpk ? targetOf(job) : job.quantity, job.unit)}</td>
                      {isSpk && <td className="pap-num pap-nowrap">{job.hasil_baik === null ? '—' : qty(job.hasil_baik, job.unit)}{job.hasil_baik !== null && targetOf(job) ? <div className="pap-cell-sub">{Math.floor((job.hasil_baik / targetOf(job)!) * 100)}% target</div> : null}</td>}
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
type EditableStage = { key: string; id?: number; tahap: string; machine_id: string; plan_start: string; plan_end: string; pic_user_id: string; catatan: string; target_qty: string; target_unit: string }
const toEditable = (s: Stage): EditableStage => ({ key: String(s.id), id: s.id, tahap: s.tahap, machine_id: s.machine_id ? String(s.machine_id) : '', plan_start: toInput(s.plan_start), plan_end: toInput(s.plan_end), pic_user_id: s.pic_user_id ? String(s.pic_user_id) : '', catatan: s.catatan ?? '', target_qty: s.target_qty === null ? '' : String(s.target_qty), target_unit: s.target_unit ?? '' })

const esc = (value: string | null | undefined) => (value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

// Surat Perintah Kerja (SPK) siap cetak: data job, tahap, spesifikasi produk
function printSpk(job: Job, stages: Stage[], product: ProductInfo | null, results: Result[]) {
  const win = window.open('', '_blank')
  if (!win) return
  const block = (title: string, value: string | null | undefined) => `<h3>${title}</h3><div class="box">${value ? esc(value).replace(/\n/g, '<br>') : '<i>—</i>'}</div>`
  win.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8"><title>SPK ${esc(job.nomor)}</title>
<style>body{font:12.5px/1.5 system-ui,sans-serif;color:#111;margin:28px}h1{margin:0;font-size:19px}h3{margin:16px 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#555}
.head{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:10px}.head img{height:42px}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:6px 20px;margin-top:12px}
.meta span{display:block;color:#666;font-size:10.5px}.box{padding:9px 11px;border:1px solid #bbb;border-radius:6px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:6px 8px;text-align:left;font-size:12px}
th{background:#f2f2f2}.sign{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:36px;text-align:center}.sign div{padding-top:48px;border-bottom:1px solid #111}@media print{body{margin:10mm}}</style></head><body>
<div class="head"><div><h1>SURAT PERINTAH KERJA</h1><div><b>${esc(job.spk_nomor) || 'DRAFT (belum terbit)'}</b> · ${esc(job.nomor)} · ${esc(job.so_number)}</div>${job.spk_terbit_at ? `<div>Terbit ${esc(formatDate(job.spk_terbit_at, true))}${job.spk_terbit_name ? ` oleh ${esc(job.spk_terbit_name)}` : ''}</div>` : ''}</div><img src="/logo-pap.png" alt=""></div>
<div class="meta"><div><span>Produk</span><b>${esc(job.item_name)}</b></div><div><span>Customer</span>${esc(job.customer_name) || '—'}</div><div><span>Target produksi</span><b>${esc(qty(targetOf(job), job.unit))}</b>${job.target_qty !== null ? ` <small>(pesanan ${esc(qty(job.quantity, job.unit))})</small>` : ''}</div>
<div><span>Tanggal SO</span>${esc(formatDate(job.so_date))}</div><div><span>Tanggal kirim</span><b>${esc(formatDate(job.due_date))}</b></div><div><span>Prioritas</span>${job.prioritas === 'tinggi' ? '<b>TINGGI</b>' : 'Normal'}</div>
<div><span>Tingkat kualitas</span><b>${esc(job.tingkat_kualitas) || '—'}</b></div></div>
<h3>Tahap produksi</h3><table><tr><th>#</th><th>Tahap</th><th>Mesin</th><th>Target</th><th>Rencana mulai</th><th>Rencana selesai</th><th>PIC</th><th>Paraf</th></tr>
${stages.filter((s) => s.status !== 'dilewati').map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.tahap)}</td><td>${esc(s.machine_name) || '—'}</td><td>${esc(qty(s.target_qty ?? targetOf(job), s.target_unit ?? job.unit))}</td><td>${esc(formatDate(s.plan_start, true))}</td><td>${esc(formatDate(s.plan_end, true))}</td><td>${esc(s.pic_name) || '—'}</td><td></td></tr>`).join('')}</table>
${block('Formulasi / campuran bahan', job.formulasi)}${block('Acuan kerja', job.acuan_kerja)}${block('Spesifikasi produk', product?.spesifikasi)}${block('Keterangan bahan', product?.bahan)}${block('Catatan PPIC', job.catatan)}
<h3>Laporan hasil per shift</h3><table><tr><th>Tanggal</th><th>Shift</th><th>Tahap</th><th>Hasil</th><th>Reject</th><th>Operator</th><th>QC</th><th>Paraf KA Shift</th></tr>
${results.length ? results.map((r) => `<tr><td>${esc(formatDate(r.tanggal))}</td><td>${r.shift}</td><td>${esc(r.tahap)}</td><td>${esc(qty(r.jumlah_hasil, r.satuan))}</td><td>${esc(qty(r.jumlah_reject, r.satuan))}</td><td>${esc(r.operator) || '—'}</td><td>${esc(r.status_qc)}</td><td></td></tr>`).join('') : Array.from({ length: 6 }, () => '<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>').join('')}</table>
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
  const [spkForm, setSpkForm] = useState({ target_qty: '', tingkat_kualitas: '', formulasi: '', formulasi_id: '', acuan_kerja: '' })
  const [formulas, setFormulas] = useState<Formulation[] | null>(null)
  const [tarik, setTarik] = useState<string | null>(null)
  const [results, setResults] = useState<Result[]>([])
  const [resultCan, setResultCan] = useState({ report: false, qc: false, manage: false })
  const [resultForm, setResultForm] = useState<{ initial: Result | null; stageId?: number } | null>(null)
  const [qcFor, setQcFor] = useState<Result | null>(null)
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
      setSpkForm({ target_qty: res.item.target_qty === null ? '' : String(res.item.target_qty), tingkat_kualitas: res.item.tingkat_kualitas ?? '', formulasi: res.item.formulasi ?? '', formulasi_id: res.item.formulasi_id ? String(res.item.formulasi_id) : '', acuan_kerja: res.item.acuan_kerja ?? '' })
      const rs = await api<{ items: Result[]; can: typeof resultCan }>(`/api/production/results?job=${id}`)
      setResults(rs.items)
      setResultCan(rs.can)
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

  useEffect(() => {
    if (!can.manage || !job || job.spk_nomor || formulas) return
    api<{ items: Formulation[] }>('/api/formulations?status=aktif').then((r) => setFormulas(r.items)).catch(() => setFormulas([]))
  }, [can.manage, job, formulas])

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
      json: { stages: editing!.map((s) => ({ id: s.id, tahap: s.tahap, machine_id: s.machine_id || null, plan_start: s.plan_start || null, plan_end: s.plan_end || null, pic_user_id: s.pic_user_id || null, catatan: s.catatan, target_qty: s.target_qty || null, target_unit: s.target_unit })) },
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
            ? <button className="pap-btn" disabled={busy} onClick={() => run(() => api(`/api/production/${job.id}`, { method: 'PATCH', json: { batal: false } }), 'Produksi diaktifkan kembali.')}>Aktifkan produksi lagi</button>
            : <button className="pap-btn danger" disabled={busy} title="Hentikan produksi job ini. Sales Order di Accurate tidak ikut dibatalkan." onClick={() => window.confirm(`Batalkan produksi ${job.item_name}?\n\nJob dan SPK-nya dihentikan dan hilang dari daftar aktif. Laporan hasil baru tidak bisa dikirim.\nSales Order ${job.so_number ?? ''} di Accurate TIDAK ikut dibatalkan.\n\nBisa diaktifkan lagi kapan saja.`) && run(() => api(`/api/production/${job.id}`, { method: 'PATCH', json: { batal: true } }), 'Produksi dibatalkan. Sales Order di Accurate tidak berubah.')}><Trash2 /> Batalkan produksi</button>)}
          <span className="pap-spacer" />
          {can.manage && <button className="pap-btn" disabled={busy} onClick={() => run(() => api(`/api/production/${job.id}`, { method: 'PATCH', json: { prioritas: job.prioritas === 'tinggi' ? 'normal' : 'tinggi' } }))}><Flag /> {job.prioritas === 'tinggi' ? 'Prioritas normal' : 'Prioritas tinggi'}</button>}
          <button className="pap-btn" onClick={() => printSpk(job, stages, product, results)}><Printer /> Cetak SPK</button>
        </>
      }
    >
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      <div className="pap-detail-badges">
        <JobBadge value={job.status} />
        {job.spk_nomor ? <span className="pap-status success">{job.spk_nomor}</span> : <span className="pap-status warning">{job.spk_ditarik_at ? 'SPK ditarik, menunggu revisi' : 'SPK belum terbit'}</span>}
        {job.prioritas === 'tinggi' && <span className="pap-status danger">Prioritas tinggi</span>}
        {isLate(job) && <span className="pap-status danger">Lewat tanggal kirim</span>}
      </div>
      <dl className="pap-detail-grid">
        <div><dt>Jumlah pesanan</dt><dd><strong>{qty(job.quantity, job.unit)}</strong></dd></div>
        <div><dt>Tanggal kirim</dt><dd>{formatDate(job.due_date)}</dd></div>
        <div><dt>Sales Order</dt><dd>{job.so_number} · {formatDate(job.so_date)}</dd></div>
        <div><dt>Stok barang jadi saat ini</dt><dd>{stock ? qty(stock.qty, stock.unit) : '—'}</dd></div>
        <div><dt>Target SPK · hasil baik</dt><dd><strong>{qty(targetOf(job), job.unit)}</strong> · {job.hasil_baik === null ? 'belum ada laporan' : `${qty(job.hasil_baik, job.unit)}${targetOf(job) ? ` (${Math.floor((job.hasil_baik / targetOf(job)!) * 100)}%)` : ''}`}</dd></div>
      </dl>

      <section className="pap-detail-section">
        <div className="pap-section-head">
          <h3>SPK (Surat Perintah Kerja)</h3>
          {job.spk_nomor && <small className="pap-muted">Terbit {formatDate(job.spk_terbit_at, true)}{job.spk_terbit_name ? ` oleh ${job.spk_terbit_name}` : ''}</small>}
        </div>
        {!job.spk_nomor && job.spk_ditarik_at && (
          <div className="pap-result-issue pap-spk-withdrawn">SPK sebelumnya ditarik {formatDate(job.spk_ditarik_at, true)}{job.spk_ditarik_name ? ` oleh ${job.spk_ditarik_name}` : ''}: {job.spk_alasan_tarik}. Setelah direvisi, terbitkan ulang sebagai revisi R{job.spk_revisi}.</div>
        )}
        {can.manage && job.status !== 'batal' && !job.spk_nomor ? (
          <div className="pap-form-grid">
            <Field label="Target jumlah produksi" hint={`Kosong = jumlah pesanan (${qty(job.quantity, job.unit)}). Satuan: ${job.unit ?? '—'}`}><input className="pap-input" inputMode="decimal" value={spkForm.target_qty} onChange={(e) => setSpkForm((v) => ({ ...v, target_qty: e.target.value }))} placeholder={job.quantity === null ? '' : String(job.quantity)} /></Field>
            <Field label="Tingkat kualitas"><input className="pap-input" maxLength={100} value={spkForm.tingkat_kualitas} onChange={(e) => setSpkForm((v) => ({ ...v, tingkat_kualitas: e.target.value }))} placeholder="mis. Grade A, food grade, reguler" /></Field>
            <Field label="Formulasi / campuran bahan" full hint="Pilih dari database Formulasi Produk; teks komposisi disalin ke SPK dan masih bisa disesuaikan.">
              <div className="pap-spk-formula">
                <select className="pap-select" value={spkForm.formulasi_id} onChange={(e) => {
                  const f = formulas?.find((x) => String(x.id) === e.target.value)
                  setSpkForm((v) => ({ ...v, formulasi_id: e.target.value, formulasi: f ? formulaSnapshot(f) : v.formulasi, tingkat_kualitas: v.tingkat_kualitas || f?.tingkat_kualitas || '' }))
                }} aria-label="Pilih formulasi">
                  <option value="">{formulas === null ? 'Memuat formulasi...' : formulas.length ? '— Pilih dari database formulasi —' : 'Belum ada formulasi di database'}</option>
                  {spkForm.formulasi_id && !formulas?.some((f) => String(f.id) === spkForm.formulasi_id) && <option value={spkForm.formulasi_id}>{job.formulasi_kode ?? 'Formulasi'} v{job.formulasi_versi}</option>}
                  {formulas?.map((f) => <option key={f.id} value={f.id}>{f.kode} v{f.versi} · {f.nama}{f.jenis_plastik ? ` (${f.jenis_plastik})` : ''}</option>)}
                </select>
              </div>
              {(() => { const f = formulas?.find((x) => String(x.id) === spkForm.formulasi_id); return f ? <FormulaBar items={f.items} /> : null })()}
            </Field>
            <Field label="Teks formulasi di SPK" full><textarea className="pap-input" rows={3} maxLength={10000} value={spkForm.formulasi} onChange={(e) => setSpkForm((v) => ({ ...v, formulasi: e.target.value }))} placeholder="mis. HD 70% · LLDPE 25% · masterbatch putih 5%" /></Field>
            <Field label="Acuan kerja untuk KA Shift" full><textarea className="pap-input" rows={3} maxLength={10000} value={spkForm.acuan_kerja} onChange={(e) => setSpkForm((v) => ({ ...v, acuan_kerja: e.target.value }))} placeholder="Ukuran, ketebalan, warna cetak, standar seal, sample acuan, dll." /></Field>
            <div className="full pap-inline-actions">
              <span className="pap-spacer" />
              <button className="pap-btn" disabled={busy || (spkForm.target_qty === (job.target_qty === null ? '' : String(job.target_qty)) && spkForm.tingkat_kualitas === (job.tingkat_kualitas ?? '') && spkForm.formulasi === (job.formulasi ?? '') && spkForm.formulasi_id === (job.formulasi_id ? String(job.formulasi_id) : '') && spkForm.acuan_kerja === (job.acuan_kerja ?? ''))} onClick={() => run(() => api(`/api/production/${job.id}`, { method: 'PATCH', json: { ...spkForm, target_qty: spkForm.target_qty || null, formulasi_id: spkForm.formulasi_id || null } }), 'Isi SPK disimpan.')}>Simpan isi SPK</button>
              {!job.spk_nomor && <button className="pap-primary-button" disabled={busy} onClick={() => window.confirm('Terbitkan SPK untuk job ini? Nomor SPK dibuat dan SPK bisa dicetak untuk Produksi.') && run(() => api(`/api/production/${job.id}`, { method: 'PATCH', json: { ...spkForm, target_qty: spkForm.target_qty || null, formulasi_id: spkForm.formulasi_id || null, terbitkan_spk: true } }), 'SPK diterbitkan.')}><Stamp /> {job.spk_revisi ? `Terbitkan ulang SPK (revisi R${job.spk_revisi})` : 'Terbitkan SPK'}</button>}
            </div>
          </div>
        ) : (
          <>
            <div className="pap-spec-grid">
              <div><span>Target produksi</span><p>{qty(targetOf(job), job.unit)}</p></div>
              <div><span>Tingkat kualitas</span><p>{job.tingkat_kualitas || <span className="pap-muted">—</span>}</p></div>
              <div><span>Formulasi / campuran bahan{job.formulasi_kode ? ` · ${job.formulasi_kode}` : ''}</span><p className="pap-prewrap">{job.formulasi || <span className="pap-muted">Belum diisi PPIC.</span>}</p></div>
              <div><span>Acuan kerja</span><p className="pap-prewrap">{job.acuan_kerja || <span className="pap-muted">Belum diisi PPIC.</span>}</p></div>
            </div>
            {/* SPK terbit dikunci; revisi lewat Tarik SPK (job produksi & laporan hasil tetap berjalan) */}
            {can.manage && job.status !== 'batal' && job.spk_nomor && (tarik === null ? (
              <div className="pap-inline-actions">
                <small className="pap-muted">Isi SPK terkunci setelah terbit. Untuk mengubahnya, tarik SPK lalu terbitkan ulang sebagai revisi.</small>
                <span className="pap-spacer" />
                <button className="pap-btn danger" disabled={busy} onClick={() => setTarik('')}>Tarik SPK</button>
              </div>
            ) : (
              <div className="pap-inline-panel">
                <strong>Tarik SPK {job.spk_nomor}</strong>
                <p className="pap-muted">Nomor SPK dicabut dan SPK lama tidak berlaku lagi. Job produksi, jadwal, dan laporan hasil tetap berjalan. Setelah isinya diperbaiki, SPK diterbitkan ulang dengan nomor revisi R{job.spk_revisi + 1}.</p>
                <textarea className="pap-input" rows={2} maxLength={500} value={tarik} onChange={(e) => setTarik(e.target.value)} placeholder="Alasan menarik SPK, mis. formulasi salah, target berubah" autoFocus />
                <div className="pap-inline-actions">
                  <span className="pap-spacer" />
                  <button className="pap-btn" onClick={() => setTarik(null)}>Batal</button>
                  <button className="pap-btn danger" disabled={busy || !tarik.trim()} onClick={() => run(() => api(`/api/production/${job.id}`, { method: 'PATCH', json: { tarik_spk: true, alasan_tarik: tarik } }), 'SPK ditarik. Silakan revisi lalu terbitkan ulang.').then(() => setTarik(null))}>Tarik SPK</button>
                </div>
              </div>
            ))}
          </>
        )}
      </section>

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
                  <label>Target tahap<input className="pap-input" inputMode="decimal" value={s.target_qty} onChange={(e) => setRow(index, 'target_qty', e.target.value)} placeholder={`Kosong = target SPK (${qty(targetOf(job), job.unit)})`} /></label>
                  <label>Satuan target<input className="pap-input" maxLength={40} list="pap-result-units-stage" value={s.target_unit} onChange={(e) => setRow(index, 'target_unit', e.target.value)} placeholder={job.unit ?? 'kg / pcs'} /></label>
                  <label className="full">Catatan tahap<input className="pap-input" maxLength={1000} value={s.catatan} onChange={(e) => setRow(index, 'catatan', e.target.value)} placeholder="Instruksi khusus, warna tinta, ukuran potong, dll." /></label>
                </div>
              </div>
            ))}
            <datalist id="pap-stage-names">{STAGES.map((t) => <option key={t} value={t} />)}</datalist>
            <datalist id="pap-result-units-stage">{['kg', 'pcs', 'roll', 'bal', 'lembar', 'pack'].map((u) => <option key={u} value={u} />)}</datalist>
            {!machines.length && <p className="pap-hint">Belum ada data mesin. Tambahkan di menu Data Mesin.</p>}
            <div className="pap-inline-actions">
              <button className="pap-btn" onClick={() => setEditing((rows) => [...rows!, { key: `new-${Date.now()}`, tahap: 'Lainnya', machine_id: '', plan_start: '', plan_end: '', pic_user_id: '', catatan: '', target_qty: '', target_unit: '' }])}><Plus /> Tambah tahap</button>
              <span className="pap-spacer" />
              <button className="pap-btn" onClick={() => setEditing(null)}>Batal</button>
              <button className="pap-primary-button" disabled={busy} onClick={saveSchedule}>{busy ? <Loader2 className="pap-spin" /> : null} Simpan jadwal</button>
            </div>
          </div>
        ) : (
          <ol className="pap-stage-list">
            {stages.map((s) => <StageRow key={`${s.id}-${s.status}-${s.progress}`} stage={s} job={job} user={user} canProgress={can.progress && job.status !== 'batal'} canReport={resultCan.report && job.status !== 'batal' && s.status !== 'dilewati'} onReport={() => setResultForm({ initial: null, stageId: s.id })} busy={busy} run={run} />)}
          </ol>
        )}
      </section>

      <section className="pap-detail-section">
        <div className="pap-section-head">
          <h3>Laporan hasil produksi & QC</h3>
          {resultCan.report && job.status !== 'batal' && <button className="pap-btn" onClick={() => setResultForm({ initial: null })}><Plus /> Lapor hasil</button>}
        </div>
        {results.length ? (
          <ResultsTable items={results} can={resultCan} showJob={false} currentUserId={user.id} onEdit={(r) => setResultForm({ initial: r })} onQc={setQcFor} onDeleted={() => { load(); onChanged() }} onError={setError} />
        ) : <p className="pap-muted">Belum ada laporan hasil. KA Shift melaporkan hasil per shift dari menu Hasil Produksi atau tombol Lapor hasil pada tahap.</p>}
      </section>
      {resultForm && <ResultForm initial={resultForm.initial} stageId={resultForm.stageId} onClose={() => setResultForm(null)} onSaved={(t) => { setResultForm(null); setMessage(t); load(); onChanged() }} />}
      {qcFor && <QcForm item={qcFor} onClose={() => setQcFor(null)} onSaved={(t) => { setQcFor(null); setMessage(t); load(); onChanged() }} />}

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

function StageRow({ stage, job, user, canProgress, canReport, onReport, busy, run }: { stage: Stage; job: Job; user: UserProfile; canProgress: boolean; canReport: boolean; onReport: () => void; busy: boolean; run: (action: () => Promise<unknown>, text?: string) => Promise<void> }) {
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
          <small>Target {qty(stage.target_qty ?? targetOf(job), stage.target_unit ?? job.unit)} · hasil baik {stage.laporan ? qty(stage.hasil_baik ?? 0, stage.target_unit ?? job.unit) : '—'}{stage.jumlah_reject ? ` · reject ${formatNumber(stage.jumlah_reject)}` : ''}{stage.laporan ? ` · ${stage.laporan} laporan shift` : ''}</small>
        </div>
        <span className={`pap-status ${STAGE_TONE[stage.status]}`}>{STAGE_LABEL[stage.status]}</span>
        {canReport && <button className="pap-btn small" onClick={onReport}><Plus /> Lapor hasil</button>}
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
