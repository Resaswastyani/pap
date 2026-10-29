'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Banknote, CalendarClock, CheckCircle2, ChevronRight, CircleAlert, Landmark, ShoppingCart, TrendingUp, Trophy, Users } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { formatRupiah } from './accurate'
import { MonthNav, monthLabel } from './accurate-production'
import { BarList, ColumnChart } from './charts'
import type { DashboardTarget } from './dashboard-page'
import { formatDate, Notice } from './ui'
import { ArrangeButton, ArrangeGrid, useArrange } from './arrange'

// Monitoring Top Management: performa perusahaan, performa divisi, plan monitoring & koordinasi, KPI
type Section<T> = { ok: true; data: T } | { ok: false; error: string }
type Tone = 'ok' | 'warn' | 'bad'
type Res = {
  periode: string
  perusahaan: Section<{
    berjalan: boolean; sampai_tanggal: string; penjualan: { omzet: number; faktur: number; customer: number; bulan_lalu: number; tahun_lalu: number; target: number | null }
    so: { jumlah: number; nilai: number; customer: number; customer_baru: number }; trend: { bulan: string; omzet: number; so: number }[]; target: Record<string, number>
  }>
  keuangan: Section<{
    laba_rugi: { pendapatan: number; hpp: number; laba_kotor: number; biaya: number; laba_usaha: number; laba_bersih: number; margin_kotor: number | null; margin_bersih: number | null }
    kas: number; piutang: { total: number; jatuh_tempo: number; lewat_60: number; faktur: number }; hutang: { total: number; jatuh_tempo: number; faktur: number }
  }>
  divisi: Section<{ key: string; nama: string; menu: string; status: Tone; catatan: string[]; metrics: { label: string; value: string; tone?: Tone; hint?: string }[] }[]>
  planning: Section<{
    divisi: { divisi: string; aktif: number; terlambat: number; progress: number }[]
    terlambat: { id: number; nomor: string | null; judul: string; divisi: string; selesai: string; progress: number; status: string; lewat: number }[]
    meeting: { id: number; judul: string; waktu: string; tempat: string | null; peserta: number }[]
  }>
  kpi: Section<{
    karyawan: { divisi: string; dinilai: number; rata: number; pembinaan: number }[]; terbaik: { nama: string; divisi: string | null; skor: number }[]
    pembinaan: { nama: string; divisi: string | null; skor: number; tindak_lanjut: string | null }[]; marketing: { nama: string; lead: number; visit: number; nilai: number }[]
  }>
}
const STATUS: Record<Tone, [string, string]> = { ok: ['Sehat', 'success'], warn: ['Perlu perhatian', 'warning'], bad: ['Kritis', 'danger'] }
const thisMonth = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7)
const shortRp = (v: number) => (Math.abs(v) >= 1e9 ? `Rp ${(v / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M` : Math.abs(v) >= 1e6 ? `Rp ${(v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt` : formatRupiah(v))
function Delta({ now, before, label }: { now: number; before: number; label: string }) {
  if (!before) return <small className="neutral">{label}: —</small>
  const pct = ((now - before) / before) * 100
  return <small className={pct >= 0 ? 'pap-text-success' : 'pap-text-danger'}>{pct >= 0 ? <ArrowUpRight /> : <ArrowDownRight />} {Math.abs(pct).toFixed(1).replace('.', ',')}% {label}</small>
}
const Err = ({ s }: { s: { ok: false; error: string } }) => <div className="pap-empty">{s.error}</div>

