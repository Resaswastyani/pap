'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Award, Calculator, ExternalLink, FileSpreadsheet, RefreshCw, Search, UserCheck, UserMinus, Users, Wallet } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { formatNumber, formatRupiah } from './accurate'
import { api, Field, formatDate, Modal, Notice, Pager, usePaged } from './ui'

// HRD: data karyawan, grade operator, dan kebijakan gaji dari spreadsheet di Google Drive

type Employee = {
  id: number; nip: string; nama: string; email: string | null; handphone: string | null; jenis_kelamin: string | null; tgl_masuk: string | null
  departemen: string | null; divisi: string | null; jabatan: string | null; level_posisi: string | null; status_karyawan: string | null; tgl_akhir_percobaan: string | null
  tgl_berhenti: string | null; nama_atasan: string | null; masa_kerja: string | null; hari_kerja: string | null
  grade_operator?: string | null; nilai_grade?: number | null; grade_gaji?: string | null; upah_harian?: number | null; total_terima?: number | null
}
type Score = { penilai: string; teknis: number | null; qc: number | null; total: number | null }
type Salary = {
  id: number; no: number | null; nama: string; no_rek_cimb?: string | null; no_rek_lain?: string | null; upah_harian: number | null; grade: string | null; nominal_grade: number | null
  upah_harian_total: number | null; upah_bulanan: number | null; kenaikan_harian: number | null; kenaikan_bulanan: number | null; kenaikan_persen: number | null; tunjangan: number | null
  total_terima: number | null; bpjs_laka: number | null; bpjs_kematian: number | null; bpjs_kesehatan: number | null; thr: number | null; total_bpjs_thr: number | null
  tanpa_thr: number | null; tarif_jam: number | null; lembur_jam: number | null; lembur_libur_jam: number | null; employee_id: number | null; nip: string | null; jabatan: string | null
}
type Grade = { id: number; no: number | null; nama: string; skor: Score[]; rata_rata: number | null; grade: string | null; employee_id: number | null; nip: string | null; jabatan: string | null }
type Policy = {
  judul: string | null; wilayah: string | null; hari_kerja: number; faktor_lembur: number | null; faktor_lembur_libur: number | null
  tingkat: { label: string; nilai: number }[]; grade: { grade: string; nominal: number }[]; total: Record<string, number | null>
}
type Meta = { penilai: string[]; aturan: { grade: string; jumlah: number | null; kriteria: string }[]; kebijakan: Policy | null; synced_at: string }

const isResign = (e: Pick<Employee, 'status_karyawan' | 'tgl_berhenti'>) => /resign|keluar|berhenti/i.test(e.status_karyawan ?? '') || !!e.tgl_berhenti
const STATUS_TONE = (s: string | null) => (/resign/i.test(s ?? '') ? 'neutral' : /tetap/i.test(s ?? '') ? 'success' : /percobaan/i.test(s ?? '') ? 'warning' : /kontrak/i.test(s ?? '') ? 'info' : 'neutral')
const GRADE_TONE: Record<string, string> = { A: 'success', B: 'info', C: 'warning' }
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
const daysUntil = (iso: string) => Math.round((Date.parse(iso) - Date.parse(today())) / 86_400_000)
const rp = (v: number | null | undefined) => (v === null || v === undefined ? '—' : formatRupiah(v))
const short = (v: number) => (v >= 1e6 ? `Rp ${formatNumber(v / 1e6, 1)} jt` : formatRupiah(v))

function Tiles({ tiles }: { tiles: { label: string; value: string; note: string; icon: typeof Users; tone: string; active?: boolean; onClick?: () => void }[] }) {
  return (
    <div className="pap-stat-grid four">
      {tiles.map((t) => (
        <button key={t.label} className={`pap-stat-card pap-stat-button ${t.active ? 'active' : ''}`} onClick={t.onClick} disabled={!t.onClick}>
          <div><span>{t.label}</span><strong className="pap-stat-text">{t.value}</strong><small className="neutral">{t.note}</small></div>
          <div className={`pap-stat-icon ${t.tone}`}><t.icon /></div>
        </button>
      ))}
    </div>
  )
}

function SyncBar({ label, syncedAt, canSync, onOpen }: { label: string; syncedAt: string | null; canSync: boolean; onOpen: () => void }) {
  return (
    <div className="pap-sync-bar">
      <div className="pap-sync-items">
        <span className="pap-sync-title">Google Drive</span>
        <span className="pap-sync-item">{label}: {syncedAt ? `sinkron ${formatDate(syncedAt, true)}` : 'belum pernah sinkron'}</span>
      </div>
      <button className="pap-btn" onClick={onOpen}>{canSync ? <RefreshCw /> : <FileSpreadsheet />} {canSync ? 'Sinkron' : 'Sumber data'}</button>
    </div>
  )
}

