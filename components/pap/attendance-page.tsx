'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CalendarDays, Clock3, FileSpreadsheet, Search, Upload, UserCheck, UserX } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { formatNumber, formatRupiah } from './accurate'
import { MonthNav, monthLabel } from './accurate-production'
import { ColumnChart } from './charts'
import { HrSheetSync } from './hrd-page'
import { api, formatDate, Modal, Notice, Pager, usePaged } from './ui'

// Absensi dari laporan kehadiran HRIS Altius (mesin Fingerspot): harian & rekap bulanan, terlambat, lembur, upah lembur

type Status = 'hadir' | 'terlambat' | 'tidak_hadir' | 'izin' | 'sakit' | 'cuti' | 'dinas' | 'libur' | 'tanpa_scan'
const STATUS_LABEL: Record<Status, string> = { hadir: 'Hadir', terlambat: 'Terlambat', tidak_hadir: 'Tidak hadir', izin: 'Izin', sakit: 'Sakit', cuti: 'Cuti', dinas: 'Dinas luar', libur: 'Libur', tanpa_scan: 'Scan tidak lengkap' }
const STATUS_TONE: Record<Status, string> = { hadir: 'success', terlambat: 'warning', tidak_hadir: 'danger', izin: 'info', sakit: 'info', cuti: 'info', dinas: 'info', libur: 'neutral', tanpa_scan: 'warning' }
type Day = {
  id: number; nip: string; nama: string; tanggal: string; shift: string | null; jadwal_masuk: string | null; jadwal_pulang: string | null; jam_masuk: string | null; jam_pulang: string | null
  scan: number | null; status: Status; status_asli: string | null; keterangan: string | null; terlambat_menit: number; pulang_cepat_menit: number; lembur_menit: number
  employee_id: number | null; divisi: string | null; jabatan: string | null
}
type Rekap = {
  nip: string; nama: string; employee_id: number | null; divisi: string | null; jabatan: string | null; hadir: number; terlambat: number; terlambat_menit: number; tidak_hadir: number
  izin: number; sakit: number; cuti: number; tanpa_scan: number; pulang_cepat_menit: number; lembur_menit: number; lembur_libur_menit: number; upah_lembur?: number | null
}
type Res = {
  periode: string; tanggal: string | null; months: string[]; daily: Day[]; rekap: Rekap[]; perDay: { tanggal: string; hadir: number; terlambat: number; tidak_hadir: number; izin: number }[]
  synced_at: string | null; can: { manage: boolean; payroll: boolean }
}

const hm = (t: string | null) => (t ? t.slice(0, 5) : '—')
const dur = (m: number) => (!m ? '—' : m < 60 ? `${m} mnt` : `${Math.floor(m / 60)} j${m % 60 ? ` ${m % 60} mnt` : ''}`)
const jam = (m: number) => formatNumber(m / 60, 1)

