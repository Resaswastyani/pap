'use client'

import { useCallback, useEffect, useState } from 'react'
import { CalendarDays, CalendarCheck, Clock3, FileSpreadsheet, Search, Upload } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { formatNumber, formatRupiah } from './accurate'
import { MonthNav, monthLabel } from './accurate-production'
import { ColumnChart } from './charts'
import { HrSheetSync } from './hrd-page'
import { ReportDownloadButton } from './report-download'
import { api, formatDate, Modal, Notice, Pager, usePaged } from './ui'

// Absensi dari laporan kehadiran HRIS Altius (mesin Fingerspot): harian & rekap bulanan, terlambat, lembur, upah lembur

type Status = 'hadir' | 'terlambat' | 'tidak_hadir' | 'izin' | 'sakit' | 'cuti' | 'dinas' | 'libur' | 'tanpa_scan' | 'belum_scan' | 'terjadwal'
const STATUS_LABEL: Record<Status, string> = { hadir: 'Hadir', terlambat: 'Terlambat', tidak_hadir: 'Tidak hadir', izin: 'Izin', sakit: 'Sakit', cuti: 'Cuti', dinas: 'Dinas luar', libur: 'Libur', tanpa_scan: 'Scan tidak lengkap', belum_scan: 'Belum scan', terjadwal: 'Terjadwal' }
const STATUS_TONE: Record<Status, string> = { hadir: 'success', terlambat: 'warning', tidak_hadir: 'danger', izin: 'info', sakit: 'info', cuti: 'info', dinas: 'info', libur: 'neutral', tanpa_scan: 'warning', belum_scan: 'neutral', terjadwal: 'neutral' }
// Legenda matriks (urutan tampil)
const LEGEND: [Status, string][] = [['hadir', '1'], ['terlambat', '1'], ['tidak_hadir', 'A'], ['izin', 'I'], ['sakit', 'S'], ['cuti', 'C'], ['libur', 'L'], ['belum_scan', '1'], ['terjadwal', '1'], ['tanpa_scan', '?']]
type Cell = { s: Status; sh: string | null; m: string | null; p: string | null; t: number; l: number; k: string | null }
type MatrixRow = { nip: string; nama: string; jabatan: string | null; divisi: string | null; cells: Record<number, Cell> }
const DAY_INITIAL = ['M', 'S', 'S', 'R', 'K', 'J', 'S']
// "Shift 1 (07:00 - 15:00)" -> 1, "Normal1" -> N1, "Driver1" -> D1, "OFF" -> L
function shiftCode(sh: string | null) {
  const v = (sh ?? '').trim()
  if (!v) return ''
  if (/^(off|libur)/i.test(v)) return 'L'
  const m = v.match(/^shift\s*(\d)/i)
  if (m) return m[1]
  const k = v.match(/^([a-z])[a-z]*\s*(\d*)/i)
  return k ? `${k[1].toUpperCase()}${k[2]}` : v.slice(0, 2)
}
// Isi sel: kode shift untuk hadir / terlambat / terjadwal / belum scan; huruf untuk ketidakhadiran
function cellText(c: Cell) {
  if (c.s === 'tidak_hadir') return 'A'
  if (c.s === 'izin' || c.s === 'dinas') return c.s === 'dinas' ? 'D' : 'I'
  if (c.s === 'sakit') return 'S'
  if (c.s === 'cuti') return 'C'
  if (c.s === 'libur') return 'L'
  if (c.s === 'tanpa_scan') return '?'
  return shiftCode(c.sh) || '•'
}
function describeCell(nama: string, iso: string, c: Cell) {
  const parts = [`${nama} · ${formatDate(iso)}`, `${STATUS_LABEL[c.s] ?? c.s}${c.sh ? ` (${c.sh})` : ''}`]
  if (c.m || c.p) parts.push(`Masuk ${c.m ?? '—'} · Pulang ${c.p ?? '—'}`)
  if (c.t) parts.push(`Terlambat ${c.t} menit`)
  if (c.l) parts.push(`Lembur ${c.l} menit`)
  if (c.k) parts.push(c.k)
  return parts.join('\n')
}
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
  periode: string; tanggal: string | null; today: string; months: string[]; daily: Day[]; matrix: MatrixRow[]; rekap: Rekap[]; perDay: { tanggal: string; hadir: number; terlambat: number; tidak_hadir: number; izin: number }[]
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
  const [divisi, setDivisi] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [applying, setApplying] = useState(false)
  async function applyShift() {
    setApplying(true)
    try {
      const res = await api<{ diperbarui: number }>('/api/hrd/attendance/shift', { method: 'POST' })
      setMessage(res.diperbarui ? `${res.diperbarui} baris absensi disesuaikan dengan Jadwal Shift.` : 'Absensi sudah sesuai dengan Jadwal Shift.')
      load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setApplying(false)
    }
  }
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
  const empty = data && !data.months.length
  // Matriks bulan: semua tanggal + karyawan yang cocok dengan pencarian / divisi
  const dates = (() => {
    if (!data?.periode) return []
    const [y, m] = data.periode.split('-').map(Number)
    const total = new Date(Date.UTC(y, m, 0)).getUTCDate()
    return Array.from({ length: total }, (_, i) => ({ day: i + 1, iso: `${data.periode}-${String(i + 1).padStart(2, '0')}`, dow: new Date(Date.UTC(y, m - 1, i + 1)).getUTCDay() }))
  })()
  const divisions = [...new Set((data?.matrix ?? []).map((r) => r.divisi).filter((d): d is string => !!d))].sort()
  const matrix = (data?.matrix ?? []).filter((r) => match(r) && (!divisi || r.divisi === divisi))

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">SDM · ALTIUS / FINGERSPOT</p>
          <h1>Absensi</h1>
          <span>Kehadiran karyawan dari laporan HRIS Altius (mesin Fingerspot): jam masuk & pulang, terlambat, tidak hadir, izin/sakit/cuti, dan lembur. Hari libur setiap karyawan mengikuti Jadwal Shift (tidak semua libur hari Minggu).</span>
        </div>
        <div className="pap-inline-actions pap-wrap">
          <ReportDownloadButton jenis="absensi" />
          {data?.can.manage && <button className="pap-btn" disabled={applying} onClick={applyShift} title="Samakan hari libur & label shift dengan Jadwal Shift"><CalendarCheck /> {applying ? 'Menyesuaikan...' : 'Sesuaikan Jadwal Shift'}</button>}
          {data?.can.manage && <button className="pap-primary-button" onClick={() => setUploadOpen(true)}><Upload /> Unggah laporan Altius</button>}
        </div>
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
              <div className="pap-table-card">
                <div className="pap-card-head">
                  <div><h2>Kehadiran {monthLabel(data?.periode ?? '')}</h2><p>Seperti Jadwal Shift: isi sel = shift, warna = kehadiran. Klik tanggal atau sel untuk melihat detail hari itu.</p></div>
                  {data?.periode && <MonthNav periode={data.periode} onChange={(p) => { setTanggal(''); setPeriode(p) }} />}
                </div>
                <div className="pap-filters">
                  <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama, NIP, jabatan..." /></label>
                  <select className="pap-select" value={divisi} onChange={(e) => setDivisi(e.target.value)} aria-label="Filter divisi">
                    <option value="">Semua divisi</option>
                    {divisions.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div className="pap-shift-legend">
                  {LEGEND.map(([s, text]) => <span key={s}><i className={`pap-att-cell ${s}`}>{text}</i>{STATUS_LABEL[s]}</span>)}
                </div>
                <div className="pap-shift-wrap">
                  <table className="pap-shift-table pap-att-table">
                    <thead>
                      <tr>
                        <th rowSpan={2} className="sticky no">No</th>
                        <th rowSpan={2} className="sticky nama">Nama</th>
                        {dates.map((d) => <th key={d.day} className={`dow ${d.dow === 0 ? 'sunday' : ''} ${d.iso === data?.today ? 'today' : ''}`}>{DAY_INITIAL[d.dow]}</th>)}
                      </tr>
                      <tr>{dates.map((d) => <th key={d.day} className={`date ${d.dow === 0 ? 'sunday' : ''} ${d.iso === data?.today ? 'today' : ''} ${d.iso === data?.tanggal ? 'picked' : ''}`}><button onClick={() => setTanggal(d.iso)} title={`Detail ${formatDate(d.iso)}`}>{d.day}</button></th>)}</tr>
                    </thead>
                    <tbody>
                      {matrix.map((r, i) => (
                        <tr key={r.nip}>
                          <td className="sticky no">{i + 1}</td>
                          <td className="sticky nama"><span className="pap-shift-name">{r.nama}</span>{r.jabatan && <span className={`pap-shift-tag ${/kepala|kashift/i.test(r.jabatan) ? 'lead' : ''}`}>{r.jabatan}</span>}</td>
                          {dates.map((d) => {
                            const c = r.cells[d.day]
                            return (
                              <td key={d.day} className={`pap-att-cell ${c ? c.s : 'none'} ${d.iso === data?.today ? 'today' : ''} ${d.iso === data?.tanggal ? 'picked' : ''}`}
                                title={c ? describeCell(r.nama, d.iso, c) : `${r.nama} · ${formatDate(d.iso)}: tidak ada data`} onClick={() => setTanggal(d.iso)}>
                                {c ? cellText(c) : ''}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      {([['hadir', 'Hadir'], ['terlambat', 'Terlambat'], ['tidak_hadir', 'Tidak hadir']] as const).map(([s, label]) => (
                        <tr key={s}>
                          <td colSpan={2} className="sticky jumlah">Jumlah {label}</td>
                          {dates.map((d) => {
                            const total = matrix.filter((r) => { const st = r.cells[d.day]?.s; return s === 'hadir' ? st === 'hadir' || st === 'terlambat' || st === 'tanpa_scan' : st === s }).length
                            return <td key={d.day} className={d.iso === data?.today ? 'today' : ''}>{d.iso > (data?.today ?? '') ? '' : total || ''}</td>
                          })}
                        </tr>
                      ))}
                    </tfoot>
                  </table>
                  {data && !matrix.length && <div className="pap-empty">{q || divisi ? 'Tidak ada karyawan yang cocok.' : `Belum ada data di ${monthLabel(data.periode)}.`}</div>}
                  {!data && !error && <div className="pap-empty">Memuat absensi...</div>}
                </div>
              </div>
              {data?.tanggal && (
                <div className="pap-table-card">
                  <div className="pap-card-head">
                    <div><h2>Detail {formatDate(data.tanggal)}</h2><p>{daily.length} karyawan · hadir {count((d) => ['hadir', 'terlambat', 'tanpa_scan'].includes(d.status))} · terlambat {count((d) => d.status === 'terlambat')} · tidak hadir {count((d) => d.status === 'tidak_hadir')} · izin/sakit/cuti {count((d) => ['izin', 'sakit', 'cuti', 'dinas'].includes(d.status))}</p></div>
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
                            <td><span className={`pap-status ${STATUS_TONE[d.status] ?? 'neutral'}`}>{STATUS_LABEL[d.status] ?? d.status}</span></td>
                            <td className={`pap-num pap-nowrap ${d.terlambat_menit ? 'pap-text-warning' : ''}`}>{dur(d.terlambat_menit)}</td>
                            <td className="pap-num pap-nowrap">{dur(d.lembur_menit)}</td>
                            <td className="pap-cell-sub">{d.keterangan ?? ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!daily.length && <div className="pap-empty">Tidak ada data yang cocok di tanggal ini.</div>}
                    <Pager {...pagedDaily.pager} noun="karyawan" />
                  </div>
                </div>
              )}
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