// ---------- Karyawan ----------
export function KaryawanPage(_props: { user: UserProfile }) {
  const [data, setData] = useState<{ items: Employee[]; synced_at: string | null; can: { manage: boolean; payroll: boolean } } | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [q, setQ] = useState('')
  const [divisi, setDivisi] = useState('')
  const [status, setStatus] = useState('aktif')
  const [detail, setDetail] = useState<number | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [showAllEnding, setShowAllEnding] = useState(false)
  const load = useCallback(() => api<NonNullable<typeof data>>('/api/hrd/employees').then((r) => { setData(r); setError('') }).catch((e) => setError(e.message)), [])
  useEffect(() => { load() }, [load])

  const all = data?.items ?? []
  const aktif = all.filter((e) => !isResign(e))
  const ending = aktif.filter((e) => /percobaan|kontrak/i.test(e.status_karyawan ?? '') && e.tgl_akhir_percobaan && daysUntil(e.tgl_akhir_percobaan) <= 30)
    .sort((a, b) => a.tgl_akhir_percobaan!.localeCompare(b.tgl_akhir_percobaan!))
  const divisions = [...new Set(all.map((e) => e.divisi).filter((d): d is string => !!d))].sort()
  const term = q.trim().toLowerCase()
  const shown = all.filter((e) => (status === 'aktif' ? !isResign(e) : status === 'resign' ? isResign(e) : status === 'tetap' ? !isResign(e) && /tetap/i.test(e.status_karyawan ?? '')
    : status === 'percobaan' ? !isResign(e) && /percobaan|kontrak/i.test(e.status_karyawan ?? '') : true)
    && (!divisi || e.divisi === divisi)
    && (!term || [e.nama, e.nip, e.jabatan, e.divisi, e.nama_atasan].some((x) => x?.toLowerCase().includes(term))))
  const paged = usePaged(shown, [q, divisi, status])
  const toggle = (s: string) => setStatus(status === s ? 'aktif' : s)

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">SDM · GOOGLE DRIVE</p>
          <h1>Karyawan</h1>
          <span>Data karyawan dari spreadsheet Data Karyawan di Google Drive: divisi, jabatan, status kepegawaian, masa kerja, atasan{data?.can.payroll ? ', serta grade & gaji' : ''}.</span>
        </div>
      </div>
      <SyncBar label="Data Karyawan" syncedAt={data?.synced_at ?? null} canSync={!!data?.can.manage} onOpen={() => setSheetOpen(true)} />
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <Tiles tiles={[
        { label: 'Karyawan aktif', value: `${aktif.length}`, note: `${divisions.length} divisi`, icon: Users, tone: 'stat-1', active: status === 'aktif', onClick: () => setStatus('aktif') },
        { label: 'Karyawan tetap', value: `${aktif.filter((e) => /tetap/i.test(e.status_karyawan ?? '')).length}`, note: 'Status Tetap', icon: UserCheck, tone: 'stat-0', active: status === 'tetap', onClick: () => toggle('tetap') },
        { label: 'Kontrak & percobaan', value: `${aktif.filter((e) => /percobaan|kontrak/i.test(e.status_karyawan ?? '')).length}`, note: ending.length ? `${ending.length} berakhir ≤ 30 hari` : 'Tidak ada yang segera berakhir', icon: AlertTriangle, tone: ending.length ? 'stat-2' : 'stat-1', active: status === 'percobaan', onClick: () => toggle('percobaan') },
        { label: 'Resign', value: `${all.length - aktif.length}`, note: 'Tercatat di Data Karyawan', icon: UserMinus, tone: 'stat-3', active: status === 'resign', onClick: () => toggle('resign') },
      ]} />
      {ending.length > 0 && (
        <div className="pap-table-card">
          <div className="pap-card-head">
            <div>
              <h2>Masa percobaan / kontrak berakhir ({ending.length})</h2>
              <p>Perlu keputusan HRD: diangkat, diperpanjang, atau tidak dilanjutkan.{ending.some((e) => daysUntil(e.tgl_akhir_percobaan!) < 0) ? ' Yang sudah lewat tetapi statusnya belum berubah: perbarui Status Karyawan di spreadsheet.' : ''}</p>
            </div>
            {ending.length > 6 && <button className="pap-btn" onClick={() => setShowAllEnding(!showAllEnding)}>{showAllEnding ? 'Ringkas' : `Lihat semua (${ending.length})`}</button>}
          </div>
          <div className="pap-table-wrap">
            <table>
              <tbody>
                {(showAllEnding ? ending : ending.slice(0, 6)).map((e) => {
                  const d = daysUntil(e.tgl_akhir_percobaan!)
                  return (
                    <tr key={e.id} className="pap-row-link" onClick={() => setDetail(e.id)}>
                      <td><div className="pap-cell-title">{e.nama}</div><div className="pap-cell-sub">{e.jabatan ?? '—'} · {e.divisi ?? '—'}</div></td>
                      <td>{e.status_karyawan}</td>
                      <td className="pap-nowrap">{formatDate(e.tgl_akhir_percobaan)}</td>
                      <td className="pap-nowrap"><span className={`pap-status ${d < 0 ? 'danger' : 'warning'}`}>{d < 0 ? `lewat ${-d} hari` : d === 0 ? 'hari ini' : `${d} hari lagi`}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="pap-table-card">
        <div className="pap-card-head"><div><h2>Daftar karyawan</h2><p>{shown.length} karyawan · data dari Google Drive (ubah di spreadsheet, lalu sinkron)</p></div></div>
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama, NIP, jabatan, atasan..." /></label>
          <select className="pap-select" value={divisi} onChange={(e) => setDivisi(e.target.value)} aria-label="Filter divisi">
            <option value="">Semua divisi</option>
            {divisions.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select className="pap-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter status">
            <option value="aktif">Aktif</option>
            <option value="tetap">Tetap</option>
            <option value="percobaan">Kontrak & percobaan</option>
            <option value="resign">Resign</option>
            <option value="semua">Semua</option>
          </select>
        </div>
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Karyawan</th><th>Divisi</th><th>Status</th><th>Masuk</th><th>Atasan</th>{data?.can.payroll && <th>Grade</th>}</tr></thead>
            <tbody>
              {paged.items.map((e) => (
                <tr key={e.id} className="pap-row-link" onClick={() => setDetail(e.id)}>
                  <td><div className="pap-cell-title">{e.nama}</div><div className="pap-cell-sub">{e.nip} · {e.jabatan ?? '—'}</div></td>
                  <td>{e.divisi ?? '—'}{e.departemen && e.departemen !== e.divisi && <div className="pap-cell-sub">{e.departemen}</div>}</td>
                  <td><span className={`pap-status ${STATUS_TONE(e.status_karyawan)}`}>{e.status_karyawan ?? '—'}</span>{e.tgl_berhenti && <div className="pap-cell-sub">keluar {formatDate(e.tgl_berhenti)}</div>}</td>
                  <td className="pap-nowrap">{formatDate(e.tgl_masuk)}<div className="pap-cell-sub">{e.masa_kerja ?? ''}</div></td>
                  <td>{e.nama_atasan ?? '—'}</td>
                  {data?.can.payroll && <td>{e.grade_operator || e.grade_gaji ? <span className={`pap-status ${GRADE_TONE[(e.grade_operator || e.grade_gaji)!] ?? 'neutral'}`}>Grade {e.grade_operator || e.grade_gaji}</span> : <span className="pap-muted">—</span>}{e.nilai_grade ? <div className="pap-cell-sub">nilai {formatNumber(e.nilai_grade, 1)}</div> : null}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {data && !all.length && <div className="pap-empty">Belum ada data karyawan. {data.can.manage ? 'Klik "Sinkron" untuk mengambil dari spreadsheet Data Karyawan di Google Drive.' : 'HRD perlu menyinkron dari Google Drive.'}</div>}
          {data && all.length > 0 && !shown.length && <div className="pap-empty">Tidak ada karyawan yang cocok.</div>}
          {!data && !error && <div className="pap-empty">Memuat data karyawan...</div>}
          <Pager {...paged.pager} noun="karyawan" />
        </div>
      </div>
      {detail && <EmployeeDetail id={detail} onClose={() => setDetail(null)} />}
      {sheetOpen && <HrSheetSync jenis="karyawan" onClose={() => setSheetOpen(false)} onImported={(t) => { setSheetOpen(false); setMessage(t); load() }} />}
    </>
  )
}

type Detail = { item: Record<string, string | number | null>; bawahan: { id: number; nama: string; jabatan: string | null }[]; grade: { skor: Score[]; rata_rata: number | null; grade: string | null } | null; gaji: Salary | null; can: { manage: boolean; payroll: boolean } }

function EmployeeDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { api<Detail>(`/api/hrd/employees/${id}`).then(setD).catch((e) => setError(e.message)) }, [id])
  if (!d) return <Modal title="Karyawan" onClose={onClose}>{error ? <Notice>{error}</Notice> : <p className="pap-muted">Memuat...</p>}</Modal>
  const e = d.item
  const v = (k: string) => (e[k] === null || e[k] === undefined || e[k] === '' ? '—' : String(e[k]))
  const date = (k: string) => (e[k] ? formatDate(String(e[k])) : '—')
  const grid = (rows: [string, string][]) => <dl className="pap-detail-grid">{rows.map(([dt, dd]) => <div key={dt}><dt>{dt}</dt><dd>{dd}</dd></div>)}</dl>
  return (
    <Modal title={String(e.nama)} subtitle={`NIP ${v('nip')} · ${v('jabatan')} · ${v('divisi')}`} wide onClose={onClose} footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Tutup</button></>}>
      <div className="pap-detail-badges"><span className={`pap-status ${STATUS_TONE(e.status_karyawan as string)}`}>{v('status_karyawan')}</span>{d.grade?.grade && <span className={`pap-status ${GRADE_TONE[d.grade.grade] ?? 'neutral'}`}>Grade {d.grade.grade}</span>}</div>
      <section className="pap-detail-section">
        <h3>Pekerjaan</h3>
        {grid([['Departemen', v('departemen')], ['Divisi', v('divisi')], ['Jabatan', v('jabatan')], ['Level', v('level_posisi')], ['Tanggal masuk', date('tgl_masuk')], ['Masa kerja', v('masa_kerja')],
          ['Akhir percobaan', date('tgl_akhir_percobaan')], ['Tanggal berhenti', date('tgl_berhenti')], ['Atasan', v('nama_atasan')], ['Hari kerja', v('hari_kerja')], ['ID finger', v('id_finger')]])}
      </section>
      <section className="pap-detail-section">
        <h3>Kontak</h3>
        {grid([['Handphone', v('handphone')], ['Email', v('email')]])}
      </section>
      {d.can.manage && (
        <section className="pap-detail-section">
          <h3>Data pribadi <span className="pap-chip">HRD</span></h3>
          {grid([['Tempat, tgl lahir', `${v('tempat_lahir')}, ${date('tgl_lahir')}`], ['Jenis kelamin', v('jenis_kelamin')], ['Agama', v('agama')], ['Status menikah', v('status_menikah')],
            ['Jumlah anak', v('jumlah_anak')], ['Pendidikan', v('pendidikan')], ['No. KTP', v('no_id')], ['Nama ibu kandung', v('nama_ibu')], ['Alamat KTP', v('alamat_id')], ['Alamat tinggal', v('alamat_tinggal')],
            ['BPJS Ketenagakerjaan', v('no_bpjs_tk')], ['BPJS Kesehatan', v('no_bpjs_kes')], ['NPWP', v('npwp')], ['Status pajak', v('status_pajak')], ['Rekening', `${v('bank')} ${v('no_rek')} a.n. ${v('rek_an')}`]])}
        </section>
      )}
      {d.grade && (
        <section className="pap-detail-section">
          <h3>Grade operator · rata-rata {d.grade.rata_rata === null ? '—' : formatNumber(d.grade.rata_rata, 1)}</h3>
          <div className="pap-table-wrap bordered">
            <table>
              <thead><tr><th>Penilai (kepala shift)</th><th className="pap-num">Teknis mesin</th><th className="pap-num">QC product</th><th className="pap-num">Total</th></tr></thead>
              <tbody>{d.grade.skor.map((s) => <tr key={s.penilai}><td>{s.penilai}</td><td className="pap-num">{s.teknis ?? '—'}</td><td className="pap-num">{s.qc ?? '—'}</td><td className="pap-num"><strong>{s.total ? formatNumber(s.total, 1) : '—'}</strong></td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}
      {d.gaji && (
        <section className="pap-detail-section">
          <h3>Gaji (kebijakan gaji operasional)</h3>
          {grid([['Upah harian (7 jam)', rp(d.gaji.upah_harian)], ['Tunjangan grade', `${rp(d.gaji.nominal_grade)} (Grade ${d.gaji.grade ?? '—'})`], ['Upah 25 hari', rp(d.gaji.upah_bulanan)],
            ['Kenaikan', `${rp(d.gaji.kenaikan_bulanan)} / bulan (${d.gaji.kenaikan_persen ?? '—'}%)`], ['Tunjangan', rp(d.gaji.tunjangan)], ['Total terima', rp(d.gaji.total_terima)],
            ['BPJS (laka, kematian, kesehatan)', `${rp(d.gaji.bpjs_laka)} · ${rp(d.gaji.bpjs_kematian)} · ${rp(d.gaji.bpjs_kesehatan)}`], ['THR', rp(d.gaji.thr)],
            ['Tarif per jam', rp(d.gaji.tarif_jam)], ['Lembur per jam', rp(d.gaji.lembur_jam)], ['Lembur hari libur per jam', rp(d.gaji.lembur_libur_jam)]])}
        </section>
      )}
      {d.bawahan.length > 0 && (
        <section className="pap-detail-section">
          <h3>Bawahan ({d.bawahan.length})</h3>
          <p className="pap-muted">{d.bawahan.map((b) => `${b.nama}${b.jabatan ? ` (${b.jabatan})` : ''}`).join(', ')}</p>
        </section>
      )}
    </Modal>
  )
}

// ---------- Grade & Gaji ----------
type Payroll = { meta: Meta | null; grades: Grade[]; salaries: Salary[]; can: { manage: boolean } }

export function GradeGajiPage(_props: { user: UserProfile }) {
  const [data, setData] = useState<Payroll | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [tab, setTab] = useState<'grade' | 'gaji' | 'hitung'>('grade')
  const [sheetOpen, setSheetOpen] = useState(false)
  const load = useCallback(() => api<Payroll>('/api/hrd/payroll').then((r) => { setData(r); setError('') }).catch((e) => setError(e.message)), [])
  useEffect(() => { load() }, [load])
  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">SDM · GOOGLE DRIVE</p>
          <h1>Grade &amp; Gaji</h1>
          <span>Grade operator produksi dari penilaian kepala shift, kebijakan gaji operasional (upah harian, kenaikan, tunjangan, BPJS, THR), serta tarif gaji per jam & lembur. Sumber: spreadsheet Data Grade dan Kenaikan Gaji di Google Drive.</span>
        </div>
      </div>
      <div className="pap-segmented pap-page-tabs" role="tablist" aria-label="Grade & Gaji">
        <button role="tab" aria-selected={tab === 'grade'} className={tab === 'grade' ? 'active' : ''} onClick={() => setTab('grade')}><Award /> Grade operator</button>
        <button role="tab" aria-selected={tab === 'gaji'} className={tab === 'gaji' ? 'active' : ''} onClick={() => setTab('gaji')}><Wallet /> Kebijakan gaji</button>
        <button role="tab" aria-selected={tab === 'hitung'} className={tab === 'hitung' ? 'active' : ''} onClick={() => setTab('hitung')}><Calculator /> Hitung lembur &amp; gaji</button>
      </div>
      <SyncBar label="Data Grade dan Kenaikan Gaji" syncedAt={data?.meta?.synced_at ?? null} canSync={!!data?.can.manage} onOpen={() => setSheetOpen(true)} />
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {!data && !error && <div className="pap-table-card"><div className="pap-empty">Memuat...</div></div>}
      {data && (tab === 'grade' ? <GradeView data={data} /> : tab === 'gaji' ? <SalaryView data={data} /> : <OvertimeCalc data={data} />)}
      {sheetOpen && <HrSheetSync jenis="grade" onClose={() => setSheetOpen(false)} onImported={(t) => { setSheetOpen(false); setMessage(t); load() }} />}
    </>
  )
}

const notInHr = <span className="pap-status warning">Belum ada di Data Karyawan</span>

function GradeView({ data }: { data: Payroll }) {
  const [q, setQ] = useState('')
  const [urut, setUrut] = useState<'no' | 'nilai'>('no')
  const [grade, setGrade] = useState('')
  const penilai = data.meta?.penilai ?? []
  const rated = data.grades.filter((g) => g.rata_rata !== null)
  const count = (x: string) => data.grades.filter((g) => g.grade === x).length
  const term = q.trim().toLowerCase()
  const shown = data.grades.filter((g) => (!term || g.nama.toLowerCase().includes(term)) && (!grade || (grade === '-' ? !g.grade : g.grade === grade)))
    // Yang belum dinilai (tanpa nilai dari kepala shift mana pun) di bawah
    .sort((a, b) => Number(a.rata_rata === null) - Number(b.rata_rata === null) || (urut === 'nilai' ? (b.rata_rata ?? -1) - (a.rata_rata ?? -1) : (a.no ?? 0) - (b.no ?? 0)))
  const rule = (x: string) => data.meta?.aturan.find((r) => r.grade === x)?.kriteria
  const toggle = (x: string) => setGrade(grade === x ? '' : x)
  return (
    <>
      <Tiles tiles={[
        ...['A', 'B', 'C'].map((x, i) => ({ label: `Grade ${x}`, value: `${count(x)}`, note: rule(x) ? `Nilai ${rule(x)}` : 'operator', icon: Award, tone: ['stat-0', 'stat-1', 'stat-2'][i], active: grade === x, onClick: () => toggle(x) })),
        { label: 'Belum dinilai', value: `${data.grades.length - rated.length}`, note: `${rated.length} dari ${data.grades.length} operator sudah dinilai`, icon: AlertTriangle, tone: 'stat-3', active: grade === '-', onClick: () => toggle('-') },
      ]} />
      <div className="pap-table-card">
        <div className="pap-card-head"><div><h2>Penilaian operator</h2><p>Nilai Teknis Mesin & QC Product dari tiap kepala shift; rata-rata dihitung dari total penilai yang sudah mengisi.</p></div></div>
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari operator..." /></label>
          <select className="pap-select" value={urut} onChange={(e) => setUrut(e.target.value as 'no' | 'nilai')} aria-label="Urutan">
            <option value="no">Urut nomor</option>
            <option value="nilai">Nilai tertinggi</option>
          </select>
        </div>
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Operator</th>{penilai.map((p) => <th key={p} className="pap-num">{p}</th>)}<th className="pap-num">Rata-rata</th><th>Grade</th></tr></thead>
            <tbody>
              {shown.map((g) => (
                <tr key={g.id}>
                  <td><div className="pap-cell-title">{g.no ? `${g.no}. ` : ''}{g.nama}</div><div className="pap-cell-sub">{g.employee_id ? `${g.nip} · ${g.jabatan ?? ''}` : notInHr}</div></td>
                  {g.rata_rata === null ? <td colSpan={penilai.length + 2} className="pap-muted">Belum dinilai kepala shift (nilai Teknis Mesin & QC Product di spreadsheet masih kosong)</td> : penilai.map((p) => {
                    const s = g.skor.find((x) => x.penilai === p)
                    return <td key={p} className="pap-num pap-nowrap">{s?.total ? <><strong>{formatNumber(s.total, 1)}</strong><div className="pap-cell-sub">T {s.teknis ?? '—'} · QC {s.qc ?? '—'}</div></> : <span className="pap-muted">—</span>}</td>
                  })}
                  {g.rata_rata !== null && <td className="pap-num"><strong>{formatNumber(g.rata_rata, 1)}</strong></td>}
                  {g.rata_rata !== null && <td>{g.grade ? <span className={`pap-status ${GRADE_TONE[g.grade] ?? 'neutral'}`}>{g.grade}</span> : <span className="pap-muted">—</span>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {!data.grades.length && <div className="pap-empty">Belum ada data grade. Sinkron dari spreadsheet Data Grade dan Kenaikan Gaji.</div>}
        </div>
      </div>
    </>
  )
}

function SalaryView({ data }: { data: Payroll }) {
  const [q, setQ] = useState('')
  const p = data.meta?.kebijakan
  const term = q.trim().toLowerCase()
  const shown = data.salaries.filter((s) => !term || s.nama.toLowerCase().includes(term))
  const paged = usePaged(shown, q, 50)
  const sum = (k: keyof Salary) => data.salaries.reduce((t, s) => t + (Number(s[k]) || 0), 0)
  return (
    <>
      <Tiles tiles={[
        { label: 'Karyawan digaji', value: `${data.salaries.length}`, note: p?.wilayah ?? 'Kebijakan gaji operasional', icon: Users, tone: 'stat-1' },
        { label: `Upah ${p?.hari_kerja ?? 25} hari kerja`, value: short(p?.total.upah_bulanan ?? sum('upah_bulanan')), note: 'Total per bulan', icon: Wallet, tone: 'stat-1' },
        { label: 'Total terima', value: short(p?.total.total_terima ?? sum('total_terima')), note: `Tunjangan ${short(p?.total.tunjangan ?? sum('tunjangan'))}`, icon: Wallet, tone: 'stat-0' },
        { label: 'Termasuk BPJS & THR', value: short(p?.total.total_bpjs_thr ?? sum('total_bpjs_thr')), note: `Tanpa THR ${short(p?.total.tanpa_thr ?? sum('tanpa_thr'))}`, icon: Wallet, tone: 'stat-2' },
      ]} />
      {p && (
        <div className="pap-dash-grid pap-fgs-grid">
          <section className="pap-table-card pap-dash-card">
            <div className="pap-card-head"><div><h2>{p.judul ?? 'Kebijakan gaji'}</h2><p>{p.wilayah ?? ''}</p></div></div>
            <div className="pap-dash-body">
              <dl className="pap-detail-grid">
                {p.tingkat.map((t) => <div key={t.label}><dt>{t.label}</dt><dd>{formatRupiah(t.nilai)}</dd></div>)}
              </dl>
            </div>
          </section>
          <section className="pap-table-card pap-dash-card">
            <div className="pap-card-head"><div><h2>Tunjangan grade & lembur</h2><p>Tambahan upah harian per grade</p></div></div>
            <div className="pap-dash-body">
              <dl className="pap-detail-grid">
                {p.grade.map((g) => <div key={g.grade}><dt>Grade {g.grade}</dt><dd>{formatRupiah(g.nominal)} / hari</dd></div>)}
                <div><dt>Hari kerja per bulan</dt><dd>{p.hari_kerja} hari</dd></div>
                {p.faktor_lembur && <div><dt>Lembur hari kerja</dt><dd>{formatNumber(p.faktor_lembur, 2)} × tarif per jam</dd></div>}
                {p.faktor_lembur_libur && <div><dt>Lembur hari libur</dt><dd>{formatNumber(p.faktor_lembur_libur, 2)} × tarif per jam</dd></div>}
              </dl>
            </div>
          </section>
        </div>
      )}
      <div className="pap-table-card">
        <div className="pap-card-head"><div><h2>Gaji per karyawan</h2><p>Sesuai tab kebijakan gaji di spreadsheet (ubah di spreadsheet, lalu sinkron)</p></div></div>
        <div className="pap-filters"><label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari karyawan..." /></label></div>
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Karyawan</th><th>Grade</th><th className="pap-num">Upah harian</th><th className="pap-num">Upah {p?.hari_kerja ?? 25} hari</th><th className="pap-num">Kenaikan</th><th className="pap-num">Tunjangan</th><th className="pap-num">Total terima</th><th className="pap-num">THR</th><th className="pap-num">Per jam</th><th className="pap-num">Lembur / jam</th></tr></thead>
            <tbody>
              {paged.items.map((s) => (
                <tr key={s.id}>
                  <td><div className="pap-cell-title">{s.nama}</div><div className="pap-cell-sub">{s.employee_id ? s.jabatan ?? s.nip : notInHr}</div></td>
                  <td>{s.grade ? <span className={`pap-status ${GRADE_TONE[s.grade] ?? 'neutral'}`}>{s.grade}</span> : '—'}</td>
                  <td className="pap-num pap-nowrap">{rp(s.upah_harian_total ?? s.upah_harian)}{s.nominal_grade ? <div className="pap-cell-sub">+{formatRupiah(s.nominal_grade)} grade</div> : null}</td>
                  <td className="pap-num pap-nowrap">{rp(s.upah_bulanan)}</td>
                  <td className="pap-num pap-nowrap">{rp(s.kenaikan_bulanan)}<div className="pap-cell-sub">{s.kenaikan_persen ? `${formatNumber(s.kenaikan_persen, 2)}%` : ''}</div></td>
                  <td className="pap-num pap-nowrap">{s.tunjangan ? rp(s.tunjangan) : '—'}</td>
                  <td className="pap-num pap-nowrap"><strong>{rp(s.total_terima)}</strong></td>
                  <td className="pap-num pap-nowrap">{rp(s.thr)}</td>
                  <td className="pap-num pap-nowrap">{rp(s.tarif_jam)}</td>
                  <td className="pap-num pap-nowrap">{rp(s.lembur_jam)}<div className="pap-cell-sub">libur {rp(s.lembur_libur_jam)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.salaries.length && <div className="pap-empty">Belum ada data gaji. Sinkron dari spreadsheet Data Grade dan Kenaikan Gaji.</div>}
          <Pager {...paged.pager} noun="karyawan" />
        </div>
      </div>
    </>
  )
}

// Hitung gaji periode & lembur dari tarif di kebijakan gaji (Guidance: perhitungan gaji per jam operator, lembur, lembur wajib)
function OvertimeCalc({ data }: { data: Payroll }) {
  const [id, setId] = useState(data.salaries[0]?.id ?? 0)
  const [hari, setHari] = useState(String(data.meta?.kebijakan?.hari_kerja ?? 25))
  const [lembur, setLembur] = useState('')
  const [libur, setLibur] = useState('')
  const s = data.salaries.find((x) => x.id === Number(id))
  const num = (v: string) => Math.max(0, Number(v.replace(',', '.')) || 0)
  const calc = useMemo(() => {
    if (!s) return null
    const upah = (s.upah_harian_total ?? s.upah_harian ?? 0) * num(hari)
    const l1 = (s.lembur_jam ?? 0) * num(lembur)
    const l2 = (s.lembur_libur_jam ?? 0) * num(libur)
    return { upah, l1, l2, tunjangan: s.tunjangan ?? 0, total: upah + l1 + l2 + (s.tunjangan ?? 0) }
  }, [s, hari, lembur, libur])
  if (!data.salaries.length) return <div className="pap-table-card"><div className="pap-empty">Belum ada data gaji. Sinkron dari spreadsheet Data Grade dan Kenaikan Gaji.</div></div>
  return (
    <div className="pap-dash-grid pap-fgs-grid">
      <section className="pap-table-card pap-dash-card">
        <div className="pap-card-head"><div><h2>Hitung lembur & gaji periode</h2><p>Memakai upah harian, tunjangan, dan tarif lembur per jam karyawan dari kebijakan gaji</p></div></div>
        <div className="pap-dash-body">
          <div className="pap-form-grid">
            <Field label="Karyawan" full>
              <select className="pap-select" value={id} onChange={(e) => setId(Number(e.target.value))}>
                {data.salaries.map((x) => <option key={x.id} value={x.id}>{x.nama} · Grade {x.grade ?? '—'}</option>)}
              </select>
            </Field>
            <Field label="Hari masuk kerja"><input className="pap-input" type="number" min={0} max={31} value={hari} onChange={(e) => setHari(e.target.value)} /></Field>
            <Field label="Jam lembur hari kerja"><input className="pap-input" type="number" min={0} step="0.5" value={lembur} onChange={(e) => setLembur(e.target.value)} placeholder="0" /></Field>
            <Field label="Jam lembur hari libur"><input className="pap-input" type="number" min={0} step="0.5" value={libur} onChange={(e) => setLibur(e.target.value)} placeholder="0" /></Field>
          </div>
        </div>
      </section>
      <section className="pap-table-card pap-dash-card">
        <div className="pap-card-head"><div><h2>{s?.nama ?? '—'}</h2><p>Tarif per jam {rp(s?.tarif_jam)} · lembur {rp(s?.lembur_jam)} · lembur libur {rp(s?.lembur_libur_jam)}</p></div></div>
        {calc && (
          <div className="pap-dash-body">
            <dl className="pap-detail-grid">
              <div><dt>Upah {num(hari)} hari × {rp(s?.upah_harian_total ?? s?.upah_harian)}</dt><dd>{formatRupiah(calc.upah)}</dd></div>
              <div><dt>Lembur hari kerja ({num(lembur)} jam)</dt><dd>{formatRupiah(calc.l1)}</dd></div>
              <div><dt>Lembur hari libur ({num(libur)} jam)</dt><dd>{formatRupiah(calc.l2)}</dd></div>
              <div><dt>Tunjangan</dt><dd>{formatRupiah(calc.tunjangan)}</dd></div>
            </dl>
            <p className="pap-dash-big">{formatRupiah(calc.total)}</p>
            <small className="pap-muted">Perkiraan gaji periode sebelum potongan BPJS/pajak. Tarif mengikuti spreadsheet kebijakan gaji.</small>
          </div>
        )}
      </section>
    </div>
  )
}

// ---------- Sumber data Google Drive ----------
type SheetInfo = { jenis: string; url: string; account: string | null; canSync: boolean; tabs: string[]; dipakai: string | null; jumlah: number; contoh: string[]; error?: string }

function HrSheetSync({ jenis, onClose, onImported }: { jenis: 'karyawan' | 'grade'; onClose: () => void; onImported: (message: string) => void }) {
  const [data, setData] = useState<SheetInfo | null>(null)
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const label = jenis === 'karyawan' ? 'Data Karyawan' : 'Data Grade dan Kenaikan Gaji'
  const preview = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api<SheetInfo>(`/api/hrd/sheet?jenis=${jenis}`)
      setData(res)
      setUrl(res.url)
      if (res.error) setError(res.error)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [jenis])
  useEffect(() => { preview() }, [preview])
  async function saveUrl() {
    setBusy(true)
    setError('')
    try {
      await api(`/api/hrd/sheet?jenis=${jenis}`, { method: 'PUT', json: { url } })
      await preview()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function sync() {
    setBusy(true)
    setError('')
    try {
      const res = await api<{ karyawan?: number; aktif?: number; grade?: number; gaji?: number }>(`/api/hrd/sheet?jenis=${jenis}`, { method: 'POST' })
      onImported(jenis === 'karyawan' ? `Sinkron Data Karyawan selesai: ${res.karyawan} karyawan (${res.aktif} aktif).` : `Sinkron Grade & Gaji selesai: ${res.grade} baris grade, ${res.gaji} baris gaji.`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const canSync = data?.canSync ?? false
  return (
    <Modal title={`${label} dari Google Drive`} subtitle={data?.account ? `Dibaca dengan akun Google ${data.account} (sama dengan Master Data > Logo & Desain)` : 'Memakai akun Google yang terhubung di Master Data > Logo & Desain'} wide onClose={onClose}
      footer={<><button className="pap-btn" disabled={loading || busy} onClick={preview}><RefreshCw /> Muat ulang</button><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Tutup</button>{canSync && <button className="pap-primary-button" disabled={loading || busy || !data?.jumlah} onClick={sync}>{busy ? 'Menyinkronkan...' : 'Sinkron sekarang'}</button>}</>}>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <Field label={`Link spreadsheet ${label}`}>
        <div className="pap-inline-actions">
          <input className="pap-input" value={url} disabled={!!data && !canSync} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." />
          {url && <a className="pap-icon-button" href={url} target="_blank" rel="noreferrer" aria-label="Buka spreadsheet"><ExternalLink /></a>}
          {canSync && url && url !== data?.url && <button className="pap-btn" disabled={busy} onClick={saveUrl}>Simpan link</button>}
        </div>
      </Field>
      <p className="pap-muted">
        {jenis === 'karyawan'
          ? 'Spreadsheet (Google Sheet atau file Excel di Drive) dibagikan ke akun Google tersebut (Viewer). Dibaca: baris judul berisi NIP & Nama Depan, satu baris per karyawan (NIP sebagai kunci). Karyawan yang tidak ada lagi di spreadsheet dihapus dari SIMPAP.'
          : 'Dibaca: tab grade (kolom NAMA, KASHIFT ..., GRADE dengan sub kolom TEKNIS MESIN / QC PRODUCT / TOTAL) dan tab kebijakan gaji (NAMA, UPAH 7 JAM KERJA, GRADE, KENAIKAN, TUNJANGAN, THR, Tarif Gaji Per-Jam). Data dicocokkan ke Data Karyawan lewat nama.'}
        {' '}Sinkron otomatis berjalan bersama sinkron Google Drive (±30 menit).
      </p>
      {loading ? <p className="pap-muted">Membaca spreadsheet...</p> : data && (
        <>
          <ul className="pap-dash-agenda">
            {data.tabs.map((t) => <li key={t}><div className="pap-sync-tab"><FileSpreadsheet /><span><b>{t}</b>{data.dipakai?.includes(t) ? ' · dipakai' : ''}</span></div></li>)}
          </ul>
          {data.jumlah > 0 && <div className="pap-muted">{data.contoh.map((c) => <div key={c}>{c}</div>)}</div>}
        </>
      )}
      {!canSync && data && <p className="pap-muted">Sinkron dijalankan HRD dan GM.</p>}
    </Modal>
  )
}
