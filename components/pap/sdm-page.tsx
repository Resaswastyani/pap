'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarCheck2, CalendarOff, CheckCircle2, Clock, Download, ExternalLink, Gauge, Pencil, Plus, Search, ShieldPlus, Stamp, Trash2, XCircle } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { formatRupiah } from './accurate'
import { MonthNav, monthLabel } from './accurate-production'
import { api, Field, formatDate, Modal, Notice, Pager, RowActions, usePaged } from './ui'

const thisMonth = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7)
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
const s = (x: unknown) => (x === null || x === undefined ? '' : String(x))

// ======================= Izin & Cuti =======================
const JENIS = { cuti: 'Cuti tahunan', izin: 'Izin', sakit: 'Sakit', dayoff: 'Dayoff / tukar libur', dinas: 'Dinas luar', cuti_khusus: 'Cuti khusus' } as const
type Jenis = keyof typeof JENIS
const LSTATUS = { diajukan: ['Menunggu', 'warning'], disetujui: ['Disetujui', 'success'], ditolak: ['Ditolak', 'danger'], dibatalkan: ['Dibatalkan', 'neutral'] } as const
type LStatus = keyof typeof LSTATUS
type Leave = {
  id: number; nomor: string; nip: string; nama: string; divisi: string | null; jenis: Jenis; tanggal_mulai: string; tanggal_selesai: string; hari: number; alasan: string | null
  lampiran_url: string | null; status: LStatus; catatan_approval: string | null; approved_name: string | null; approved_at: string | null; created_by: number; created_name: string | null; created_at: string
}
type Balance = { jatah: number; terpakai: number; menunggu: number; sisa: number; berhak_sejak: string | null }
type Emp = { nip: string; nama: string; divisi: string | null; jabatan: string | null; tgl_masuk: string | null; cuti: Balance | null }
type LeaveRes = { items: Leave[]; employees: Emp[]; stats: { menunggu: number; hari_ini: number; minggu_ini: number; cuti_tahun: number }; tahun: number; can: { approve: boolean } }
const range = (a: string, b: string) => (a === b ? formatDate(a) : `${formatDate(a)} – ${formatDate(b)}`)