export function MonitoringPage({ onNavigate }: { user: UserProfile; onNavigate: (menu: string, target?: DashboardTarget) => void }) {
  const [periode, setPeriode] = useState(thisMonth)
  const [data, setData] = useState<Res | null>(null)
  const [error, setError] = useState('')
  // Susunan kartu (urutan & yang disembunyikan) per user
  const arrange = useArrange('monitoring')
  useEffect(() => {
    let alive = true
    setData(null)
    fetch(`/api/monitoring?periode=${periode}`).then(async (r) => {
      const j = await r.json()
      if (!alive) return
      if (!r.ok) setError(j.error ?? 'Gagal memuat monitoring.')
      else { setData(j); setError('') }
    }).catch(() => alive && setError('Gagal memuat monitoring.'))
    return () => { alive = false }
  }, [periode])
  const p = data?.perusahaan.ok ? data.perusahaan.data : null
  const k = data?.keuangan.ok ? data.keuangan.data : null
  const divs = data?.divisi.ok ? data.divisi.data : null
  const counts = divs ? { bad: divs.filter((d) => d.status === 'bad').length, warn: divs.filter((d) => d.status === 'warn').length } : null

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">TOP MANAGEMENT</p>
          <h1>Monitoring</h1>
          <span>Analisa performa perusahaan, monitoring performa tiap divisi, plan monitoring & koordinasi, dan KPI dalam satu halaman. {p?.berjalan ? `Bulan berjalan dibandingkan pada tanggal 1–${Number(p.sampai_tanggal.slice(8, 10))}.` : ''}</span>
        </div>
        <div className="pap-inline-actions pap-wrap">
          {data && <ArrangeButton arrange={arrange} hiddenCount={arrange.layout.hidden.length} />}
          <MonthNav periode={periode} onChange={setPeriode} />
        </div>
      </div>
      {arrange.editing && <Notice kind="success" onClose={() => arrange.setEditing(false)}>Seret kartu (atau pakai tombol ↑ ↓) untuk mengubah urutan, dan klik Sembunyikan untuk kartu yang tidak diperlukan. Susunan tersimpan otomatis untuk akun Anda.</Notice>}
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {!data && !error && <div className="pap-table-card"><div className="pap-empty">Mengumpulkan data semua divisi (±10–30 detik bila laporan Accurate belum tersimpan)...</div></div>}

      {data && (
        <>
          {/* ---------- Performa perusahaan ---------- */}
          <div className="pap-stat-grid four">
            <div className="pap-stat-card">
              <div><span>Penjualan (faktur) {monthLabel(periode)}</span><strong className="pap-stat-text">{p ? shortRp(p.penjualan.omzet) : '—'}</strong>
                {p && <Delta now={p.penjualan.omzet} before={p.penjualan.bulan_lalu} label="vs bulan lalu" />}
                {p && <Delta now={p.penjualan.omzet} before={p.penjualan.tahun_lalu} label="vs tahun lalu" />}
              </div>
              <div className="pap-stat-icon stat-1"><TrendingUp /></div>
            </div>
            <div className="pap-stat-card">
              <div><span>Sales order baru</span><strong className="pap-stat-text">{p ? shortRp(p.so.nilai) : '—'}</strong><small className="neutral">{p ? `${p.so.jumlah} SO · ${p.so.customer} customer · ${p.so.customer_baru} customer baru` : ''}</small></div>
              <div className="pap-stat-icon stat-0"><ShoppingCart /></div>
            </div>
            <div className="pap-stat-card">
              <div><span>Laba bersih (Accurate)</span><strong className="pap-stat-text">{k ? shortRp(k.laba_rugi.laba_bersih) : '—'}</strong><small className="neutral">{k ? `Margin kotor ${String(k.laba_rugi.margin_kotor ?? '—').replace('.', ',')}% · bersih ${String(k.laba_rugi.margin_bersih ?? '—').replace('.', ',')}%` : !data.keuangan.ok ? data.keuangan.error : ''}</small></div>
              <div className="pap-stat-icon stat-1"><Banknote /></div>
            </div>
            <div className="pap-stat-card">
              <div><span>Kas & bank</span><strong className="pap-stat-text">{k ? shortRp(k.kas) : '—'}</strong><small className="neutral">{k ? `Piutang ${shortRp(k.piutang.total)} · hutang ${shortRp(k.hutang.total)}` : ''}</small></div>
              <div className="pap-stat-icon stat-0"><Landmark /></div>
            </div>
          </div>

          <ArrangeGrid arrange={arrange} className="pap-dash-grid pap-mon-arrange">
            <section key="tren" data-title="Tren penjualan 12 bulan" className="pap-table-card pap-dash-card">
              <div className="pap-card-head"><div><h2>Tren penjualan 12 bulan</h2><p>Faktur penjualan (batang) · nilai SO baru ada di detail tiap bulan</p></div></div>
              {p ? (
                <div className="pap-dash-body">
                  <ColumnChart ariaLabel="Grafik omzet faktur 12 bulan" format={shortRp}
                    data={p.trend.map((t, i) => ({ key: t.bulan, label: monthLabel(t.bulan), value: t.omzet, partial: i === p.trend.length - 1 && p.berjalan, detail: <><span>Faktur: {shortRp(t.omzet)}</span><span>SO baru: {shortRp(t.so)}</span></> }))} />
                </div>
              ) : !data.perusahaan.ok && <Err s={data.perusahaan} />}
            </section>
            <section key="keuangan" data-title="Keuangan" className="pap-table-card pap-dash-card">
              <div className="pap-card-head"><div><h2>Keuangan</h2><p>Laba rugi bulan ini, piutang & hutang (Accurate)</p></div></div>
              {k ? (
                <dl className="pap-mon-list">
                  <div><dt>Pendapatan</dt><dd>{shortRp(k.laba_rugi.pendapatan)}{p?.target.pendapatan ? <small> target {shortRp(p.target.pendapatan)} ({Math.round((k.laba_rugi.pendapatan / p.target.pendapatan) * 100)}%)</small> : null}</dd></div>
                  <div><dt>Laba kotor</dt><dd>{shortRp(k.laba_rugi.laba_kotor)}</dd></div>
                  <div><dt>Laba usaha</dt><dd>{shortRp(k.laba_rugi.laba_usaha)}</dd></div>
                  <div><dt>Piutang jatuh tempo</dt><dd className={k.piutang.lewat_60 ? 'pap-text-danger' : ''}>{shortRp(k.piutang.jatuh_tempo)}<small> {k.piutang.faktur} faktur · &gt;60 hari {shortRp(k.piutang.lewat_60)}</small></dd></div>
                  <div><dt>Hutang jatuh tempo</dt><dd>{shortRp(k.hutang.jatuh_tempo)}<small> dari {shortRp(k.hutang.total)} ({k.hutang.faktur} faktur)</small></dd></div>
                  <div className="pap-mon-links"><button className="pap-link-button" onClick={() => onNavigate('Laporan Keuangan')}>Laporan keuangan <ChevronRight /></button><button className="pap-link-button" onClick={() => onNavigate('Piutang Customer')}>Piutang <ChevronRight /></button></div>
                </dl>
              ) : !data.keuangan.ok && <Err s={data.keuangan} />}
            </section>

          {/* ---------- Performa divisi ---------- */}
            <section key="divisi" data-title="Performa divisi" className="pap-table-card pap-dash-card wide">
            <div className="pap-card-head">
              <div><h2>Performa divisi</h2><p>{counts ? (counts.bad || counts.warn ? `${counts.bad} divisi kritis · ${counts.warn} perlu perhatian` : 'Semua divisi dalam kondisi sehat') : ''}</p></div>
            </div>
            {divs ? (
              <div className="pap-mon-divs">
                {divs.map((d) => (
                  <section key={d.key} className={`pap-mon-div ${d.status}`}>
                    <header><h3>{d.nama}</h3><span className={`pap-status ${STATUS[d.status][1]}`}>{STATUS[d.status][0]}</span></header>
                    <ul>
                      {d.metrics.map((m) => (
                        <li key={m.label} className={m.tone ?? ''} title={m.hint}>
                          <span>{m.tone === 'bad' ? <CircleAlert /> : m.tone === 'warn' ? <AlertTriangle /> : null}{m.label}</span><b>{m.value}</b>
                          {m.hint && <small>{m.hint}</small>}
                        </li>
                      ))}
                    </ul>
                    {d.catatan.map((c) => <p key={c} className="pap-muted">{c}</p>)}
                    <button className="pap-link-button" onClick={() => onNavigate(d.menu)}>Buka {d.menu} <ChevronRight /></button>
                  </section>
                ))}
              </div>
            ) : !data.divisi.ok && <Err s={data.divisi} />}
            </section>

          {/* ---------- Plan monitoring & koordinasi ---------- */}
            <section key="planning" data-title="Plan monitoring" className="pap-table-card pap-dash-card">
              <div className="pap-card-head"><div><h2>Plan monitoring</h2><p>Planning aktif per divisi dan yang melewati target selesai</p></div><button className="pap-link-button" onClick={() => onNavigate('Planning')}>Planning <ChevronRight /></button></div>
              {data.planning.ok ? (
                <>
                  <div className="pap-table-wrap">
                    <table>
                      <thead><tr><th>Divisi</th><th className="pap-num">Aktif</th><th className="pap-num">Terlambat</th><th className="pap-num">Progress</th></tr></thead>
                      <tbody>{data.planning.data.divisi.map((r) => <tr key={r.divisi}><td>{r.divisi}</td><td className="pap-num">{r.aktif}</td><td className={`pap-num ${r.terlambat ? 'pap-text-danger' : ''}`}>{r.terlambat}</td><td className="pap-num">{r.progress}%</td></tr>)}</tbody>
                    </table>
                    {!data.planning.data.divisi.length && <div className="pap-empty">Tidak ada planning aktif.</div>}
                  </div>
                  {data.planning.data.terlambat.length > 0 && (
                    <ul className="pap-mon-late">
                      {data.planning.data.terlambat.map((t) => (
                        <li key={t.id}><button className="pap-link-button" onClick={() => onNavigate('Planning', { planningId: t.id })}>{t.judul}</button><span>{t.divisi} · target {formatDate(t.selesai)} · progress {t.progress}%</span><b className="pap-text-danger">+{t.lewat} hari</b></li>
                      ))}
                    </ul>
                  )}
                </>
              ) : <Err s={data.planning} />}
            </section>
            <section key="koordinasi" data-title="Koordinasi 7 hari ke depan" className="pap-table-card pap-dash-card">
              <div className="pap-card-head"><div><h2>Koordinasi 7 hari ke depan</h2><p>Meeting lintas divisi yang dijadwalkan</p></div><button className="pap-link-button" onClick={() => onNavigate('Meeting')}>Meeting <ChevronRight /></button></div>
              {data.planning.ok ? (
                data.planning.data.meeting.length ? (
                  <ul className="pap-mon-late">
                    {data.planning.data.meeting.map((m) => (
                      <li key={m.id}><button className="pap-link-button" onClick={() => onNavigate('Meeting', { meetingId: m.id })}><CalendarClock /> {m.judul}</button><span>{formatDate(m.waktu, true)}{m.tempat ? ` · ${m.tempat}` : ''}</span><b>{m.peserta} peserta</b></li>
                    ))}
                  </ul>
                ) : <div className="pap-empty">Belum ada meeting terjadwal minggu ini.</div>
              ) : <Err s={data.planning} />}
            </section>

          {/* ---------- KPI ---------- */}
            <section key="kpi-karyawan" data-title="KPI karyawan per divisi" className="pap-table-card pap-dash-card">
              <div className="pap-card-head"><div><h2>KPI karyawan per divisi</h2><p>Rata-rata skor {monthLabel(periode)} (0–100)</p></div><button className="pap-link-button" onClick={() => onNavigate('KPI Karyawan')}>KPI Karyawan <ChevronRight /></button></div>
              {data.kpi.ok ? (
                <div className="pap-dash-body">
                  <BarList items={data.kpi.data.karyawan.map((r) => ({ key: r.divisi, label: `${r.divisi} (${r.dinilai})`, value: r.rata, display: `${String(r.rata).replace('.', ',')}${r.pembinaan ? ` · ${r.pembinaan} pembinaan` : ''}`, tone: r.rata < 70 ? 'critical' : 's1' }))} max={100} />
                  <div className="pap-mon-kpi">
                    <div><h3><Trophy /> Skor tertinggi</h3><ol>{data.kpi.data.terbaik.map((x, i) => <li key={`${x.nama}-${i}`}>{x.nama} <small>{x.divisi}</small> <b>{String(x.skor).replace('.', ',')}</b></li>)}</ol></div>
                    <div><h3><AlertTriangle /> Perlu pembinaan</h3>{data.kpi.data.pembinaan.length ? <ol>{data.kpi.data.pembinaan.map((x, i) => <li key={`${x.nama}-${i}`} title={x.tindak_lanjut ?? 'Belum ada tindak lanjut'}>{x.nama} <small>{x.divisi}</small> <b className="pap-text-danger">{String(x.skor).replace('.', ',')}</b></li>)}</ol> : <p className="pap-muted">Tidak ada.</p>}</div>
                  </div>
                </div>
              ) : <Err s={data.kpi} />}
            </section>
            <section key="kpi-marketing" data-title="KPI marketing" className="pap-table-card pap-dash-card">
              <div className="pap-card-head"><div><h2>KPI marketing</h2><p>Per sales di {monthLabel(periode)}</p></div><button className="pap-link-button" onClick={() => onNavigate('KPI Marketing')}>KPI Marketing <ChevronRight /></button></div>
              {data.kpi.ok ? (
                <div className="pap-table-wrap">
                  <table>
                    <thead><tr><th>Sales</th><th className="pap-num">Lead</th><th className="pap-num">Visit</th><th className="pap-num">Deal</th></tr></thead>
                    <tbody>{data.kpi.data.marketing.map((m, i) => <tr key={`${m.nama}-${i}`}><td><Users className="pap-inline-icon" /> {m.nama}</td><td className="pap-num">{m.lead}</td><td className="pap-num">{m.visit}</td><td className="pap-num pap-nowrap">{m.nilai ? shortRp(m.nilai) : '—'}</td></tr>)}</tbody>
                  </table>
                  {!data.kpi.data.marketing.length && <div className="pap-empty">Belum ada user marketing aktif.</div>}
                </div>
              ) : <Err s={data.kpi} />}
            </section>
          </ArrangeGrid>
          {counts && !counts.bad && !counts.warn && <p className="pap-muted"><CheckCircle2 className="pap-inline-icon" /> Tidak ada catatan kritis.</p>}
        </>
      )}
    </>
  )
}
