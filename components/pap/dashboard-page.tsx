'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, CalendarClock, CalendarDays, ClipboardList, Factory, FlaskConical, Handshake, ListChecks, MapPin, Palette, Repeat, Target, TrendingDown, TrendingUp } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { formatRupiah } from './accurate'
import { api, formatDate, Notice, Progress } from './ui'

type Metric = { label: string; satuan: string }
type DashboardData = {
  marketing?: {
    followup_saya: number; followup_terlambat: number; prospek_aktif: number; belum_dibagi: number; tim: boolean
    visits: { id: number; jadwal: string; jenis: string; target: string | null; alamat: string | null }[]
    followups: { id: number; nama_usaha: string; next_followup_at: string; status: string }[]
  }
  quotation?: { menunggu: number; nilai_menunggu: number; draft: number; diterima_bulan_ini: number; persetujuan: number }
  repeat?: { waktunya: number; berisiko: number; followup: number; tim: boolean }
  kpi?: { periode: string; nilai?: Record<string, number>; target: Record<string, number> }
  penjualan?: { omzet_bulan_lalu_sd_hari_ini: number; bulan: { bulan: string; omzet: number; faktur: number; customer: number }[]; top: { name: string; omzet: number }[]; so: { jumlah: number; nilai: number } }
  produksi?: { menunggu: number; dijadwalkan: number; berjalan: number; terlambat: number; selesai_bulan_ini: number; jatuh_tempo: { id: number; nomor: string; item_name: string; due_date: string; status: string; customer: string | null }[] }
  sample?: { todo: number; aktif: number }
  desain?: { todo: number; aktif: number }
  meetings?: { id: number; judul: string; waktu: string; tempat: string | null }[]
  plannings?: { id: number; judul: string; tanggal_selesai: string; progress: number; status: string }[]
}
export type DashboardTarget = { prospectId?: number; visitId?: number; meetingId?: number; planningId?: number }

const KPI_LABEL: Record<string, Metric> = {
  leads: { label: 'Lead baru', satuan: '' }, followup: { label: 'Follow-up', satuan: '' }, visit: { label: 'Visit', satuan: '' },
  penawaran: { label: 'Penawaran', satuan: '' }, closing: { label: 'Closing', satuan: '' }, nilai: { label: 'Nilai deal', satuan: 'Rp' }, repeat: { label: 'Follow-up customer', satuan: '' },
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`
const shortRp = (v: number) => (v >= 1e9 ? `${(v / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 })} M` : v >= 1e6 ? `${(v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt` : v.toLocaleString('id-ID'))

function Tile({ label, value, note, icon: Icon, tone = 'stat-1', onClick }: { label: string; value: string | number; note?: string; icon: typeof Target; tone?: string; onClick?: () => void }) {
  return (
    <button className="pap-stat-card pap-stat-button" onClick={onClick} disabled={!onClick}>
      <div><span>{label}</span><strong>{value}</strong>{note && <small className="neutral">{note}</small>}</div>
      <div className={`pap-stat-icon ${tone}`}><Icon /></div>
    </button>
  )
}

export function DashboardPage({ user, onNavigate }: { user: UserProfile; onNavigate: (menu: string, target?: DashboardTarget) => void }) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { api<DashboardData>('/api/dashboard').then(setData).catch((e) => setError(e.message)) }, [])
  const hour = new Date().getHours()
  const salam = hour < 11 ? 'Selamat pagi' : hour < 15 ? 'Selamat siang' : hour < 19 ? 'Selamat sore' : 'Selamat malam'
  const today = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const d = data ?? {}
  const sales = d.penjualan
  const thisMonth = sales?.bulan.at(-1)
  // Dibanding bulan lalu pada tanggal yang sama (bulan berjalan belum penuh)
  const pembanding = sales?.omzet_bulan_lalu_sd_hari_ini ?? 0
  const growth = thisMonth && pembanding ? ((thisMonth.omzet - pembanding) / pembanding) * 100 : null
  const maxOmzet = Math.max(1, ...(sales?.bulan.map((b) => b.omzet) ?? [1]))
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
          {d.produksi && <Tile label="Produksi berjalan" value={d.produksi.berjalan} note={`${d.produksi.menunggu} menunggu · ${d.produksi.dijadwalkan} terjadwal`} icon={Factory} onClick={() => onNavigate('Jadwal Produksi')} />}
          {d.produksi && <Tile label="Produksi lewat tenggat" value={d.produksi.terlambat} note={`${d.produksi.selesai_bulan_ini} selesai bulan ini`} icon={AlertTriangle} tone={d.produksi.terlambat ? 'stat-2' : 'stat-0'} onClick={() => onNavigate('Jadwal Produksi')} />}
        </div>
      )}

      <div className="pap-dash-grid">
        {sales && (
          <section className="pap-table-card pap-dash-card wide">
            <div className="pap-card-head">
              <div><h2>Penjualan (faktur Accurate)</h2><p>6 bulan terakhir · bulan ini {thisMonth ? `${thisMonth.faktur} faktur, ${thisMonth.customer} customer` : 'belum ada faktur'}</p></div>
              <div className="pap-dash-total">
                <strong>{formatRupiah(thisMonth?.omzet ?? 0)}</strong>
                {growth !== null && <span className={growth >= 0 ? 'up' : 'down'}>{growth >= 0 ? <TrendingUp /> : <TrendingDown />} {growth.toFixed(1)}% vs periode sama bulan lalu</span>}
              </div>
            </div>
            <div className="pap-bars" role="img" aria-label="Grafik omzet 6 bulan">
              {sales.bulan.map((b) => (
                <div key={b.bulan} className="pap-bar" title={`${monthLabel(b.bulan)}: ${formatRupiah(b.omzet)}`}>
                  <span className="val">{shortRp(b.omzet)}</span>
                  <div className="fill" style={{ height: `${Math.max(3, (b.omzet / maxOmzet) * 100)}%` }} />
                  <span className="lbl">{monthLabel(b.bulan)}</span>
                </div>
              ))}
            </div>
            <div className="pap-dash-split">
              <div><h3>Top customer bulan ini</h3>
                <ol className="pap-dash-list">{sales.top.map((t) => <li key={t.name}><span>{t.name}</span><b>{formatRupiah(t.omzet)}</b></li>)}{!sales.top.length && <li className="pap-muted">Belum ada faktur bulan ini.</li>}</ol>
              </div>
              <div><h3>Sales order bulan ini</h3><p className="pap-dash-big">{sales.so.jumlah} SO · {formatRupiah(sales.so.nilai)}</p></div>
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
              {d.produksi.jatuh_tempo.map((j) => <li key={j.id}><button onClick={() => onNavigate('Jadwal Produksi')}><Factory /><span><b>{formatDate(j.due_date)}</b> {j.nomor} · {j.item_name}{j.customer ? ` · ${j.customer}` : ''}</span></button></li>)}
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