export function AbsensiPage(_props: { user: UserProfile }) {
  const [periode, setPeriode] = useState('')
  const [tanggal, setTanggal] = useState('')
  const [data, setData] = useState<Res | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [tab, setTab] = useState<'harian' | 'rekap'>('harian')
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (periode) params.set('periode', periode)
      if (tanggal) params.set('tanggal', tanggal)
      const res = await api<Res>(`/api/hrd/attendance?${params}`)
      setData(res)
      setPeriode(res.periode)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [periode, tanggal])
  useEffect(() => { load() }, [load])

  const term = q.trim().toLowerCase()
  const match = (x: { nama: string; nip: string; jabatan: string | null }) => !term || [x.nama, x.nip, x.jabatan].some((v) => v?.toLowerCase().includes(term))
  const daily = (data?.daily ?? []).filter((d) => match(d) && (!status || (status === 'izin' ? ['izin', 'sakit', 'cuti', 'dinas'].includes(d.status) : d.status === status)))
  const rekap = (data?.rekap ?? []).filter(match)
  const pagedDaily = usePaged(daily, [q, status, data?.tanggal])
  const pagedRekap = usePaged(rekap, [q, data?.periode], 50)
  const count = (fn: (d: Day) => boolean) => (data?.daily ?? []).filter(fn).length
  const toggle = (s: string) => setStatus(status === s ? '' : s)
  const empty = data && !data.months.length

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">SDM · ALTIUS / FINGERSPOT</p>
          <h1>Absensi</h1>
          <span>Kehadiran karyawan dari laporan HRIS Altius (mesin Fingerspot): jam masuk & pulang, terlambat, tidak hadir, izin/sakit/cuti, dan lembur. Jadwal yang tidak ada di laporan diambil dari Jadwal Shift.</span>
        </div>
        {data?.can.manage && <button className="pap-primary-button" onClick={() => setUploadOpen(true)}><Upload /> Unggah laporan Altius</button>}
      </div>
      <div className="pap-sync-bar">
        <div className="pap-sync-items">
          <span className="pap-sync-title">Altius</span>
          <span className="pap-sync-item">Laporan kehadiran: {data?.synced_at ? `diperbarui ${formatDate(data.synced_at, true)}` : 'belum ada data'}</span>
        </div>
        <button className="pap-btn" onClick={() => setSheetOpen(true)}><FileSpreadsheet /> Google Drive</button>
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {empty ? (
        <div className="pap-table-card">
          <div className="pap-empty">
            Belum ada data absensi. Ekspor laporan kehadiran dari HRIS Altius ke Excel, lalu {data.can.manage ? 'klik "Unggah laporan Altius", atau simpan filenya di Google Drive dan tempel link-nya lewat tombol "Google Drive" (sinkron otomatis ±30 menit).' : 'minta HRD mengunggahnya.'}
          </div>
        </div>
      ) : (
        <>
          <div className="pap-segmented pap-page-tabs" role="tablist" aria-label="Tampilan absensi">
            <button role="tab" aria-selected={tab === 'harian'} className={tab === 'harian' ? 'active' : ''} onClick={() => setTab('harian')}><CalendarDays /> Harian</button>
            <button role="tab" aria-selected={tab === 'rekap'} className={tab === 'rekap' ? 'active' : ''} onClick={() => setTab('rekap')}><Clock3 /> Rekap bulanan</button>
          </div>
          {tab === 'harian' ? (
            <>
              <div className="pap-stat-grid four">
                {([
                  ['hadir', 'Hadir', count((d) => ['hadir', 'terlambat', 'tanpa_scan'].includes(d.status)), UserCheck, 'stat-0'],
                  ['terlambat', 'Terlambat', count((d) => d.status === 'terlambat'), Clock3, 'stat-2'],
                  ['tidak_hadir', 'Tidak hadir', count((d) => d.status === 'tidak_hadir'), UserX, 'stat-3'],
                  ['izin', 'Izin / sakit / cuti', count((d) => ['izin', 'sakit', 'cuti', 'dinas'].includes(d.status)), AlertTriangle, 'stat-1'],
                ] as const).map(([key, label, value, Icon, tone]) => (
                  <button key={key} className={`pap-stat-card pap-stat-button ${status === key ? 'active' : ''}`} onClick={() => toggle(key === 'hadir' ? '' : key)}>
                    <div><span>{label}</span><strong className="pap-stat-text">{value}</strong><small className="neutral">{data?.tanggal ? formatDate(data.tanggal) : '—'}</small></div>
                    <div className={`pap-stat-icon ${tone}`}><Icon /></div>
                  </button>
                ))}
              </div>
              <div className="pap-table-card">
                <div className="pap-card-head">
                  <div><h2>Kehadiran {data?.tanggal ? formatDate(data.tanggal) : ''}</h2><p>{daily.length} karyawan · urut: tidak hadir & terlambat dulu</p></div>
                </div>
                <div className="pap-filters">
                  <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama, NIP, jabatan..." /></label>
                  <input className="pap-input pap-date-input" type="date" value={data?.tanggal ?? ''} onChange={(e) => { setTanggal(e.target.value); setPeriode(e.target.value.slice(0, 7)) }} aria-label="Tanggal" />
                  <select className="pap-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter status">
                    <option value="">Semua status</option>
                    {(Object.keys(STATUS_LABEL) as Status[]).filter((s) => !['sakit', 'cuti', 'dinas'].includes(s)).map((s) => <option key={s} value={s}>{s === 'izin' ? 'Izin / sakit / cuti' : STATUS_LABEL[s]}</option>)}
                  </select>
                </div>
                <div className="pap-table-wrap">
                  <table>
                    <thead><tr><th>Karyawan</th><th>Shift / jadwal</th><th>Masuk</th><th>Pulang</th><th>Status</th><th className="pap-num">Terlambat</th><th className="pap-num">Lembur</th><th>Keterangan</th></tr></thead>
                    <tbody>
                      {pagedDaily.items.map((d) => (
                        <tr key={d.id}>
                          <td><div className="pap-cell-title">{d.nama}</div><div className="pap-cell-sub">{d.nip.startsWith('nama:') ? 'NIP tidak ada' : d.nip}{d.jabatan ? ` · ${d.jabatan}` : ''}</div></td>
                          <td className="pap-nowrap">{d.shift ?? '—'}{(d.jadwal_masuk || d.jadwal_pulang) && <div className="pap-cell-sub">{hm(d.jadwal_masuk)}–{hm(d.jadwal_pulang)}</div>}</td>
                          <td className="pap-nowrap">{hm(d.jam_masuk)}</td>
                          <td className="pap-nowrap">{hm(d.jam_pulang)}{d.pulang_cepat_menit > 0 && <div className="pap-cell-sub pap-text-danger">cepat {dur(d.pulang_cepat_menit)}</div>}</td>
                          <td><span className={`pap-status ${STATUS_TONE[d.status] ?? 'neutral'}`}>{STATUS_LABEL[d.status] ?? d.status}</span>{d.status_asli && d.status_asli.toLowerCase() !== STATUS_LABEL[d.status]?.toLowerCase() && <div className="pap-cell-sub">{d.status_asli}</div>}</td>
                          <td className={`pap-num pap-nowrap ${d.terlambat_menit ? 'pap-text-warning' : ''}`}>{dur(d.terlambat_menit)}</td>
                          <td className="pap-num pap-nowrap">{dur(d.lembur_menit)}</td>
                          <td className="pap-cell-sub">{d.keterangan ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {data && !daily.length && <div className="pap-empty">{data.tanggal ? 'Tidak ada data kehadiran yang cocok di tanggal ini.' : 'Belum ada data di bulan ini.'}</div>}
                  {!data && !error && <div className="pap-empty">Memuat absensi...</div>}
                  <Pager {...pagedDaily.pager} noun="karyawan" />
                </div>
              </div>
            </>
          ) : (
            <>
              <section className="pap-table-card pap-dash-card">
                <div className="pap-card-head">
                  <div><h2>Kehadiran per hari</h2><p>Jumlah karyawan hadir · {monthLabel(data?.periode ?? '')}</p></div>
                  {data?.periode && <MonthNav periode={data.periode} onChange={(p) => { setTanggal(''); setPeriode(p) }} />}
                </div>
                {data?.perDay.length ? (
                  <ColumnChart ariaLabel={`Jumlah karyawan hadir per hari ${monthLabel(data.periode)}`} format={(v) => `${v} orang`} axisFormat={(v) => String(Math.round(v))}
                    data={data.perDay.map((d) => ({ key: d.tanggal, label: String(Number(d.tanggal.slice(8, 10))), value: d.hadir, detail: <><span>{formatDate(d.tanggal)}</span><span>terlambat {d.terlambat} · tidak hadir {d.tidak_hadir} · izin {d.izin}</span></> }))} />
                ) : <div className="pap-empty">Belum ada data di {monthLabel(data?.periode ?? '')}.</div>}
              </section>
              <div className="pap-table-card">
                <div className="pap-card-head"><div><h2>Rekap {monthLabel(data?.periode ?? '')}</h2><p>Per karyawan · lembur hari Minggu / shift OFF memakai tarif lembur hari libur{data?.can.payroll ? ' · upah lembur dari tarif di Grade & Gaji' : ''}</p></div></div>
                <div className="pap-filters"><label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama, NIP, jabatan..." /></label></div>
                <div className="pap-table-wrap">
                  <table>
                    <thead><tr><th>Karyawan</th><th className="pap-num">Hadir</th><th className="pap-num">Terlambat</th><th className="pap-num">Tidak hadir</th><th className="pap-num">Izin</th><th className="pap-num">Sakit</th><th className="pap-num">Cuti</th><th className="pap-num">Lembur</th>{data?.can.payroll && <th className="pap-num">Upah lembur</th>}</tr></thead>
                    <tbody>
                      {pagedRekap.items.map((r) => (
                        <tr key={r.nip}>
                          <td><div className="pap-cell-title">{r.nama}</div><div className="pap-cell-sub">{r.nip.startsWith('nama:') ? 'NIP tidak ada' : r.nip}{r.jabatan ? ` · ${r.jabatan}` : ''}</div></td>
                          <td className="pap-num"><strong>{r.hadir}</strong>{r.tanpa_scan > 0 && <div className="pap-cell-sub">{r.tanpa_scan} scan kurang</div>}</td>
                          <td className={`pap-num pap-nowrap ${r.terlambat ? 'pap-text-warning' : ''}`}>{r.terlambat ? <>{r.terlambat}×<div className="pap-cell-sub">{dur(r.terlambat_menit)}</div></> : '—'}</td>
                          <td className={`pap-num ${r.tidak_hadir ? 'pap-text-danger' : ''}`}>{r.tidak_hadir || '—'}</td>
                          <td className="pap-num">{r.izin || '—'}</td>
                          <td className="pap-num">{r.sakit || '—'}</td>
                          <td className="pap-num">{r.cuti || '—'}</td>
                          <td className="pap-num pap-nowrap">{r.lembur_menit + r.lembur_libur_menit ? <>{jam(r.lembur_menit + r.lembur_libur_menit)} jam{r.lembur_libur_menit > 0 && <div className="pap-cell-sub">{jam(r.lembur_libur_menit)} jam hari libur</div>}</> : '—'}</td>
                          {data?.can.payroll && <td className="pap-num pap-nowrap">{r.upah_lembur ? <strong>{formatRupiah(r.upah_lembur)}</strong> : r.upah_lembur === null && r.lembur_menit + r.lembur_libur_menit ? <span className="pap-cell-sub">tarif belum ada</span> : '—'}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {data && !rekap.length && <div className="pap-empty">Belum ada data di bulan ini.</div>}
                  <Pager {...pagedRekap.pager} noun="karyawan" />
                </div>
              </div>
            </>
          )}
        </>
      )}
      {uploadOpen && <UploadAttendance onClose={() => setUploadOpen(false)} onImported={(t, sampai) => { setUploadOpen(false); setMessage(t); setTanggal(sampai); setPeriode(sampai.slice(0, 7)) }} />}
      {sheetOpen && <HrSheetSync jenis="absensi" onClose={() => setSheetOpen(false)} onImported={(t) => { setSheetOpen(false); setMessage(t); setTanggal(''); setPeriode(''); load() }} />}
    </>
  )
}

type Preview = { file: string; tabs: { title: string; format: string | null; rows: number }[]; baris: number; karyawan: number; dari: string; sampai: string; contoh: string[] }

function UploadAttendance({ onClose, onImported }: { onClose: () => void; onImported: (message: string, sampai: string) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function send(mode: 'preview' | 'import', f = file) {
    if (!f) return
    setBusy(true)
    setError('')
    try {
      const body = new FormData()
      body.append('file', f)
      body.append('mode', mode)
      const res = await fetch('/api/hrd/attendance/upload', { method: 'POST', body })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Gagal membaca file.')
      if (mode === 'preview') setPreview(json)
      else onImported(`Absensi tersimpan: ${json.baris} baris kehadiran, ${json.karyawan} karyawan (${formatDate(json.dari)} – ${formatDate(json.sampai)}).`, json.sampai)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="Unggah laporan kehadiran Altius" subtitle="File Excel (.xlsx) hasil ekspor laporan kehadiran dari HRIS Altius" onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" disabled={busy || !preview} onClick={() => send('import')}>{busy && preview ? 'Menyimpan...' : `Simpan ${preview?.baris ?? 0} baris`}</button></>}>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <input className="pap-input" type="file" accept=".xlsx" onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); setPreview(null); if (f) send('preview', f) }} />
      <p className="pap-muted">Kolom dikenali dari judulnya: NIP / Nama, Tanggal, Jam Masuk & Jam Pulang (atau Jam scan per baris), Status, Terlambat, Lembur, Shift / Jadwal. Data tanggal yang sama diperbarui, tidak digandakan.</p>
      {busy && !preview && <p className="pap-muted">Membaca file...</p>}
      {preview && (
        <>
          <p><b>{preview.baris}</b> baris kehadiran · <b>{preview.karyawan}</b> karyawan · {formatDate(preview.dari)} – {formatDate(preview.sampai)}</p>
          <ul className="pap-dash-agenda">{preview.tabs.map((t) => <li key={t.title}><div className="pap-sync-tab"><FileSpreadsheet /><span><b>{t.title}</b> · {t.format ? `${t.format === 'log' ? 'log scan' : 'rekap harian'}, ${t.rows} baris` : 'kolom tidak dikenali, dilewati'}</span></div></li>)}</ul>
          <div className="pap-muted">{preview.contoh.map((c) => <div key={c}>{c}</div>)}</div>
        </>
      )}
    </Modal>
  )
}
