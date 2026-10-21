'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, CalendarClock, CalendarDays, ClipboardList, Factory, FlaskConical, Handshake, ListChecks, MapPin, Palette, Repeat, Target, TrendingDown, TrendingUp } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { formatRupiah } from './accurate'
import { BarList, ColumnChart, dayNumber, Gantt, todayNumber, useMediaQuery, type GanttBar, type GanttRow } from './charts'
import { api, formatDate, Notice, Progress } from './ui'

type Metric = { label: string; satuan: string }
type GanttStage = { id: number; tahap: string; plan_start: string; plan_end: string | null; status: string; progress: number }
type GanttJob = { id: number; nomor: string | null; item_name: string; due_date: string | null; status: string; prioritas: string; customer: string | null; so_date: string | null; stages: GanttStage[] }
type GanttPlanning = { id: number; judul: string; tanggal_mulai: string; tanggal_selesai: string; progress: number; status: string; divisi: string }
type DashboardData = {
  marketing?: {
    followup_saya: number; followup_terlambat: number; prospek_aktif: number; belum_dibagi: number; tim: boolean
    funnel: Record<string, number>
    visits: { id: number; jadwal: string; jenis: string; target: string | null; alamat: string | null }[]
    followups: { id: number; nama_usaha: string; next_followup_at: string; status: string }[]
  }
  quotation?: { menunggu: number; nilai_menunggu: number; draft: number; diterima_bulan_ini: number; persetujuan: number }
  repeat?: { waktunya: number; berisiko: number; followup: number; tim: boolean }
  kpi?: { periode: string; nilai?: Record<string, number>; target: Record<string, number> }
  penjualan?: { omzet_bulan_lalu_sd_hari_ini: number; bulan: { bulan: string; omzet: number; faktur: number; customer: number }[]; top: { name: string; omzet: number }[]; so: { jumlah: number; nilai: number } }
  produksi?: {
    menunggu: number; dijadwalkan: number; berjalan: number; terlambat: number; selesai_bulan_ini: number
    jatuh_tempo: { id: number; nomor: string; item_name: string; due_date: string; status: string; customer: string | null }[]
    gantt: GanttJob[]
  }
  sample?: { todo: number; aktif: number }
  desain?: { todo: number; aktif: number }
  meetings?: { id: number; judul: string; waktu: string; tempat: string | null }[]
  plannings?: { id: number; judul: string; tanggal_selesai: string; progress: number; status: string }[]
  planningGantt?: GanttPlanning[]
}
export type DashboardTarget = { prospectId?: number; visitId?: number; meetingId?: number; planningId?: number }