export function LeavePage({ user }: { user: UserProfile }) {
  const [tab, setTab] = useState<'pengajuan' | 'saldo'>('pengajuan')
  const [filter, setFilter] = useState<'semua' | 'menunggu'>('semua')
  const [tahun, setTahun] = useState(() => Number(today().slice(0, 4)))
  const [q, setQ] = useState('')
  const [data, setData] = useState<LeaveRes | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState<Leave | 'baru' | null>(null)
  const [detail, setDetail] = useState<Leave | null>(null)
  const load = useCallback(() => {
    api<LeaveRes>(`/api/hrd/leaves?tahun=${tahun}&status=${filter}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`).then((r) => { setData(r); setError('') }).catch((e) => setError(e.message))
  }, [tahun, filter, q])
  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t) }, [load, q])
  const flash = (t: string) => { setMessage(t); setTimeout(() => setMessage(''), 6000); load() }
  const term = q.trim().toLowerCase()
  const emps = (data?.employees ?? []).filter((e) => !term || `${e.nama} ${e.nip} ${e.divisi ?? ''}`.toLowerCase().includes(term))
  const pagedL = usePaged(data?.items ?? [], `${filter}-${tahun}-${q}`, 50)
  const pagedE = usePaged(emps, `${tahun}-${q}`, 50)
  const st = data?.stats
  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">SDM</p>
          <h1>Izin & Cuti</h1>
          <span>Pengajuan cuti, izin, sakit, dayoff, dan dinas luar karyawan. Setelah disetujui HRD / GM, tanggalnya otomatis ditandai di Absensi dan ikut dihitung di gaji.</span>
        </div>
        <div className="pap-inline-actions pap-wrap">
          <select className="pap-select" value={tahun} onChange={(e) => setTahun(Number(e.target.value))} aria-label="Tahun">
            {[0, 1, 2].map((k) => Number(today().slice(0, 4)) - k).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button className="pap-primary-button" onClick={() => setForm('baru')}><Plus /> Ajukan izin / cuti</button>
        </div>
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-stat-grid four">
        <button className={`pap-stat-card pap-stat-button ${filter === 'menunggu' ? 'active' : ''}`} onClick={() => { setTab('pengajuan'); setFilter(filter === 'menunggu' ? 'semua' : 'menunggu') }}>
          <div><span>Menunggu persetujuan</span><strong className="pap-stat-text">{st?.menunggu ?? '…'}</strong><small className="neutral">{data?.can.approve ? 'Perlu diproses HRD / GM' : 'Pengajuan Anda'}</small></div>
          <div className={`pap-stat-icon ${st?.menunggu ? 'stat-2' : 'stat-0'}`}><Clock /></div>
        </button>
        <div className="pap-stat-card"><div><span>Tidak masuk hari ini</span><strong className="pap-stat-text">{st?.hari_ini ?? '…'}</strong><small className="neutral">Izin / cuti disetujui</small></div><div className="pap-stat-icon stat-1"><CalendarOff /></div></div>
        <div className="pap-stat-card"><div><span>Mulai 7 hari ke depan</span><strong className="pap-stat-text">{st?.minggu_ini ?? '…'}</strong><small className="neutral">Rencana izin / cuti</small></div><div className="pap-stat-icon stat-1"><CalendarCheck2 /></div></div>
        <button className={`pap-stat-card pap-stat-button ${tab === 'saldo' ? 'active' : ''}`} onClick={() => setTab('saldo')}>
          <div><span>Cuti tahunan terpakai {tahun}</span><strong className="pap-stat-text">{st ? `${st.cuti_tahun} hari` : '…'}</strong><small className="neutral">Lihat sisa cuti per karyawan</small></div>
          <div className="pap-stat-icon stat-0"><CheckCircle2 /></div>
        </button>
      </div>
      <div className="pap-table-card">
        <div className="pap-card-head">
          <div className="pap-segmented" role="tablist">
            <button role="tab" aria-selected={tab === 'pengajuan'} className={tab === 'pengajuan' ? 'active' : ''} onClick={() => setTab('pengajuan')}>Pengajuan ({data?.items.length ?? 0})</button>
            <button role="tab" aria-selected={tab === 'saldo'} className={tab === 'saldo' ? 'active' : ''} onClick={() => setTab('saldo')}>Sisa cuti karyawan</button>
          </div>
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama / NIP / nomor..." /></label>
        </div>
        <div className="pap-table-wrap">
          {tab === 'pengajuan' ? (
            <table>
              <thead><tr><th>Pengajuan</th><th>Karyawan</th><th>Jenis</th><th>Tanggal</th><th className="pap-num">Hari</th><th>Status</th><th className="pap-actions-col">Aksi</th></tr></thead>
              <tbody>
                {pagedL.items.map((l) => (
                  <tr key={l.id} className="pap-row-link" onClick={() => setDetail(l)}>
                    <td className="pap-nowrap"><div className="pap-cell-title">{l.nomor}</div><div className="pap-cell-sub">oleh {l.created_name ?? '—'}</div></td>
                    <td>{l.nama}<div className="pap-cell-sub">{[l.nip, l.divisi].filter(Boolean).join(' · ')}</div></td>
                    <td>{JENIS[l.jenis]}{l.alasan && <div className="pap-cell-sub pap-clamp">{l.alasan}</div>}</td>
                    <td className="pap-nowrap">{range(l.tanggal_mulai, l.tanggal_selesai)}</td>
                    <td className="pap-num">{String(l.hari).replace('.', ',')}</td>
                    <td><span className={`pap-status ${LSTATUS[l.status][1]}`}>{LSTATUS[l.status][0]}</span>{l.approved_name && l.status !== 'diajukan' && <div className="pap-cell-sub">{l.approved_name}</div>}</td>
                    <td className="pap-actions-cell"><RowActions label={l.nomor} onView={() => setDetail(l)} onEdit={(data?.can.approve || (l.created_by === user.id && l.status === 'diajukan')) && ['diajukan', 'disetujui'].includes(l.status) ? () => setForm(l) : undefined} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table>
              <thead><tr><th>Karyawan</th><th>Masuk kerja</th><th className="pap-num">Jatah {tahun}</th><th className="pap-num">Terpakai</th><th className="pap-num">Menunggu</th><th className="pap-num">Sisa</th></tr></thead>
              <tbody>
                {pagedE.items.map((e) => (
                  <tr key={e.nip}>
                    <td>{e.nama}<div className="pap-cell-sub">{[e.nip, e.divisi, e.jabatan].filter(Boolean).join(' · ')}</div></td>
                    <td className="pap-nowrap">{formatDate(e.tgl_masuk)}{e.cuti && !e.cuti.jatah && <div className="pap-cell-sub">berhak cuti {formatDate(e.cuti.berhak_sejak)}</div>}</td>
                    <td className="pap-num">{e.cuti?.jatah ?? '—'}</td><td className="pap-num">{e.cuti?.terpakai ?? 0}</td><td className="pap-num">{e.cuti?.menunggu || '—'}</td>
                    <td className="pap-num"><strong className={e.cuti && e.cuti.sisa <= 0 && e.cuti.jatah ? 'pap-text-danger' : ''}>{e.cuti?.sisa ?? '—'}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {data && tab === 'pengajuan' && !data.items.length && <div className="pap-empty">{filter === 'menunggu' ? 'Tidak ada pengajuan yang menunggu.' : 'Belum ada pengajuan.'}</div>}
          {!data && !error && <div className="pap-empty">Memuat...</div>}
          {tab === 'pengajuan' ? <Pager {...pagedL.pager} noun="pengajuan" /> : <Pager {...pagedE.pager} noun="karyawan" />}
        </div>
      </div>
      {form && data && <LeaveForm item={form === 'baru' ? null : form} employees={data.employees} approver={data.can.approve} onClose={() => setForm(null)} onSaved={(t) => { setForm(null); flash(t) }} />}
      {detail && data && <LeaveDetail item={detail} user={user} approver={data.can.approve} onClose={() => setDetail(null)} onEdit={() => { setForm(detail); setDetail(null) }} onChanged={(t) => { setDetail(null); flash(t) }} />}
    </>
  )
}

const workDays = (a: string, b: string) => {
  let n = 0
  for (let d = Date.parse(`${a}T00:00:00Z`); a && b && d <= Date.parse(`${b}T00:00:00Z`) && n < 400; d += 86400e3) if (new Date(d).getUTCDay() !== 0) n++
  return n
}

function LeaveForm({ item, employees, approver, onClose, onSaved }: { item: Leave | null; employees: Emp[]; approver: boolean; onClose: () => void; onSaved: (t: string) => void }) {
  const [v, setV] = useState({ nip: s(item?.nip), jenis: (item?.jenis ?? 'izin') as Jenis, tanggal_mulai: item?.tanggal_mulai ?? today(), tanggal_selesai: item?.tanggal_selesai ?? today(), hari: s(item?.hari), alasan: s(item?.alasan), lampiran_url: s(item?.lampiran_url) })
  const [cari, setCari] = useState(item ? `${item.nama} (${item.nip})` : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const emp = employees.find((e) => e.nip === v.nip)
  const auto = workDays(v.tanggal_mulai, v.tanggal_selesai || v.tanggal_mulai)
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((cur) => ({ ...cur, [k]: e.target.value }))
  const pick = (text: string) => {
    setCari(text)
    const m = employees.find((e) => `${e.nama} (${e.nip})` === text)
    setV((cur) => ({ ...cur, nip: m?.nip ?? '' }))
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!v.nip) return setError('Pilih karyawan dari daftar.')
    setBusy(true)
    try {
      if (item) await api(`/api/hrd/leaves/${item.id}`, { method: 'PUT', json: v })
      else {
        const r = await api<{ nomor: string; auto: boolean }>('/api/hrd/leaves', { method: 'POST', json: v })
        return onSaved(r.auto ? `${r.nomor} disimpan dan langsung disetujui; Absensi sudah ditandai.` : `${r.nomor} diajukan. HRD / GM mendapat notifikasi untuk persetujuan.`)
      }
      onSaved('Pengajuan diperbarui.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={item ? `Ubah ${item.nomor}` : 'Ajukan izin / cuti'} subtitle={approver && !item ? 'Diajukan HRD / GM langsung berstatus disetujui' : undefined} onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="leave-form" disabled={busy}>{busy ? 'Menyimpan...' : item ? 'Simpan' : 'Ajukan'}</button></>}>
      <form id="leave-form" className="pap-form-grid" onSubmit={submit}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Karyawan *" full hint={emp ? [emp.divisi, emp.jabatan, emp.cuti?.jatah ? `sisa cuti ${emp.cuti.sisa} hari${emp.cuti.menunggu ? ` (${emp.cuti.menunggu} menunggu)` : ''}` : 'belum berhak cuti tahunan'].filter(Boolean).join(' · ') : 'Ketik nama lalu pilih dari daftar'}>
          <input className="pap-input" list="pap-emps" value={cari} onChange={(e) => pick(e.target.value)} placeholder="Nama / NIP karyawan" required />
          <datalist id="pap-emps">{employees.map((e) => <option key={e.nip} value={`${e.nama} (${e.nip})`}>{e.divisi ?? ''}</option>)}</datalist>
        </Field>
        <Field label="Jenis *"><select className="pap-select" value={v.jenis} onChange={set('jenis')}>{Object.entries(JENIS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Jumlah hari" hint={`Otomatis ${auto} hari (tanpa Minggu) bila dikosongkan; bisa 0,5`}><input className="pap-input pap-num" inputMode="decimal" value={v.hari} onChange={set('hari')} placeholder={String(auto)} /></Field>
        <Field label="Mulai *"><input className="pap-input" type="date" required value={v.tanggal_mulai} onChange={(e) => setV((cur) => ({ ...cur, tanggal_mulai: e.target.value, tanggal_selesai: cur.tanggal_selesai < e.target.value ? e.target.value : cur.tanggal_selesai }))} /></Field>
        <Field label="Sampai *"><input className="pap-input" type="date" required min={v.tanggal_mulai} value={v.tanggal_selesai} onChange={set('tanggal_selesai')} /></Field>
        <Field label="Alasan / keterangan" full><textarea className="pap-input" rows={3} maxLength={1000} value={v.alasan} onChange={set('alasan')} placeholder={v.jenis === 'dayoff' ? 'mis. tukar libur dengan tanggal ... (lembur hari Minggu)' : ''} /></Field>
        <Field label="Lampiran (link)" full hint={v.jenis === 'sakit' ? 'Surat dokter, mis. link Google Drive' : 'Opsional'}><input className="pap-input" type="url" maxLength={500} value={v.lampiran_url} onChange={set('lampiran_url')} placeholder="https://" /></Field>
      </form>
    </Modal>
  )
}

function LeaveDetail({ item, user, approver, onClose, onEdit, onChanged }: { item: Leave; user: UserProfile; approver: boolean; onClose: () => void; onEdit: () => void; onChanged: (t: string) => void }) {
  const [catatan, setCatatan] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const mine = item.created_by === user.id
  async function act(action: 'setujui' | 'tolak' | 'batal') {
    if (action !== 'setujui' && !window.confirm(action === 'tolak' ? 'Tolak pengajuan ini?' : 'Batalkan pengajuan ini?')) return
    setBusy(true)
    try {
      await api(`/api/hrd/leaves/${item.id}`, { method: 'PATCH', json: { action, catatan } })
      onChanged(`${item.nomor} ${action === 'setujui' ? 'disetujui; Absensi sudah ditandai' : action === 'tolak' ? 'ditolak' : 'dibatalkan'}.`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    if (!window.confirm(`Hapus ${item.nomor}?`)) return
    try {
      await api(`/api/hrd/leaves/${item.id}`, { method: 'DELETE' })
      onChanged(`${item.nomor} dihapus.`)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const canEdit = (approver || (mine && item.status === 'diajukan')) && ['diajukan', 'disetujui'].includes(item.status)
  return (
    <Modal title={`${JENIS[item.jenis]} · ${item.nama}`} subtitle={item.nomor} onClose={onClose}
      footer={<>
        {(approver || (mine && item.status === 'diajukan')) && <button className="pap-btn danger" onClick={remove}><Trash2 /> Hapus</button>}
        <span className="pap-spacer" />
        {canEdit && <button className="pap-btn" onClick={onEdit}><Pencil /> Ubah</button>}
        {(approver ? ['diajukan', 'disetujui'] : mine ? ['diajukan'] : []).includes(item.status) && <button className="pap-btn" disabled={busy} onClick={() => act('batal')}>Batalkan</button>}
        {approver && item.status === 'diajukan' && <button className="pap-btn danger" disabled={busy} onClick={() => act('tolak')}><XCircle /> Tolak</button>}
        {approver && item.status === 'diajukan' && <button className="pap-primary-button" disabled={busy} onClick={() => act('setujui')}><CheckCircle2 /> Setujui</button>}
      </>}>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-detail-badges"><span className={`pap-status ${LSTATUS[item.status][1]}`}>{LSTATUS[item.status][0]}</span></div>
      <dl className="pap-detail-grid">
        <div><dt>Karyawan</dt><dd>{item.nama}<div className="pap-cell-sub">{[item.nip, item.divisi].filter(Boolean).join(' · ')}</div></dd></div>
        <div><dt>Tanggal</dt><dd>{range(item.tanggal_mulai, item.tanggal_selesai)} · {String(item.hari).replace('.', ',')} hari</dd></div>
        <div><dt>Diajukan</dt><dd>{item.created_name ?? '—'} · {formatDate(item.created_at, true)}</dd></div>
        <div><dt>{item.status === 'ditolak' ? 'Ditolak' : 'Diproses'}</dt><dd>{item.approved_name ? `${item.approved_name} · ${formatDate(item.approved_at, true)}` : '—'}{item.catatan_approval && <div className="pap-cell-sub">{item.catatan_approval}</div>}</dd></div>
        <div className="full"><dt>Alasan</dt><dd className="pap-prewrap">{item.alasan ?? '—'}</dd></div>
        {item.lampiran_url && <div className="full"><dt>Lampiran</dt><dd><a href={item.lampiran_url} target="_blank" rel="noreferrer" className="pap-link-button"><ExternalLink /> Buka lampiran</a></dd></div>}
      </dl>
      {approver && item.status === 'diajukan' && <Field label="Catatan persetujuan (opsional)"><input className="pap-input" maxLength={500} value={catatan} onChange={(e) => setCatatan(e.target.value)} /></Field>}
    </Modal>
  )
}

// ======================= KPI Karyawan =======================
type Ind = 'kehadiran' | 'ketepatan' | 'grade' | 'produktivitas' | 'kualitas' | 'sikap'
type KpiRow = {
  nip: string; nama: string; divisi: string | null; jabatan: string | null; status_karyawan: string | null; grade: string | null; nilai: Record<Ind, number | null>; skor: number | null
  predikat: { kode: string; label: string } | null; lengkap: boolean; skala: Record<'produktivitas' | 'kualitas' | 'sikap', number | null>
  absensi: { hari_kerja: number; hadir: number; terlambat: number; terlambat_menit: number; alpa: number; izin: number; sakit: number; cuti: number; lembur_jam: number }
  catatan: string | null; tindak_lanjut: string | null; penilai: string | null
}
type KpiRes = { periode: string; items: KpiRow[]; indikator: Record<Ind, { label: string; bobot: number; auto: boolean; hint: string }>; can: { score: boolean } }
const PRED_TONE: Record<string, string> = { A: 'success', B: 'success', C: 'info', D: 'warning', E: 'danger' }
const pct = (v: number | null) => (v === null ? '—' : `${String(Math.round(v * 10) / 10).replace('.', ',')}`)

export function EmployeeKpiPage(_props: { user: UserProfile }) {
  const [periode, setPeriode] = useState(thisMonth)
  const [divisi, setDivisi] = useState('Produksi')
  const [q, setQ] = useState('')
  const [data, setData] = useState<KpiRes | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [edit, setEdit] = useState<KpiRow | null>(null)
  const load = useCallback(() => { api<KpiRes>(`/api/hrd/kpi?periode=${periode}`).then((r) => { setData(r); setError('') }).catch((e) => setError(e.message)) }, [periode])
  useEffect(() => { setData(null); load() }, [load])
  const divisions = useMemo(() => [...new Set((data?.items ?? []).map((x) => x.divisi ?? 'Tanpa divisi'))].sort(), [data])
  const term = q.trim().toLowerCase()
  const rows = (data?.items ?? []).filter((x) => (divisi === 'semua' || (x.divisi ?? 'Tanpa divisi') === divisi) && (!term || `${x.nama} ${x.nip} ${x.jabatan ?? ''}`.toLowerCase().includes(term)))
  const paged = usePaged(rows, `${periode}-${divisi}-${q}`, 50)
  const scored = rows.filter((x) => x.skor !== null)
  const avg = scored.length ? scored.reduce((t, x) => t + x.skor!, 0) / scored.length : null
  const pembinaan = rows.filter((x) => x.predikat && ['D', 'E'].includes(x.predikat.kode)).length
  const belum = rows.filter((x) => !x.lengkap).length
  const ind = data?.indikator
  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">SDM</p>
          <h1>KPI Karyawan</h1>
          <span>Performa karyawan & operator per bulan: kehadiran dan ketepatan waktu dari Absensi, grade operator dari kepala shift, ditambah penilaian atasan dan tindak lanjut pembinaan.</span>
        </div>
        <MonthNav periode={periode} onChange={setPeriode} />
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-stat-grid four">
        <div className="pap-stat-card"><div><span>Karyawan dinilai</span><strong className="pap-stat-text">{data ? rows.length : '…'}</strong><small className="neutral">{divisi === 'semua' ? 'Semua divisi' : divisi} · {monthLabel(periode)}</small></div><div className="pap-stat-icon stat-1"><Gauge /></div></div>
        <div className="pap-stat-card"><div><span>Rata-rata skor</span><strong className="pap-stat-text">{avg === null ? '—' : pct(avg)}</strong><small className="neutral">Skala 0–100</small></div><div className="pap-stat-icon stat-0"><CheckCircle2 /></div></div>
        <div className="pap-stat-card"><div><span>Perlu pembinaan</span><strong className="pap-stat-text">{data ? pembinaan : '…'}</strong><small className="neutral">Predikat D / E (skor &lt; 70)</small></div><div className={`pap-stat-icon ${pembinaan ? 'stat-2' : 'stat-0'}`}><AlertTriangle /></div></div>
        <div className="pap-stat-card"><div><span>Belum dinilai atasan</span><strong className="pap-stat-text">{data ? belum : '…'}</strong><small className="neutral">Produktivitas, kualitas, sikap</small></div><div className="pap-stat-icon stat-1"><Clock /></div></div>
      </div>
      <div className="pap-table-card">
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama / NIP / jabatan..." /></label>
          <select className="pap-select" value={divisi} onChange={(e) => setDivisi(e.target.value)} aria-label="Divisi">
            <option value="semua">Semua divisi</option>{divisions.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          {ind && <span className="pap-muted">Bobot: {(Object.keys(ind) as Ind[]).map((k) => `${ind[k].label} ${ind[k].bobot}%`).join(' · ')}</span>}
        </div>
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Karyawan</th><th className="pap-num" title="% hadir dari hari kerja">Hadir</th><th className="pap-num">Tepat waktu</th><th className="pap-num">Grade</th><th className="pap-num">Produktif</th><th className="pap-num">Kualitas</th><th className="pap-num">Sikap</th><th className="pap-num">Skor</th><th>Predikat</th><th className="pap-actions-col">Aksi</th></tr></thead>
            <tbody>
              {paged.items.map((x) => (
                <tr key={x.nip} className={data?.can.score ? 'pap-row-link' : ''} onClick={() => data?.can.score && setEdit(x)}>
                  <td>{x.nama}<div className="pap-cell-sub">{[x.jabatan, x.divisi].filter(Boolean).join(' · ')}</div>{x.tindak_lanjut && <div className="pap-cell-sub pap-text-danger pap-clamp">Tindak lanjut: {x.tindak_lanjut}</div>}</td>
                  <td className="pap-num pap-nowrap" title={`${x.absensi.hadir}/${x.absensi.hari_kerja} hari · alpa ${x.absensi.alpa}, izin ${x.absensi.izin}, sakit ${x.absensi.sakit}, cuti ${x.absensi.cuti}`}>{pct(x.nilai.kehadiran)}<div className="pap-cell-sub">{x.absensi.hadir}/{x.absensi.hari_kerja} hr</div></td>
                  <td className="pap-num pap-nowrap" title={`${x.absensi.terlambat_menit} menit terlambat`}>{pct(x.nilai.ketepatan)}{x.absensi.terlambat > 0 && <div className="pap-cell-sub">{x.absensi.terlambat}× telat</div>}</td>
                  <td className="pap-num pap-nowrap">{pct(x.nilai.grade)}{x.grade && <div className="pap-cell-sub">Grade {x.grade}</div>}</td>
                  <td className="pap-num">{x.skala.produktivitas ?? '—'}</td><td className="pap-num">{x.skala.kualitas ?? '—'}</td><td className="pap-num">{x.skala.sikap ?? '—'}</td>
                  <td className="pap-num"><strong>{pct(x.skor)}</strong></td>
                  <td>{x.predikat ? <span className={`pap-status ${PRED_TONE[x.predikat.kode]}`}>{x.predikat.kode} · {x.predikat.label}</span> : '—'}</td>
                  <td className="pap-actions-cell">{data?.can.score && <RowActions label={x.nama} onEdit={() => setEdit(x)} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && !rows.length && <div className="pap-empty">Tidak ada karyawan.</div>}
          {!data && !error && <div className="pap-empty">Memuat...</div>}
          <Pager {...paged.pager} noun="karyawan" />
        </div>
      </div>
      {edit && ind && <KpiForm row={edit} periode={periode} ind={ind} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); setMessage(`Penilaian ${edit.nama} disimpan.`); load() }} />}
    </>
  )
}

function KpiForm({ row, periode, ind, onClose, onSaved }: { row: KpiRow; periode: string; ind: KpiRes['indikator']; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ produktivitas: s(row.skala.produktivitas), kualitas: s(row.skala.kualitas), sikap: s(row.skala.sikap), catatan: s(row.catatan), tindak_lanjut: s(row.tindak_lanjut) })
  const [error, setError] = useState('')
  async function save(e: React.FormEvent) {
    e.preventDefault()
    try {
      await api('/api/hrd/kpi', { method: 'PUT', json: { periode, nip: row.nip, nilai: { produktivitas: v.produktivitas, kualitas: v.kualitas, sikap: v.sikap }, catatan: v.catatan, tindak_lanjut: v.tindak_lanjut } })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    }
  }
  const SKALA = ['', '1 · Sangat kurang', '2 · Kurang', '3 · Cukup', '4 · Baik', '5 · Sangat baik']
  return (
    <Modal title={`Penilaian ${row.nama}`} subtitle={`${monthLabel(periode)} · ${[row.jabatan, row.divisi].filter(Boolean).join(' · ')}`} onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="kpi-form">Simpan</button></>}>
      <form id="kpi-form" className="pap-form-grid" onSubmit={save}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <dl className="pap-detail-grid full">
          <div><dt>{ind.kehadiran.label}</dt><dd>{pct(row.nilai.kehadiran)} · {row.absensi.hadir}/{row.absensi.hari_kerja} hari<div className="pap-cell-sub">alpa {row.absensi.alpa} · izin {row.absensi.izin} · sakit {row.absensi.sakit} · cuti {row.absensi.cuti}</div></dd></div>
          <div><dt>{ind.ketepatan.label}</dt><dd>{pct(row.nilai.ketepatan)}<div className="pap-cell-sub">{row.absensi.terlambat}× terlambat · {row.absensi.terlambat_menit} menit · lembur {row.absensi.lembur_jam} jam</div></dd></div>
          <div><dt>{ind.grade.label}</dt><dd>{row.grade ? `Grade ${row.grade} · ${pct(row.nilai.grade)}` : 'Belum ada di Draft Grade'}</dd></div>
          <div><dt>Skor saat ini</dt><dd><strong>{pct(row.skor)}</strong>{row.predikat && ` · ${row.predikat.label}`}{row.penilai && <div className="pap-cell-sub">dinilai {row.penilai}</div>}</dd></div>
        </dl>
        {(['produktivitas', 'kualitas', 'sikap'] as const).map((k) => (
          <Field key={k} label={`${ind[k].label} (${ind[k].bobot}%)`} hint={ind[k].hint}>
            <select className="pap-select" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })}>{SKALA.map((l, i) => <option key={i} value={i ? String(i) : ''}>{l || 'Belum dinilai'}</option>)}</select>
          </Field>
        ))}
        <Field label="Catatan atasan" full><textarea className="pap-input" rows={2} maxLength={1000} value={v.catatan} onChange={(e) => setV({ ...v, catatan: e.target.value })} /></Field>
        <Field label="Tindak lanjut / pembinaan" full hint="mis. training ulang SOP mesin, teguran lisan, SP1, rotasi shift"><textarea className="pap-input" rows={2} maxLength={1000} value={v.tindak_lanjut} onChange={(e) => setV({ ...v, tindak_lanjut: e.target.value })} /></Field>
      </form>
    </Modal>
  )
}

// ======================= Laporan BPJS =======================
type BpjsRow = {
  no: number; nip: string; nama: string; jabatan: string | null; divisi: string | null; no_bpjs_tk: string | null; no_bpjs_kes: string | null
  dasar_tk: number; dasar_kes: number; dasar_jp: number; kes_p: number; kes_k: number; jht_p: number; jht_k: number; jkk: number; jkm: number; jp_p: number; jp_k: number
  tk_ditanggung: string; kes_ditanggung: string; total_tk: number; total_kes: number; total: number; beban_perusahaan: number; potongan_pegawai: number; catatan: string[]
}
type BpjsRes = {
  periode: string; dari: string; sampai: string; items: BpjsRow[]; tarif: Record<string, number>
  total: Record<'peserta_tk' | 'peserta_kes' | 'jht_p' | 'jht_k' | 'jkk' | 'jkm' | 'jp_p' | 'jp_k' | 'kes_p' | 'kes_k' | 'total_tk' | 'total_kes' | 'total' | 'beban_perusahaan' | 'potongan_pegawai' | 'belum_tk' | 'belum_kes', number>
}

export function BpjsPage(_props: { user: UserProfile }) {
  const [periode, setPeriode] = useState(thisMonth)
  const [prog, setProg] = useState<'tk' | 'kes'>('tk')
  const [q, setQ] = useState('')
  const [data, setData] = useState<BpjsRes | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    setData(null)
    api<BpjsRes>(`/api/hrd/bpjs?periode=${periode}`).then((r) => alive && (setData(r), setError(''))).catch((e) => alive && setError(e.message))
    return () => { alive = false }
  }, [periode])
  const term = q.trim().toLowerCase()
  const rows = (data?.items ?? []).filter((x) => !term || `${x.nama} ${x.nip}`.toLowerCase().includes(term))
  const paged = usePaged(rows, `${periode}-${q}-${prog}`, 50)
  const t = data?.total
  const tr = data?.tarif
  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">SDM</p>
          <h1>Laporan BPJS</h1>
          <span>Iuran BPJS Ketenagakerjaan (JHT, JKK, JKM, JP) dan BPJS Kesehatan per karyawan, dihitung dari data gaji yang sama dengan menu Grade & Gaji. Unduh Excel untuk pelaporan & pembayaran iuran.</span>
        </div>
        <div className="pap-inline-actions pap-wrap">
          <MonthNav periode={periode} onChange={setPeriode} />
          <a className="pap-primary-button" href={`/api/hrd/bpjs/xlsx?periode=${periode}`}><Download /> Unduh Excel</a>
        </div>
      </div>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-stat-grid four">
        <div className="pap-stat-card"><div><span>BPJS Ketenagakerjaan</span><strong className="pap-stat-text">{t ? formatRupiah(t.total_tk) : '…'}</strong><small className="neutral">{t ? `${t.peserta_tk} peserta` : ''}</small></div><div className="pap-stat-icon stat-1"><ShieldPlus /></div></div>
        <div className="pap-stat-card"><div><span>BPJS Kesehatan</span><strong className="pap-stat-text">{t ? formatRupiah(t.total_kes) : '…'}</strong><small className="neutral">{t ? `${t.peserta_kes} peserta` : ''}</small></div><div className="pap-stat-icon stat-0"><ShieldPlus /></div></div>
        <div className="pap-stat-card"><div><span>Beban perusahaan / potong gaji</span><strong className="pap-stat-text">{t ? formatRupiah(t.beban_perusahaan) : '…'}</strong><small className="neutral">{t ? `Dipotong dari gaji ${formatRupiah(t.potongan_pegawai)}` : ''}</small></div><div className="pap-stat-icon stat-1"><CheckCircle2 /></div></div>
        <div className="pap-stat-card"><div><span>Belum terdaftar</span><strong className="pap-stat-text">{t ? `${t.belum_tk} / ${t.belum_kes}` : '…'}</strong><small className="neutral">Tanpa No. BPJS TK / Kesehatan</small></div><div className={`pap-stat-icon ${t && (t.belum_tk || t.belum_kes) ? 'stat-2' : 'stat-0'}`}><AlertTriangle /></div></div>
      </div>
      <div className="pap-table-card">
        <div className="pap-card-head">
          <div className="pap-segmented" role="tablist">
            <button role="tab" aria-selected={prog === 'tk'} className={prog === 'tk' ? 'active' : ''} onClick={() => setProg('tk')}>Ketenagakerjaan</button>
            <button role="tab" aria-selected={prog === 'kes'} className={prog === 'kes' ? 'active' : ''} onClick={() => setProg('kes')}>Kesehatan</button>
          </div>
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama / NIP..." /></label>
        </div>
        {data && <div className="pap-filters"><span className="pap-muted">Periode gaji {formatDate(data.dari)} – {formatDate(data.sampai)}. {tr && (prog === 'tk' ? `JHT ${tr.jht_p}% + ${tr.jht_k}%, JKK ${tr.jkk}%, JKM ${tr.jkm}%, JP ${tr.jp_p}% + ${tr.jp_k}% (batas upah JP ${formatRupiah(tr.max_jp)}, usia < ${tr.usia_pensiun}).` : `Kesehatan ${tr.kes_p}% + ${tr.kes_k}% (batas upah ${formatRupiah(tr.max_kes)}).`)}</span></div>}
        <div className="pap-table-wrap">
          <table>
            <thead>
              {prog === 'tk'
                ? <tr><th>Karyawan</th><th>No. BPJS TK</th><th className="pap-num">Upah</th><th className="pap-num">JHT (P / K)</th><th className="pap-num">JKK</th><th className="pap-num">JKM</th><th className="pap-num">JP (P / K)</th><th className="pap-num">Total</th><th>Ditanggung</th></tr>
                : <tr><th>Karyawan</th><th>No. BPJS Kesehatan</th><th className="pap-num">Upah</th><th className="pap-num">Perusahaan</th><th className="pap-num">Pegawai</th><th className="pap-num">Total</th><th>Ditanggung</th></tr>}
            </thead>
            <tbody>
              {paged.items.map((x) => {
                const ikut = prog === 'tk' ? x.dasar_tk : x.dasar_kes
                return (
                  <tr key={x.nip} className={ikut ? '' : 'pap-muted'}>
                    <td>{x.nama}<div className="pap-cell-sub">{[x.nip, x.jabatan].filter(Boolean).join(' · ')}</div></td>
                    <td>{(prog === 'tk' ? x.no_bpjs_tk : x.no_bpjs_kes) ?? <span className="pap-text-danger">Belum terdaftar</span>}</td>
                    <td className="pap-num pap-nowrap">{ikut ? formatRupiah(ikut) : '—'}</td>
                    {prog === 'tk' ? (
                      <>
                        <td className="pap-num pap-nowrap">{formatRupiah(x.jht_p)}<div className="pap-cell-sub">{formatRupiah(x.jht_k)}</div></td>
                        <td className="pap-num pap-nowrap">{formatRupiah(x.jkk)}</td><td className="pap-num pap-nowrap">{formatRupiah(x.jkm)}</td>
                        <td className="pap-num pap-nowrap">{formatRupiah(x.jp_p)}<div className="pap-cell-sub">{x.dasar_tk && !x.dasar_jp ? 'usia pensiun' : formatRupiah(x.jp_k)}</div></td>
                        <td className="pap-num pap-nowrap"><strong>{formatRupiah(x.total_tk)}</strong></td>
                        <td>{x.tk_ditanggung === 'perusahaan' ? 'Perusahaan' : 'Pegawai'}</td>
                      </>
                    ) : (
                      <>
                        <td className="pap-num pap-nowrap">{formatRupiah(x.kes_p)}</td><td className="pap-num pap-nowrap">{formatRupiah(x.kes_k)}</td>
                        <td className="pap-num pap-nowrap"><strong>{formatRupiah(x.total_kes)}</strong></td>
                        <td>{x.kes_ditanggung === 'perusahaan' ? 'Perusahaan' : 'Pegawai'}</td>
                      </>
                    )}
                  </tr>
                )
              })}
            </tbody>
            {t && (
              <tfoot>
                {prog === 'tk'
                  ? <tr className="pap-total-row"><td colSpan={3}><b>Total {t.peserta_tk} peserta</b></td><td className="pap-num pap-nowrap"><b>{formatRupiah(t.jht_p + t.jht_k)}</b></td><td className="pap-num pap-nowrap"><b>{formatRupiah(t.jkk)}</b></td><td className="pap-num pap-nowrap"><b>{formatRupiah(t.jkm)}</b></td><td className="pap-num pap-nowrap"><b>{formatRupiah(t.jp_p + t.jp_k)}</b></td><td className="pap-num pap-nowrap"><b>{formatRupiah(t.total_tk)}</b></td><td /></tr>
                  : <tr className="pap-total-row"><td colSpan={3}><b>Total {t.peserta_kes} peserta</b></td><td className="pap-num pap-nowrap"><b>{formatRupiah(t.kes_p)}</b></td><td className="pap-num pap-nowrap"><b>{formatRupiah(t.kes_k)}</b></td><td className="pap-num pap-nowrap"><b>{formatRupiah(t.total_kes)}</b></td><td /></tr>}
              </tfoot>
            )}
          </table>
          {data && !rows.length && <div className="pap-empty">Belum ada data gaji karyawan. Isi dulu di Grade & Gaji › Data gaji karyawan.</div>}
          {!data && !error && <div className="pap-empty">Menghitung iuran...</div>}
          <Pager {...paged.pager} noun="karyawan" />
        </div>
      </div>
    </>
  )
}

// ======================= Perizinan perusahaan =======================
type Permit = {
  id: number; nama: string; kategori: string | null; nomor: string | null; instansi: string | null; tanggal_terbit: string | null; berlaku_sampai: string | null; pengingat_hari: number
  pic: string | null; file_url: string | null; catatan: string | null; updated_name: string | null; updated_at: string; status: 'aktif' | 'segera_habis' | 'kadaluarsa' | 'tanpa_batas'; sisa_hari: number | null
}
const PSTATUS = { aktif: ['Berlaku', 'success'], segera_habis: ['Segera habis', 'warning'], kadaluarsa: ['Kedaluwarsa', 'danger'], tanpa_batas: ['Tanpa batas', 'info'] } as const

export function PermitPage(_props: { user: UserProfile }) {
  const [data, setData] = useState<{ items: Permit[]; kategori: string[]; can: { manage: boolean } } | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [q, setQ] = useState('')
  const [form, setForm] = useState<Permit | 'baru' | null>(null)
  const load = useCallback(() => { api<{ items: Permit[]; kategori: string[]; can: { manage: boolean } }>('/api/hrd/permits').then((r) => { setData(r); setError('') }).catch((e) => setError(e.message)) }, [])
  useEffect(() => { load() }, [load])
  const term = q.trim().toLowerCase()
  const rows = (data?.items ?? []).filter((x) => !term || `${x.nama} ${x.nomor ?? ''} ${x.instansi ?? ''} ${x.kategori ?? ''}`.toLowerCase().includes(term))
  const count = (st: Permit['status']) => (data?.items ?? []).filter((x) => x.status === st).length
  async function remove(p: Permit) {
    if (!window.confirm(`Hapus ${p.nama}?`)) return
    try {
      await api(`/api/hrd/permits/${p.id}`, { method: 'DELETE' })
      setMessage(`${p.nama} dihapus.`)
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">SDM</p>
          <h1>Perizinan</h1>
          <span>Daftar perizinan & legalitas perusahaan (NIB, izin lingkungan, sertifikat, dsb.) beserta masa berlaku, PIC, dan link dokumen, dengan penanda izin yang perlu diperpanjang.</span>
        </div>
        {data?.can.manage && <button className="pap-primary-button" onClick={() => setForm('baru')}><Plus /> Tambah izin</button>}
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-stat-grid four">
        <div className="pap-stat-card"><div><span>Total izin</span><strong className="pap-stat-text">{data?.items.length ?? '…'}</strong><small className="neutral">Tercatat di PAP-MS</small></div><div className="pap-stat-icon stat-1"><Stamp /></div></div>
        <div className="pap-stat-card"><div><span>Berlaku</span><strong className="pap-stat-text">{data ? count('aktif') + count('tanpa_batas') : '…'}</strong><small className="neutral">Termasuk tanpa batas waktu</small></div><div className="pap-stat-icon stat-0"><CheckCircle2 /></div></div>
        <div className="pap-stat-card"><div><span>Segera habis</span><strong className="pap-stat-text">{data ? count('segera_habis') : '…'}</strong><small className="neutral">Masuk masa pengingat</small></div><div className={`pap-stat-icon ${count('segera_habis') ? 'stat-2' : 'stat-0'}`}><Clock /></div></div>
        <div className="pap-stat-card"><div><span>Kedaluwarsa</span><strong className="pap-stat-text">{data ? count('kadaluarsa') : '…'}</strong><small className="neutral">Perlu diperpanjang</small></div><div className={`pap-stat-icon ${count('kadaluarsa') ? 'stat-2' : 'stat-0'}`}><AlertTriangle /></div></div>
      </div>
      <div className="pap-table-card">
        <div className="pap-filters"><label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama izin, nomor, instansi..." /></label></div>
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Izin</th><th>Nomor / instansi</th><th>Terbit</th><th>Berlaku sampai</th><th>Status</th><th>PIC</th><th className="pap-actions-col">Aksi</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td><div className="pap-cell-title">{p.nama}</div><div className="pap-cell-sub">{p.kategori ?? ''}</div></td>
                  <td>{p.nomor ?? '—'}<div className="pap-cell-sub">{p.instansi ?? ''}</div></td>
                  <td className="pap-nowrap">{formatDate(p.tanggal_terbit)}</td>
                  <td className="pap-nowrap">{p.berlaku_sampai ? formatDate(p.berlaku_sampai) : 'Selamanya'}{p.sisa_hari !== null && <div className={`pap-cell-sub ${p.sisa_hari < 0 ? 'pap-text-danger' : ''}`}>{p.sisa_hari < 0 ? `lewat ${-p.sisa_hari} hari` : `${p.sisa_hari} hari lagi`}</div>}</td>
                  <td><span className={`pap-status ${PSTATUS[p.status][1]}`}>{PSTATUS[p.status][0]}</span></td>
                  <td>{p.pic ?? '—'}</td>
                  <td className="pap-actions-cell">
                    <div className="pap-row-actions">
                      {p.file_url && <a className="pap-row-action" href={p.file_url} target="_blank" rel="noreferrer" aria-label="Buka dokumen"><ExternalLink /></a>}
                      {data?.can.manage && <RowActions label={p.nama} onEdit={() => setForm(p)} />}
                      {data?.can.manage && <button className="pap-row-action" onClick={() => remove(p)} aria-label="Hapus"><Trash2 /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && !rows.length && <div className="pap-empty">{q ? 'Tidak ada yang cocok.' : 'Belum ada perizinan. Tambahkan NIB, izin usaha industri, izin lingkungan, sertifikat, dsb.'}</div>}
          {!data && !error && <div className="pap-empty">Memuat...</div>}
        </div>
      </div>
      {form && data && <PermitForm item={form === 'baru' ? null : form} kategori={data.kategori} onClose={() => setForm(null)} onSaved={(t) => { setForm(null); setMessage(t); load() }} />}
    </>
  )
}

function PermitForm({ item, kategori, onClose, onSaved }: { item: Permit | null; kategori: string[]; onClose: () => void; onSaved: (t: string) => void }) {
  const [v, setV] = useState({ nama: s(item?.nama), kategori: s(item?.kategori), nomor: s(item?.nomor), instansi: s(item?.instansi), tanggal_terbit: s(item?.tanggal_terbit), berlaku_sampai: s(item?.berlaku_sampai), pengingat_hari: s(item?.pengingat_hari ?? 60), pic: s(item?.pic), file_url: s(item?.file_url), catatan: s(item?.catatan) })
  const [error, setError] = useState('')
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value })
  async function save(e: React.FormEvent) {
    e.preventDefault()
    try {
      await api(item ? `/api/hrd/permits/${item.id}` : '/api/hrd/permits', { method: item ? 'PUT' : 'POST', json: v })
      onSaved(item ? 'Izin diperbarui.' : 'Izin ditambahkan.')
    } catch (err) {
      setError((err as Error).message)
    }
  }
  return (
    <Modal title={item ? `Ubah ${item.nama}` : 'Tambah perizinan'} onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="permit-form">Simpan</button></>}>
      <form id="permit-form" className="pap-form-grid" onSubmit={save}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Nama izin *" full><input className="pap-input" required maxLength={200} value={v.nama} onChange={set('nama')} placeholder="mis. NIB, Izin Usaha Industri, SPPL, Sertifikat Halal" /></Field>
        <Field label="Kategori"><select className="pap-select" value={v.kategori} onChange={set('kategori')}><option value="">—</option>{kategori.map((k) => <option key={k} value={k}>{k}</option>)}</select></Field>
        <Field label="Nomor"><input className="pap-input" maxLength={120} value={v.nomor} onChange={set('nomor')} /></Field>
        <Field label="Instansi penerbit" full><input className="pap-input" maxLength={200} value={v.instansi} onChange={set('instansi')} placeholder="mis. OSS / DPMPTSP Kab. Sukoharjo" /></Field>
        <Field label="Tanggal terbit"><input className="pap-input" type="date" value={v.tanggal_terbit} onChange={set('tanggal_terbit')} /></Field>
        <Field label="Berlaku sampai" hint="Kosongkan bila berlaku selamanya"><input className="pap-input" type="date" value={v.berlaku_sampai} onChange={set('berlaku_sampai')} /></Field>
        <Field label="Ingatkan (hari sebelum habis)"><input className="pap-input pap-num" type="number" min={0} max={365} value={v.pengingat_hari} onChange={set('pengingat_hari')} /></Field>
        <Field label="PIC"><input className="pap-input" maxLength={150} value={v.pic} onChange={set('pic')} /></Field>
        <Field label="Link dokumen" full hint="mis. file scan di Google Drive"><input className="pap-input" type="url" maxLength={500} value={v.file_url} onChange={set('file_url')} placeholder="https://" /></Field>
        <Field label="Catatan" full><textarea className="pap-input" rows={2} maxLength={1000} value={v.catatan} onChange={set('catatan')} /></Field>
      </form>
    </Modal>
  )
}
