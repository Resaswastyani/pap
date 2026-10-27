'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Award, CalendarClock, CalendarDays, ClipboardList, Factory, FlaskConical, Handshake, ListChecks, MapPin, Palette, Repeat, Target, TrendingDown, TrendingUp, UserCheck, Users, UserX } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { formatRupiah } from './accurate'
import { BarList, ColumnChart, dayNumber, Gantt, todayNumber, useMediaQuery, type GanttBar, type GanttRow } from './charts'
import { api, formatDate, Notice, Progress } from './ui'
import { SECTORS, type SectorKey } from '@/lib/sectors'

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
  repeat?: {
    waktunya: number; berisiko: number; followup: number; tim: boolean
    list: { id: number; name: string; bill_city: string | null; status: 'berisiko' | 'waktunya'; last_order: string | null; perkiraan_order: string | null; hari_terlambat: number; order_count: number; maintenance_name: string | null }[]
  }
  leads?: { minggu_ini: number; bulan_ini: number; belum_dibagi: number; sumber: { sumber: string; jumlah: number }[] }
  konten?: { items: { id: number; judul: string; platform: string; jenis: string; jadwal_tayang: string; status: string }[]; tayang: number; rencana: number; leads: number }
  fokus?: 'digital' | 'development' | 'maintenance' | null
  kpi?: { periode: string; nilai?: Record<string, number>; target: Record<string, number> }
  penjualan?: { omzet_bulan_lalu_sd_hari_ini: number; bulan: { bulan: string; omzet: number; faktur: number; customer: number }[]; sektor: { bulan: string; sektor: string; omzet: number; faktur: number; customer: number }[]; top: { name: string; omzet: number }[]; top_sektor: { sektor: string; name: string; omzet: number }[]; so: { jumlah: number; nilai: number } }
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
  karyawan?: { aktif: number; tetap: number; kontrak: number; percobaan: number; percobaan_berakhir: number; divisi: { divisi: string; jumlah: number }[] }
  absensi?: {
    tanggal: string; hari: AttendanceCounts; harian: (AttendanceCounts & { tanggal: string })[]; bulan: AttendanceCounts & { terlambat_menit: number }
    divisi: { divisi: string; hadir: number; wajib: number }[]
    perhatian: { nip: string; nama: string; divisi: string | null; kali: number; menit: number; absen: number }[]
  } | null
  grade?: { rata: number | null; distribusi: { grade: string; jumlah: number; rata: number | null }[]; divisi: { divisi: string; rata: number; jumlah: number }[]; top: { nama: string; divisi: string | null; grade: string | null; nilai: number }[] }
}
type AttendanceCounts = { hadir: number; terlambat: number; tidak_hadir: number; izin: number; sakit: number; cuti: number; belum_scan: number; libur: number }
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
// Absensi: segmen grafik kehadiran harian (hadir = tepat waktu)
const ATTENDANCE_PARTS: { key: keyof AttendanceCounts; label: string; tone: string }[] = [
  { key: 'hadir', label: 'Tepat waktu', tone: 's3' }, { key: 'terlambat', label: 'Terlambat', tone: 's2' },
  { key: 'izin', label: 'Izin / dinas', tone: 's1' }, { key: 'sakit', label: 'Sakit', tone: 's5' }, { key: 'cuti', label: 'Cuti', tone: 's4' },
  { key: 'tidak_hadir', label: 'Tidak hadir', tone: 'crit' },
]
const GRADE_TONE: Record<string, 's1' | 's2' | 's3' | 'muted'> = { A: 's3', B: 's1', C: 's2' }
const wajibOf = (c: AttendanceCounts) => c.hadir + c.terlambat + c.tidak_hadir
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)
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
  // Filter sektor pada kartu penjualan (klik legenda / daftar per sektor); null = semua sektor
  const [sektor, setSektor] = useState<SectorKey | null>(null)
  // Filter status pada grafik kehadiran (klik legenda / daftar per status); null = semua status
  const [absenStatus, setAbsenStatus] = useState<keyof AttendanceCounts | null>(null)
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
  // Omzet per sektor: kunci "bulan|sektor"
  const bySector = new Map(sales?.sektor.map((r) => [`${r.bulan}|${r.sektor}`, r]))
  const sectorNow = SECTORS.map((s) => ({ ...s, row: bySector.get(`${months[11]}|${s.key}`) }))
  const picked = sektor ? SECTORS.find((s) => s.key === sektor)! : null
  const pickToggle = (key: SectorKey) => setSektor((cur) => (cur === key ? null : key))
  // Angka bulan / 12 bulan mengikuti sektor terpilih
  const rowOf = (m: string) => (sektor ? bySector.get(`${m}|${sektor}`) : byMonth.get(m))
  const shownNow = rowOf(months[11])
  const shownTotal12 = months.reduce((sum, m) => sum + (rowOf(m)?.omzet ?? 0), 0)
  const shownAvg = months.slice(0, 11).reduce((sum, m) => sum + (rowOf(m)?.omzet ?? 0), 0) / 11
  const shownTop = sektor ? (sales?.top_sektor ?? []).filter((t) => t.sektor === sektor) : sales?.top ?? []
  const shownTopMax = Math.max(1, ...shownTop.map((t) => t.omzet))
  const dayToday = todayNumber()
  const gantt = narrow ? GANTT_NARROW : GANTT_WIDE
  const ganttStart = dayToday - gantt.before
  const funnelTotal = d.marketing ? FUNNEL.reduce((sum, [k]) => sum + (d.marketing!.funnel[k] ?? 0), 0) : 0
  const empty = data && !Object.keys(data).filter((k) => k !== 'fokus').length

  // Tile ringkasan; urutannya mengikuti fokus divisi marketing (Digital: lead & konten, Development: pipeline, Maintenance: repeat order)
  const canVisit = user.menus.includes('visit')
  const allTiles: [string, React.ReactNode | false | undefined][] = [
    ['lead-minggu', d.leads && <Tile label="Lead masuk minggu ini" value={d.leads.minggu_ini} note={`${d.leads.bulan_ini} bulan ini`} icon={Target} onClick={() => onNavigate('Prospek')} />],
    ['lead-dibagi', d.leads && <Tile label="Lead belum dibagi" value={d.leads.belum_dibagi} note="Perlu dibagikan ke sales" icon={Target} tone={d.leads.belum_dibagi ? 'stat-2' : 'stat-0'} onClick={() => onNavigate('Prospek')} />],
    ['konten', d.konten && <Tile label="Konten bulan ini" value={d.konten.tayang} note={`tayang · ${d.konten.rencana} direncanakan`} icon={CalendarDays} onClick={() => onNavigate('Kalender Konten')} />],
    ['repeat', d.repeat && <Tile label="Customer perlu dihubungi" value={d.repeat.waktunya + d.repeat.berisiko} note={`${d.repeat.berisiko} berisiko berhenti order`} icon={Repeat} tone={d.repeat.berisiko ? 'stat-2' : 'stat-0'} onClick={() => onNavigate('Repeat Order')} />],
    ['followup', d.marketing && d.fokus !== 'digital' && <Tile label="Follow-up hari ini" value={d.marketing.followup_saya} note={d.marketing.followup_terlambat ? `${d.marketing.followup_terlambat} terlambat` : 'Prospek pegangan Anda'} icon={CalendarClock} tone={d.marketing.followup_terlambat ? 'stat-2' : 'stat-1'} onClick={() => onNavigate('Prospek')} />],
    ['visit', d.marketing && canVisit && <Tile label="Visit hari ini" value={d.marketing.visits.length} note={`${d.marketing.prospek_aktif} prospek aktif${d.marketing.tim && d.marketing.belum_dibagi ? ` · ${d.marketing.belum_dibagi} belum dibagi` : ''}`} icon={MapPin} onClick={() => onNavigate('Jadwal Visit')} />],
    ['persetujuan', !!d.quotation?.persetujuan && <Tile label="Quotation perlu persetujuan" value={d.quotation!.persetujuan} note="menunggu persetujuan Anda" icon={ClipboardList} tone="stat-2" onClick={() => onNavigate('Quotation')} />],
    ['quotation', d.quotation && <Tile label="Penawaran menunggu" value={d.quotation.menunggu} note={`${formatRupiah(d.quotation.nilai_menunggu)}${d.quotation.draft ? ` · ${d.quotation.draft} draft` : ''}`} icon={ClipboardList} onClick={() => onNavigate('Quotation')} />],
    ['sample', d.sample && <Tile label="Request sample" value={d.sample.todo} note={`perlu tindakan · ${d.sample.aktif} berjalan`} icon={FlaskConical} tone={d.sample.todo ? 'stat-2' : 'stat-0'} onClick={() => onNavigate('Request Sample')} />],
    ['desain', d.desain && <Tile label="Request desain" value={d.desain.todo} note={`perlu tindakan · ${d.desain.aktif} berjalan`} icon={Palette} tone={d.desain.todo ? 'stat-2' : 'stat-0'} onClick={() => onNavigate('Request Desain')} />],
    ['produksi', d.produksi && <Tile label="Produksi berjalan" value={d.produksi.berjalan} note={`${d.produksi.menunggu} menunggu · ${d.produksi.dijadwalkan} terjadwal`} icon={Factory} onClick={() => onNavigate('Rencana Produksi')} />],
    ['karyawan', d.karyawan && <Tile label="Karyawan aktif" value={d.karyawan.aktif} note={`${d.karyawan.tetap} tetap · ${d.karyawan.kontrak} kontrak · ${d.karyawan.percobaan} percobaan`} icon={Users} onClick={() => onNavigate('Karyawan')} />],
    ['hadir', d.absensi && <Tile label={`Hadir · ${formatDate(d.absensi.tanggal)}`} value={`${d.absensi.hari.hadir + d.absensi.hari.terlambat}/${wajibOf(d.absensi.hari) + d.absensi.hari.belum_scan}`} note={`${pct(d.absensi.hari.hadir + d.absensi.hari.terlambat, wajibOf(d.absensi.hari) + d.absensi.hari.belum_scan)}% hadir · ${d.absensi.hari.terlambat} terlambat${d.absensi.hari.belum_scan ? ` · ${d.absensi.hari.belum_scan} belum scan` : ''}`} icon={UserCheck} tone="stat-0" onClick={() => onNavigate('Absensi')} />],
    ['absen', d.absensi && <Tile label="Tidak hadir" value={d.absensi.hari.tidak_hadir} note={`${d.absensi.hari.izin + d.absensi.hari.sakit + d.absensi.hari.cuti} izin / sakit / cuti`} icon={UserX} tone={d.absensi.hari.tidak_hadir ? 'stat-2' : 'stat-0'} onClick={() => onNavigate('Absensi')} />],
    ['grade', d.grade && <Tile label="Rata-rata nilai grade" value={d.grade.rata === null ? '—' : d.grade.rata.toFixed(1)} note={['A', 'B', 'C'].map((g) => `${d.grade!.distribusi.find((x) => x.grade === g)?.jumlah ?? 0} grade ${g}`).join(' · ')} icon={Award} onClick={() => onNavigate('Grade & Gaji')} />],
    ['produksi-telat', d.produksi && <Tile label="Produksi lewat tenggat" value={d.produksi.terlambat} note={`${d.produksi.selesai_bulan_ini} selesai bulan ini`} icon={AlertTriangle} tone={d.produksi.terlambat ? 'stat-2' : 'stat-0'} onClick={() => onNavigate('Rencana Produksi')} />],
  ]
  const PRIORITY: Record<string, string[]> = {
    digital: ['lead-minggu', 'lead-dibagi', 'konten', 'desain', 'quotation'],
    development: ['followup', 'visit', 'quotation', 'sample', 'desain'],
    maintenance: ['repeat', 'followup', 'visit', 'quotation'],
  }
  const order = PRIORITY[d.fokus ?? ''] ?? []
  const rank = (key: string) => (order.includes(key) ? order.indexOf(key) : order.length + allTiles.findIndex(([k]) => k === key))
  const tiles = allTiles.filter((t): t is [string, React.ReactNode] => !!t[1]).sort((a, b) => rank(a[0]) - rank(b[0]))

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

      {!!tiles.length && <div className="pap-stat-grid four pap-dash-tiles">{tiles.map(([key, node]) => <span key={key} className="pap-dash-tile">{node}</span>)}</div>}

      <div className="pap-dash-grid">
        {/* Marketing Maintenance: customer yang waktunya order ulang / berisiko berhenti order */}
        {d.fokus === 'maintenance' && d.repeat && (
          <section className="pap-table-card pap-dash-card wide">
            <div className="pap-card-head"><div><h2>Customer perlu dihubungi</h2><p>{d.repeat.berisiko} berisiko berhenti order · {d.repeat.waktunya} waktunya order ulang{d.repeat.tim ? '' : ' · customer pegangan Anda'}</p></div><button className="pap-btn" onClick={() => onNavigate('Repeat Order')}>Repeat Order</button></div>
            {d.repeat.list.length ? (
              <ul className="pap-dash-agenda">
                {d.repeat.list.map((c) => (
                  <li key={c.id}>
                    <button onClick={() => onNavigate('Repeat Order')}>
                      <Repeat className={c.status === 'berisiko' ? 'late' : ''} />
                      <span><b>{c.name}</b>{c.bill_city ? ` · ${c.bill_city}` : ''} · order terakhir {formatDate(c.last_order)}{c.hari_terlambat > 0 ? ` · lewat ${c.hari_terlambat} hari dari perkiraan` : ` · perkiraan ${formatDate(c.perkiraan_order)}`}</span>
                      <span className={`pap-status ${c.status === 'berisiko' ? 'danger' : 'warning'}`}>{c.status === 'berisiko' ? 'Berisiko' : 'Waktunya'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <div className="pap-empty">Semua customer aman, belum ada yang perlu dihubungi.</div>}
          </section>
        )}
        {/* Marketing Digital: sumber lead & jadwal konten */}
        {d.leads && (
          <section className="pap-table-card pap-dash-card">
            <div className="pap-card-head"><div><h2>Sumber lead</h2><p>Prospek masuk 30 hari terakhir · {d.leads.bulan_ini} bulan ini</p></div><button className="pap-btn" onClick={() => onNavigate('Prospek')}>Prospek</button></div>
            <div className="pap-dash-body">
              {d.leads.sumber.length ? <BarList items={d.leads.sumber.map((s) => ({ key: s.sumber, label: s.sumber, value: s.jumlah }))} /> : <p className="pap-muted">Belum ada lead 30 hari terakhir.</p>}
            </div>
          </section>
        )}
        {d.konten && (
          <section className="pap-table-card pap-dash-card">
            <div className="pap-card-head"><div><h2>Konten 7 hari ke depan</h2><p>Bulan ini {d.konten.tayang} tayang · {d.konten.rencana} direncanakan · {d.konten.leads} lead dari konten</p></div><button className="pap-btn" onClick={() => onNavigate('Kalender Konten')}>Kalender</button></div>
            {d.konten.items.length ? (
              <ul className="pap-dash-agenda">
                {d.konten.items.map((k) => <li key={k.id}><button onClick={() => onNavigate('Kalender Konten')}><CalendarDays /><span><b>{formatDate(k.jadwal_tayang, true)}</b> {k.judul} · {k.platform}</span><span className={`pap-status ${k.status === 'siap' ? 'success' : k.status === 'produksi' ? 'info' : 'neutral'}`}>{k.status}</span></button></li>)}
              </ul>
            ) : <div className="pap-empty">Belum ada konten terjadwal 7 hari ke depan.</div>}
          </section>
        )}
        {sales && (
          <section className="pap-table-card pap-dash-card wide">
            <div className="pap-card-head">
              <div><h2>Penjualan {picked ? `· ${picked.label}` : 'per sektor'} (faktur Accurate)</h2><p>Omzet per bulan{picked ? '' : ' per sektor customer'}, 12 bulan terakhir · bulan ini {shownNow ? `${shownNow.faktur} faktur, ${shownNow.customer} customer` : 'belum ada faktur'}</p></div>
              <div className="pap-dash-total">
                <small>Bulan ini{picked ? ` · ${picked.label}` : ''}</small>
                <strong>{formatRupiah(shownNow?.omzet ?? 0)}</strong>
                {picked && thisMonth?.omzet ? <span>{(((shownNow?.omzet ?? 0) / thisMonth.omzet) * 100).toFixed(0)}% dari omzet bulan ini</span> : growth !== null && <span className={growth >= 0 ? 'up' : 'down'}>{growth >= 0 ? <TrendingUp /> : <TrendingDown />} {growth >= 0 ? '+' : ''}{growth.toFixed(1)}% vs periode sama bulan lalu</span>}
              </div>
            </div>
            <div className="pap-dash-metrics">
              <div><span>Total 12 bulan{picked ? ` · ${picked.label}` : ''}</span><b>{formatRupiah(shownTotal12)}</b>{picked && total12 ? <small className="pap-muted"> {((shownTotal12 / total12) * 100).toFixed(0)}% dari total</small> : null}</div>
              <div><span>Rata-rata per bulan</span><b>{formatRupiah(shownAvg)}</b></div>
              <div><span>Sales order bulan ini{picked ? ' · semua sektor' : ''}</span><b>{sales.so.jumlah} SO · {shortRp(sales.so.nilai)}</b></div>
            </div>
            <ColumnChart
              ariaLabel={`Grafik omzet faktur ${picked ? `sektor ${picked.label}` : 'per sektor'}, 12 bulan terakhir`}
              format={shortRp}
              data={months.map((m, i) => {
                const b = rowOf(m)
                // Sektor terpilih: hanya seri itu (warna tetap warna sektornya)
                const parts = SECTORS.filter((s) => !sektor || s.key === sektor).map((s) => { const r = bySector.get(`${m}|${s.key}`); return { ...s, omzet: r?.omzet ?? 0, customer: r?.customer ?? 0 } })
                return {
                  key: m, label: monthLabel(m), value: b?.omzet ?? 0, partial: i === 11,
                  segments: parts.map((p) => ({ key: p.key, value: p.omzet, tone: p.tone })),
                  detail: <>{parts.filter((p) => p.omzet > 0 || sektor).map((p) => <span key={p.key}>{p.label}: {shortRp(p.omzet)} · {p.customer} customer</span>)}<span>{b?.faktur ?? 0} faktur{sektor ? '' : ` · ${b?.customer ?? 0} customer`}</span></>,
                }
              })}
            />
            <div className="pap-viz-legend" role="group" aria-label="Pilih sektor">
              {SECTORS.map((s) => (
                <button key={s.key} type="button" aria-pressed={sektor === s.key} className={sektor === s.key ? 'active' : sektor ? 'dim' : ''} onClick={() => pickToggle(s.key)}>
                  <i className={`swatch ${s.tone}`} />{s.label}
                </button>
              ))}
              {sektor ? <button type="button" className="pap-legend-reset" onClick={() => setSektor(null)}>Semua sektor</button> : <span>Klik sektor untuk menampilkan sektor itu saja</span>}
            </div>
            <div className="pap-dash-split">
              <div>
                <h3>Top customer bulan ini{picked ? ` · ${picked.label}` : ''}</h3>
                {shownTop.length
                  ? <BarList max={shownTopMax} items={shownTop.map((t) => ({ key: t.name, label: t.name, value: t.omzet, tone: picked?.tone, display: formatRupiah(t.omzet) }))} />
                  : <p className="pap-muted">Belum ada faktur{picked ? ` sektor ${picked.label}` : ''} bulan ini.</p>}
              </div>
              <div>
                <h3>Per sektor bulan ini</h3>
                {thisMonth?.omzet
                  ? <BarList max={thisMonth.omzet} items={sectorNow.map((s) => ({ key: s.key, label: sektor === s.key ? `${s.label} · dipilih` : s.label, value: s.row?.omzet ?? 0, tone: s.tone, onClick: () => pickToggle(s.key), display: `${shortRp(s.row?.omzet ?? 0)} · ${(((s.row?.omzet ?? 0) / thisMonth.omzet) * 100).toFixed(0)}%` }))} />
                  : <p className="pap-muted">Belum ada faktur bulan ini.</p>}
                <small className="pap-muted">Sektor dari kategori customer di Accurate (LAU, BRS, SU); kategori lain masuk Lainnya.</small>
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

        {d.absensi && (
          <section className="pap-table-card pap-dash-card wide">
            <div className="pap-card-head">
              <div><h2>Kehadiran karyawan</h2><p>{d.absensi.harian.length} hari kerja terakhir · data terakhir {formatDate(d.absensi.tanggal)}</p></div>
              <button className="pap-btn" onClick={() => onNavigate('Absensi')}>Absensi</button>
            </div>
            {(() => {
              const abs = d.absensi!
              const picked = ATTENDANCE_PARTS.find((a) => a.key === absenStatus) ?? null
              const parts = picked ? [picked] : ATTENDANCE_PARTS
              const totalBulan = ATTENDANCE_PARTS.reduce((sum, a) => sum + abs.bulan[a.key], 0)
              const toggle = (key: keyof AttendanceCounts) => setAbsenStatus((cur) => (cur === key ? null : key))
              return (
                <>
                  <div className="pap-dash-metrics">
                    {picked ? (
                      <>
                        <div><span>{picked.label} bulan ini</span><b>{abs.bulan[picked.key].toLocaleString('id-ID')} hari-orang</b>{totalBulan ? <small className="pap-muted"> {pct(abs.bulan[picked.key], totalBulan)}% dari semua catatan</small> : null}</div>
                        <div><span>{picked.label} · {formatDate(abs.tanggal)}</span><b>{abs.hari[picked.key]} orang</b></div>
                        <div><span>Rata-rata per hari kerja</span><b>{abs.harian.length ? (abs.harian.reduce((sum, h) => sum + h[picked.key], 0) / abs.harian.length).toLocaleString('id-ID', { maximumFractionDigits: 1 }) : 0} orang</b></div>
                      </>
                    ) : (
                      <>
                        <div><span>Tingkat kehadiran bulan ini</span><b>{pct(abs.bulan.hadir + abs.bulan.terlambat, wajibOf(abs.bulan))}%</b></div>
                        <div><span>Terlambat bulan ini</span><b>{abs.bulan.terlambat} kali · {abs.bulan.terlambat_menit.toLocaleString('id-ID')} menit</b></div>
                        <div><span>Tidak hadir · izin, sakit, cuti bulan ini</span><b>{abs.bulan.tidak_hadir} · {abs.bulan.izin + abs.bulan.sakit + abs.bulan.cuti}</b></div>
                      </>
                    )}
                  </div>
                  <ColumnChart
                    ariaLabel={`Grafik kehadiran karyawan per hari${picked ? `, status ${picked.label}` : ' per status'}`}
                    format={(v) => v.toLocaleString('id-ID')}
                    data={abs.harian.map((h) => ({
                      key: h.tanggal,
                      label: formatDate(h.tanggal).replace(/ \d{4}$/, ''),
                      value: parts.reduce((sum, a) => sum + h[a.key], 0),
                      segments: parts.map((a) => ({ key: a.key, value: h[a.key], tone: a.tone })),
                      detail: <>{parts.filter((a) => h[a.key] > 0 || picked).map((a) => <span key={a.key}>{a.label}: {h[a.key]} orang</span>)}<span>Kehadiran {pct(h.hadir + h.terlambat, wajibOf(h))}%</span></>,
                    }))}
                  />
                  <div className="pap-viz-legend" role="group" aria-label="Pilih status kehadiran">
                    {ATTENDANCE_PARTS.map((a) => (
                      <button key={a.key} type="button" aria-pressed={absenStatus === a.key} className={absenStatus === a.key ? 'active' : absenStatus ? 'dim' : ''} onClick={() => toggle(a.key)}>
                        <i className={`swatch ${a.tone}`} />{a.label}
                      </button>
                    ))}
                    {absenStatus ? <button type="button" className="pap-legend-reset" onClick={() => setAbsenStatus(null)}>Semua status</button> : <span>Klik status untuk menampilkan status itu saja</span>}
                  </div>
                  <div className="pap-dash-split">
                    <div>
                      <h3>Per status bulan ini</h3>
                      {totalBulan
                        ? <BarList max={Math.max(...ATTENDANCE_PARTS.map((a) => abs.bulan[a.key]))} items={ATTENDANCE_PARTS.map((a) => ({ key: a.key, label: absenStatus === a.key ? `${a.label} · dipilih` : a.label, value: abs.bulan[a.key], tone: a.tone === 'crit' ? 'critical' as const : a.tone as 's1' | 's2' | 's3' | 's4' | 's5', onClick: () => toggle(a.key), display: `${abs.bulan[a.key].toLocaleString('id-ID')} · ${pct(abs.bulan[a.key], totalBulan)}%` }))} />
                        : <p className="pap-muted">Belum ada data absensi bulan ini.</p>}
                    </div>
                    <div>
                      <h3>{formatDate(abs.tanggal)}{picked ? ` · ${picked.label}` : ''}</h3>
                      <BarList max={Math.max(1, ...ATTENDANCE_PARTS.map((a) => abs.hari[a.key]))} items={parts.map((a) => ({ key: a.key, label: a.label, value: abs.hari[a.key], tone: a.tone === 'crit' ? 'critical' as const : a.tone as 's1' | 's2' | 's3' | 's4' | 's5', onClick: () => toggle(a.key), display: `${abs.hari[a.key]} orang` }))} />
                      <small className="pap-muted">Hari terakhir yang sudah ada scan. Hari sesudahnya belum tersinkron dari mesin absen.</small>
                    </div>
                  </div>
                </>
              )
            })()}
          </section>
        )}
        {d.absensi && (
          <section className="pap-table-card pap-dash-card">
            <div className="pap-card-head"><div><h2>Kehadiran per divisi</h2><p>Bulan ini, dari hari wajib masuk · terendah di atas</p></div></div>
            <div className="pap-dash-body">
              {d.absensi.divisi.length
                ? <BarList max={100} items={d.absensi.divisi.map((v) => { const p = pct(v.hadir, v.wajib); return { key: v.divisi, label: v.divisi, value: p, tone: p < 85 ? 'critical' as const : 's3' as const, display: `${p}% · ${v.hadir}/${v.wajib} hari` } })} />
                : <p className="pap-muted">Belum ada data absensi bulan ini.</p>}
            </div>
          </section>
        )}
        {d.absensi && (
          <section className="pap-table-card pap-dash-card">
            <div className="pap-card-head"><div><h2>Perlu perhatian</h2><p>Paling sering tidak hadir / terlambat bulan ini</p></div><button className="pap-btn" onClick={() => onNavigate('Absensi')}>Rekap</button></div>
            {d.absensi.perhatian.length ? (
              <ul className="pap-dash-agenda">
                {d.absensi.perhatian.map((p) => (
                  <li key={p.nip}>
                    <button onClick={() => onNavigate('Absensi')}>
                      <UserX className={p.absen ? 'late' : ''} />
                      <span><b>{p.nama}</b>{p.divisi ? ` · ${p.divisi}` : ''}</span>
                      <span className={`pap-status ${p.absen ? 'danger' : 'warning'}`}>{[p.absen ? `${p.absen}× absen` : '', p.kali ? `${p.kali}× telat` : ''].filter(Boolean).join(' · ')}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <div className="pap-empty">Belum ada karyawan yang tidak hadir atau terlambat bulan ini.</div>}
          </section>
        )}
        {d.grade && (
          <section className="pap-table-card pap-dash-card">
            <div className="pap-card-head"><div><h2>Distribusi grade</h2><p>Karyawan aktif per grade{d.grade.rata !== null ? ` · rata-rata nilai ${d.grade.rata.toFixed(1)}` : ''}</p></div><button className="pap-btn" onClick={() => onNavigate('Grade & Gaji')}>Grade</button></div>
            <div className="pap-dash-body">
              <BarList items={[...d.grade.distribusi].sort((a, b) => (a.grade === '-' ? 1 : b.grade === '-' ? -1 : a.grade.localeCompare(b.grade))).map((g) => ({
                key: g.grade, label: g.grade === '-' ? 'Belum dinilai' : `Grade ${g.grade}`, value: g.jumlah, tone: GRADE_TONE[g.grade] ?? 'muted',
                display: `${g.jumlah} orang${g.rata !== null ? ` · nilai ${g.rata.toFixed(1)}` : ''}`,
              }))} />
              {d.grade.top.length > 0 && (
                <>
                  <h3 className="pap-dash-subhead">Nilai tertinggi</h3>
                  <BarList max={100} items={d.grade.top.map((t) => ({ key: t.nama, label: `${t.nama}${t.divisi ? ` · ${t.divisi}` : ''}`, value: t.nilai, tone: GRADE_TONE[t.grade ?? ''] ?? 'muted', display: `${t.nilai.toFixed(1)}${t.grade ? ` · ${t.grade}` : ''}` }))} />
                </>
              )}
            </div>
          </section>
        )}
        {d.grade && d.grade.divisi.length > 0 && (
          <section className="pap-table-card pap-dash-card">
            <div className="pap-card-head"><div><h2>Nilai grade per divisi</h2><p>Rata-rata nilai penilaian karyawan (skala 100)</p></div></div>
            <div className="pap-dash-body">
              <BarList max={100} items={d.grade.divisi.map((v) => ({ key: v.divisi, label: v.divisi, value: v.rata, tone: v.rata >= 80 ? 's3' as const : v.rata >= 70 ? 's1' as const : 's2' as const, display: `${v.rata.toFixed(1)} · ${v.jumlah} orang` }))} />
            </div>
          </section>
        )}
        {d.karyawan && (
          <section className="pap-table-card pap-dash-card">
            <div className="pap-card-head"><div><h2>Karyawan per divisi</h2><p>{d.karyawan.aktif} karyawan aktif{d.karyawan.percobaan_berakhir ? ` · ${d.karyawan.percobaan_berakhir} masa percobaan berakhir ≤ 30 hari` : ''}</p></div><button className="pap-btn" onClick={() => onNavigate('Karyawan')}>Karyawan</button></div>
            <div className="pap-dash-body">
              <BarList items={d.karyawan.divisi.map((v) => ({ key: v.divisi, label: v.divisi, value: v.jumlah, display: `${v.jumlah} orang` }))} />
            </div>
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
        {d.meetings && !d.meetings.length && d.plannings && !d.plannings.length && !d.marketing && !d.produksi && !sales && !d.absensi && !d.grade && !d.karyawan && (
          <section className="pap-table-card pap-dash-card"><div className="pap-empty"><CalendarDays /> Tidak ada meeting atau planning yang menunggu Anda.</div></section>
        )}
      </div>
    </>
  )
}