const KPI_LABEL: Record<string, Metric> = {
  leads: { label: 'Lead baru', satuan: '' }, followup: { label: 'Follow-up', satuan: '' }, visit: { label: 'Visit', satuan: '' },
  penawaran: { label: 'Penawaran', satuan: '' }, closing: { label: 'Closing', satuan: '' }, nilai: { label: 'Nilai deal', satuan: 'Rp' }, repeat: { label: 'Follow-up customer', satuan: '' },
}
// Urutan tahap prospek dari awal sampai serah terima (gagal ditampilkan terpisah)
const FUNNEL: [string, string][] = [['baru', 'Baru'], ['dihubungi', 'Dihubungi'], ['janji_temu', 'Janji temu'], ['visit', 'Visit'], ['penawaran', 'Penawaran'], ['order_pertama', 'Order pertama'], ['handover', 'Handover']]
// Warna tahap produksi (slot kategorikal tetap, sama di semua Gantt)
const STAGE_TONE: Record<string, string> = { Blow: 's1', Cetak: 's2', 'Bag making': 's3' }
const STAGE_STATUS: Record<string, string> = { belum: 'Belum mulai', berjalan: 'Berjalan', selesai: 'Selesai' }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`
const shortRp = (v: number) => (v >= 1e9 ? `${(v / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 })} M` : v >= 1e6 ? `${(v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt` : v.toLocaleString('id-ID'))
// Jendela Gantt: 4 minggu di layar lebar, 2 minggu di HP agar tiap hari tetap terbaca
const GANTT_WIDE = { days: 28, before: 7 }
const GANTT_NARROW = { days: 14, before: 3 }

// 12 bulan terakhir lengkap (bulan tanpa faktur tetap tampil bernilai 0)
function lastMonths(count: number) {
  const now = new Date()
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (count - 1 - i), 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
}

function Tile({ label, value, note, icon: Icon, tone = 'stat-1', onClick }: { label: string; value: string | number; note?: string; icon: typeof Target; tone?: string; onClick?: () => void }) {
  return (
    <button className="pap-stat-card pap-stat-button" onClick={onClick} disabled={!onClick}>
      <div><span>{label}</span><strong>{value}</strong>{note && <small className="neutral">{note}</small>}</div>
      <div className={`pap-stat-icon ${tone}`}><Icon /></div>
    </button>
  )
}

function productionRows(jobs: GanttJob[], today: number, onOpen: () => void): GanttRow[] {
  return jobs.map((job) => {
    const due = job.due_date ? dayNumber(job.due_date) : null
    const late = due !== null && due < today
    const bars: GanttBar[] = job.stages.map((s) => {
      const start = dayNumber(s.plan_start)
      const end = Math.max(s.plan_end ? dayNumber(s.plan_end) : start + 1, start + 0.5)
      return {
        key: `s${s.id}`, start, end, tone: STAGE_TONE[s.tahap] ?? 's4', label: s.tahap, progress: s.progress,
        tip: <><b>{s.tahap} · {job.nomor ?? job.item_name}</b><span>{formatDate(s.plan_start, true)} → {formatDate(s.plan_end, true)}</span><span>{STAGE_STATUS[s.status] ?? s.status} · {s.progress}%</span></>,
      }
    })
    // Job belum dijadwalkan: tampilkan rentang SO → tanggal kirim sebagai jendela order
    if (!bars.length && due !== null) {
      const start = job.so_date ? dayNumber(job.so_date) : due - 7
      bars.push({ key: `w${job.id}`, start, end: due + 1, tone: 'window', label: 'Belum dijadwalkan', tip: <><b>{job.nomor ?? job.item_name}</b><span>Belum ada tahap terjadwal</span><span>SO {formatDate(job.so_date)} · kirim {formatDate(job.due_date)}</span></> })
    }
    // Keterlambatan: dari tanggal kirim sampai hari ini
    if (late && due !== null) {
      bars.push({ key: `late${job.id}`, start: due + 1, end: today + 1, tone: 'overdue', label: `+${today - due} hari`, tip: <><b>{job.nomor ?? job.item_name}</b><span>Tanggal kirim {formatDate(job.due_date)}</span><span>Terlambat {today - due} hari</span></> })
    }
    return {
      key: `j${job.id}`,
      label: `${job.nomor ? `${job.nomor} · ` : ''}${job.item_name}`,
      sub: `${job.customer ?? 'Tanpa customer'}${job.due_date ? ` · kirim ${formatDate(job.due_date)}` : ''}`,
      flag: late ? <AlertTriangle className="pap-gantt2-flag late" aria-label="Lewat tenggat" /> : job.prioritas === 'tinggi' ? <span className="pap-gantt2-pill">Prioritas</span> : null,
      bars,
      markers: due !== null ? [{ key: 'due', at: due + 0.5, tone: late ? 'late' : 'due', tip: <><b>Tanggal kirim{late ? ' (lewat)' : ''}</b><span>{formatDate(job.due_date)}</span></> }] : [],
      onClick: onOpen,
    }
  })
}

function planningRows(items: GanttPlanning[], today: number, onOpen: (id: number) => void): GanttRow[] {
  return items.map((p) => {
    const start = dayNumber(p.tanggal_mulai)
    const end = dayNumber(p.tanggal_selesai) + 1
    const late = end <= today
    return {
      key: `p${p.id}`,
      label: p.judul,
      sub: `${p.divisi} · ${late ? 'terlambat' : `s/d ${formatDate(p.tanggal_selesai)}`}`,
      flag: late ? <AlertTriangle className="pap-gantt2-flag late" aria-label="Terlambat" /> : null,
      bars: [{
        key: 'b', start, end, tone: late ? 'plan late' : 'plan', progress: p.progress, label: `${p.progress}%`,
        tip: <><b>{p.judul}</b><span>{formatDate(p.tanggal_mulai)} → {formatDate(p.tanggal_selesai)}</span><span>{p.status === 'berjalan' ? 'Berjalan' : 'Belum mulai'} · progress {p.progress}%{late ? ' · terlambat' : ''}</span></>,
      }, ...(late ? [{
        key: 'late', start: end, end: today + 1, tone: 'overdue', label: `+${today + 1 - end} hari`,
        tip: <><b>{p.judul}</b><span>Target selesai {formatDate(p.tanggal_selesai)}</span><span>Terlambat {today + 1 - end} hari · progress {p.progress}%</span></>,
      }] : [])],
      markers: late ? [{ key: 'end', at: end - 0.5, tone: 'late' as const, tip: <><b>Target selesai (lewat)</b><span>{formatDate(p.tanggal_selesai)}</span></> }] : [],
      onClick: () => onOpen(p.id),
    }
  })
}

export function DashboardPage({ user, onNavigate }: { user: UserProfile; onNavigate: (menu: string, target?: DashboardTarget) => void }) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState('')
  const narrow = useMediaQuery('(max-width: 640px)')
  useEffect(() => { api<DashboardData>('/api/dashboard').then(setData).catch((e) => setError(e.message)) }, [])
  const hour = new Date().getHours()
  const salam = hour < 11 ? 'Selamat pagi' : hour < 15 ? 'Selamat siang' : hour < 19 ? 'Selamat sore' : 'Selamat malam'
  const today = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const d = data ?? {}
  const sales = d.penjualan
  const months = lastMonths(12)
  const byMonth = new Map(sales?.bulan.map((b) => [b.bulan, b]))
  const thisMonth = byMonth.get(months[11])
  // Dibanding bulan lalu pada tanggal yang sama (bulan berjalan belum penuh)
  const pembanding = sales?.omzet_bulan_lalu_sd_hari_ini ?? 0
  const growth = thisMonth && pembanding ? ((thisMonth.omzet - pembanding) / pembanding) * 100 : null
  const total12 = sales?.bulan.reduce((sum, b) => sum + b.omzet, 0) ?? 0
  const fullMonths = months.slice(0, 11).map((m) => byMonth.get(m)?.omzet ?? 0)
  const avgMonth = fullMonths.length ? fullMonths.reduce((a, b) => a + b, 0) / fullMonths.length : 0
  const topMax = Math.max(1, ...(sales?.top.map((t) => t.omzet) ?? [1]))
  const dayToday = todayNumber()
  const gantt = narrow ? GANTT_NARROW : GANTT_WIDE
  const ganttStart = dayToday - gantt.before
  const funnelTotal = d.marketing ? FUNNEL.reduce((sum, [k]) => sum + (d.marketing!.funnel[k] ?? 0), 0) : 0
  const empty = data && !Object.keys(data).length

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">{today.toUpperCase()}</p>
          <h1>{salam}, {user.name.split(' ')[0]}</h1>
          <span>{user.role.name} · {user.division.name}. Ringkasan pekerjaan Anda hari ini.</span>
        </div>
      </div>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {!data && !error && <div className="pap-empty">Memuat ringkasan...</div>}
      {empty && <div className="pap-empty">Belum ada ringkasan untuk menu Anda.</div>}

      {(d.marketing || d.quotation || d.repeat || d.sample || d.desain || d.produksi) && (
        <div className="pap-stat-grid four pap-dash-tiles">
          {d.marketing && <Tile label="Follow-up hari ini" value={d.marketing.followup_saya} note={d.marketing.followup_terlambat ? `${d.marketing.followup_terlambat} terlambat` : 'Prospek pegangan Anda'} icon={CalendarClock} tone={d.marketing.followup_terlambat ? 'stat-2' : 'stat-1'} onClick={() => onNavigate('Prospek')} />}
          {d.marketing && <Tile label="Visit hari ini" value={d.marketing.visits.length} note={`${d.marketing.prospek_aktif} prospek aktif${d.marketing.tim && d.marketing.belum_dibagi ? ` · ${d.marketing.belum_dibagi} belum dibagi` : ''}`} icon={MapPin} onClick={() => onNavigate('Jadwal Visit')} />}
          {!!d.quotation?.persetujuan && <Tile label="Quotation perlu persetujuan" value={d.quotation.persetujuan} note="menunggu persetujuan Anda" icon={ClipboardList} tone="stat-2" onClick={() => onNavigate('Quotation')} />}
          {d.quotation && <Tile label="Penawaran menunggu" value={d.quotation.menunggu} note={`${formatRupiah(d.quotation.nilai_menunggu)}${d.quotation.draft ? ` · ${d.quotation.draft} draft` : ''}`} icon={ClipboardList} onClick={() => onNavigate('Quotation')} />}
          {d.repeat && <Tile label="Customer perlu dihubungi" value={d.repeat.waktunya + d.repeat.berisiko} note={`${d.repeat.berisiko} berisiko berhenti order`} icon={Repeat} tone={d.repeat.berisiko ? 'stat-2' : 'stat-0'} onClick={() => onNavigate('Repeat Order')} />}
          {d.sample && <Tile label="Request sample" value={d.sample.todo} note={`perlu tindakan · ${d.sample.aktif} berjalan`} icon={FlaskConical} tone={d.sample.todo ? 'stat-2' : 'stat-0'} onClick={() => onNavigate('Request Sample')} />}
          {d.desain && <Tile label="Request desain" value={d.desain.todo} note={`perlu tindakan · ${d.desain.aktif} berjalan`} icon={Palette} tone={d.desain.todo ? 'stat-2' : 'stat-0'} onClick={() => onNavigate('Request Desain')} />}
          {d.produksi && <Tile label="Produksi berjalan" value={d.produksi.berjalan} note={`${d.produksi.menunggu} menunggu · ${d.produksi.dijadwalkan} terjadwal`} icon={Factory} onClick={() => onNavigate('Rencana Produksi')} />}
          {d.produksi && <Tile label="Produksi lewat tenggat" value={d.produksi.terlambat} note={`${d.produksi.selesai_bulan_ini} selesai bulan ini`} icon={AlertTriangle} tone={d.produksi.terlambat ? 'stat-2' : 'stat-0'} onClick={() => onNavigate('Rencana Produksi')} />}
        </div>
      )}

      <div className="pap-dash-grid">
        {sales && (
          <section className="pap-table-card pap-dash-card wide">
            <div className="pap-card-head">
              <div><h2>Penjualan (faktur Accurate)</h2><p>Omzet per bulan, 12 bulan terakhir · bulan ini {thisMonth ? `${thisMonth.faktur} faktur, ${thisMonth.customer} customer` : 'belum ada faktur'}</p></div>
              <div className="pap-dash-total">
                <small>Bulan ini</small>
                <strong>{formatRupiah(thisMonth?.omzet ?? 0)}</strong>
                {growth !== null && <span className={growth >= 0 ? 'up' : 'down'}>{growth >= 0 ? <TrendingUp /> : <TrendingDown />} {growth >= 0 ? '+' : ''}{growth.toFixed(1)}% vs periode sama bulan lalu</span>}
              </div>
            </div>
            <div className="pap-dash-metrics">
              <div><span>Total 12 bulan</span><b>{formatRupiah(total12)}</b></div>
              <div><span>Rata-rata per bulan</span><b>{formatRupiah(avgMonth)}</b></div>
              <div><span>Sales order bulan ini</span><b>{sales.so.jumlah} SO · {shortRp(sales.so.nilai)}</b></div>
            </div>
            <ColumnChart
              ariaLabel="Grafik omzet faktur 12 bulan terakhir"
              format={shortRp}
              data={months.map((m, i) => {
                const b = byMonth.get(m)
                return { key: m, label: monthLabel(m), value: b?.omzet ?? 0, partial: i === 11, detail: <span>{b?.faktur ?? 0} faktur · {b?.customer ?? 0} customer</span> }
              })}
            />
            <div className="pap-dash-split">
              <div>
                <h3>Top customer bulan ini</h3>
                {sales.top.length
                  ? <BarList max={topMax} items={sales.top.map((t) => ({ key: t.name, label: t.name, value: t.omzet, display: formatRupiah(t.omzet) }))} />
                  : <p className="pap-muted">Belum ada faktur bulan ini.</p>}
              </div>
              <div className="pap-dash-share">
                <h3>Porsi top 5 dari omzet bulan ini</h3>
                {thisMonth?.omzet ? (() => {
                  const share = Math.min(100, (sales.top.reduce((s, t) => s + t.omzet, 0) / thisMonth.omzet) * 100)
                  return <><p className="pap-dash-big">{share.toFixed(0)}%</p><div className="pap-share-bar"><span style={{ width: `${share}%` }} /></div><small className="pap-muted">Sisanya {(100 - share).toFixed(0)}% dari {Math.max(0, thisMonth.customer - sales.top.length)} customer lain</small></>
                })() : <p className="pap-muted">—</p>}
              </div>
            </div>
          </section>
        )}

        {d.produksi && (
          <section className="pap-table-card pap-dash-card wide">
            <div className="pap-card-head">
              <div><h2>Timeline produksi</h2><p>Tahap terjadwal & tanggal kirim · {gantt.before} hari lalu s/d {gantt.days - gantt.before - 1} hari ke depan</p></div>
              <button className="pap-btn" onClick={() => onNavigate('Rencana Produksi')}>Jadwal lengkap</button>
            </div>
            <Gantt
              start={ganttStart}
              days={gantt.days}
              rows={productionRows(d.produksi.gantt, dayToday, () => onNavigate('Rencana Produksi'))}
              legend={[{ tone: 's1', label: 'Blow' }, { tone: 's2', label: 'Cetak' }, { tone: 's3', label: 'Bag making' }, { tone: 's4', label: 'Lainnya' }, { tone: 'window', label: 'Belum dijadwalkan' }, { tone: 'overdue', label: 'Keterlambatan' }, { tone: 'due', label: 'Tanggal kirim', shape: 'marker' }, { tone: 'late', label: 'Lewat tenggat', shape: 'marker' }]}
              empty="Tidak ada job aktif dalam rentang ini."
            />
          </section>
        )}

        {d.planningGantt && d.planningGantt.length > 0 && (
          <section className="pap-table-card pap-dash-card wide">
            <div className="pap-card-head">
              <div><h2>Timeline planning</h2><p>Planning aktif · isi batang = progress</p></div>
              <button className="pap-btn" onClick={() => onNavigate('Planning')}>Semua planning</button>
            </div>
            <Gantt
              start={ganttStart}
              days={gantt.days}
              rows={planningRows(d.planningGantt, dayToday, (id) => onNavigate('Planning', { planningId: id }))}
              legend={[{ tone: 'plan', label: 'Rentang planning' }, { tone: 'plan-done', label: 'Progress' }, { tone: 'overdue', label: 'Keterlambatan' }, { tone: 'late', label: 'Target lewat', shape: 'marker' }]}
              empty="Tidak ada planning aktif."
            />
          </section>
        )}

        {d.marketing && (
          <section className="pap-table-card pap-dash-card">
            <div className="pap-card-head"><div><h2>Corong prospek</h2><p>{funnelTotal} prospek per tahap{d.marketing.funnel.gagal ? ` · ${d.marketing.funnel.gagal} gagal` : ''}</p></div><button className="pap-btn" onClick={() => onNavigate('Prospek')}>Detail</button></div>
            <div className="pap-dash-body">
              <BarList items={FUNNEL.map(([k, label]) => ({ key: k, label, value: d.marketing!.funnel[k] ?? 0 }))} />
            </div>
          </section>
        )}

        {d.produksi && (
          <section className="pap-table-card pap-dash-card">
            <div className="pap-card-head"><div><h2>Status job produksi</h2><p>Semua job yang belum selesai</p></div></div>
            <div className="pap-dash-body">
              <BarList items={[
                { key: 'menunggu', label: 'Menunggu dijadwalkan', value: d.produksi.menunggu },
                { key: 'dijadwalkan', label: 'Dijadwalkan', value: d.produksi.dijadwalkan },
                { key: 'berjalan', label: 'Berjalan', value: d.produksi.berjalan },
                { key: 'terlambat', label: 'Lewat tenggat', value: d.produksi.terlambat, tone: 'critical', icon: <AlertTriangle className="pap-barlist-icon" /> },
                { key: 'selesai', label: 'Selesai bulan ini', value: d.produksi.selesai_bulan_ini, tone: 'muted' },
              ]} />
            </div>
          </section>
        )}

        {d.kpi?.nilai && (
          <section className="pap-table-card pap-dash-card">
            <div className="pap-card-head"><div><h2>KPI saya bulan ini</h2><p>Target diatur Lead / GM</p></div><button className="pap-btn" onClick={() => onNavigate('KPI Marketing')}>Detail</button></div>
            <div className="pap-kpi-mini">
              {Object.entries(KPI_LABEL).map(([k, m]) => {
                const v = d.kpi!.nilai![k] ?? 0
                const t = d.kpi!.target[k]
                return (
                  <div key={k}>
                    <span>{m.label}</span>
                    <b>{m.satuan === 'Rp' ? formatRupiah(v) : v}{t ? <small> / {m.satuan === 'Rp' ? shortRp(t) : t}</small> : null}</b>
                    {t ? <Progress value={Math.min(100, Math.round((v / t) * 100))} /> : <small className="pap-muted">tanpa target</small>}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {d.marketing && (d.marketing.followups.length > 0 || d.marketing.visits.length > 0) && (
          <section className="pap-table-card pap-dash-card">
            <div className="pap-card-head"><div><h2>Agenda marketing hari ini</h2><p>Visit & follow-up jatuh tempo</p></div></div>
            <ul className="pap-dash-agenda">
              {d.marketing.visits.map((v) => <li key={`v${v.id}`}><button onClick={() => onNavigate('Jadwal Visit', { visitId: v.id })}><MapPin /><span><b>{v.jadwal.slice(11, 16)}</b> Visit {v.target ?? ''}</span></button></li>)}
              {d.marketing.followups.map((p) => <li key={`p${p.id}`}><button onClick={() => onNavigate('Prospek', { prospectId: p.id })}><CalendarClock className={p.next_followup_at.slice(0, 10) < new Date().toISOString().slice(0, 10) ? 'late' : ''} /><span><b>{formatDate(p.next_followup_at)}</b> Follow-up {p.nama_usaha}</span></button></li>)}
            </ul>
          </section>
        )}

        {d.produksi && d.produksi.jatuh_tempo.length > 0 && (
          <section className="pap-table-card pap-dash-card">
            <div className="pap-card-head"><div><h2>Produksi mendekati tanggal kirim</h2><p>Job yang belum selesai</p></div></div>
            <ul className="pap-dash-agenda">
              {d.produksi.jatuh_tempo.map((j) => <li key={j.id}><button onClick={() => onNavigate('Rencana Produksi')}><Factory /><span><b>{formatDate(j.due_date)}</b> {j.nomor} · {j.item_name}{j.customer ? ` · ${j.customer}` : ''}</span></button></li>)}
            </ul>
          </section>
        )}

        {d.meetings && d.meetings.length > 0 && (
          <section className="pap-table-card pap-dash-card">
            <div className="pap-card-head"><div><h2>Meeting 7 hari ke depan</h2></div></div>
            <ul className="pap-dash-agenda">
              {d.meetings.map((m) => <li key={m.id}><button onClick={() => onNavigate('Meeting', { meetingId: m.id })}><Handshake /><span><b>{formatDate(m.waktu, true)}</b> {m.judul}{m.tempat ? ` · ${m.tempat}` : ''}</span></button></li>)}
            </ul>
          </section>
        )}

        {d.plannings && d.plannings.length > 0 && (
          <section className="pap-table-card pap-dash-card">
            <div className="pap-card-head"><div><h2>Planning saya</h2><p>Sebagai PIC</p></div></div>
            <ul className="pap-dash-agenda">
              {d.plannings.map((p) => <li key={p.id}><button onClick={() => onNavigate('Planning', { planningId: p.id })}><ListChecks /><span><b>{formatDate(p.tanggal_selesai)}</b> {p.judul}</span><Progress value={p.progress} /></button></li>)}
            </ul>
          </section>
        )}
        {d.meetings && !d.meetings.length && d.plannings && !d.plannings.length && !d.marketing && !d.produksi && !sales && (
          <section className="pap-table-card pap-dash-card"><div className="pap-empty"><CalendarDays /> Tidak ada meeting atau planning yang menunggu Anda.</div></section>
        )}
      </div>
    </>
  )
}
