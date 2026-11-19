'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarRange, CheckCircle2, ChevronLeft, ChevronRight, Copy, Download, ListChecks, Plus, Search, Target, Users, Wallet } from 'lucide-react'
import { api, confirmDialog, Field, formatDate, Modal, Notice, RowActions } from './ui'

// ---- Program Training Tahunan: rencana training per tahun untuk Staff & Produksi ----
const STATUS: Record<string, [string, string]> = { rencana: ['Rencana', 'info'], berjalan: ['Berjalan', 'warning'], selesai: ['Selesai', 'success'], ditunda: ['Ditunda', 'neutral'], batal: ['Batal', 'danger'] }
const KELOMPOK: Record<string, string> = { staff: 'Staff', produksi: 'Produksi', semua: 'Staff & Produksi' }
const JENIS: Record<string, string> = { wajib: 'Wajib', pengembangan: 'Pengembangan', sertifikasi: 'Sertifikasi', penyegaran: 'Penyegaran', induksi: 'Induksi karyawan baru' }
const METODE: Record<string, string> = { internal: 'Internal', eksternal: 'Eksternal', online: 'Online', on_the_job: 'On the job' }
const FREKUENSI: Record<string, string> = { sekali: 'Sekali', bulanan: 'Bulanan', triwulan: 'Triwulan', semester: 'Semester', tahunan: 'Tahunan' }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const KATEGORI = ['K3 & Keselamatan Kerja', 'Mesin & Teknik', 'Mutu / QC', 'Produksi & SOP', 'Soft skill', 'Kepemimpinan', 'Administrasi & Sistem', 'Pelayanan Customer', 'Penjualan & Marketing']

type Program = {
  id: number; kode: string; tahun: number; nama: string; kategori: string | null; jenis: string; kelompok: string; divisi: string[]; tujuan: string | null; bulan: number[]; tanggal: string[]
  frekuensi: string | null; durasi_jam: number | null; metode: string | null; penyelenggara: string | null; target_peserta: number | null; anggaran: number | null
  realisasi_biaya: number | null; indikator: string | null; status: string; module_id: number | null; modul: string | null; catatan: string | null
  sesi: number; sesi_selesai: number; peserta_hadir: number; bulan_realisasi: number[]; dibuat_oleh: string | null; diubah_oleh: string | null; updated_at: string
}
type Res = { tahun: number; items: Program[]; years: number[]; modules: { id: number; judul: string }[]; divisi: string[]; can: { manage: boolean } }
type SessionRow = { id: number; judul: string; batch: string | null; tanggal: string; jam_mulai: string | null; jam_selesai: string | null; tempat: string | null; pemateri: string | null; status: string; peserta: number; hadir: number }

const rupiah = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `Rp ${Math.round(v).toLocaleString('id-ID')}`)
const thisYear = () => new Date(Date.now() + 7 * 3600e3).getUTCFullYear()
const thisMonth = () => new Date(Date.now() + 7 * 3600e3).getUTCMonth() + 1
const monthsText = (b: number[]) => (b.length === 12 ? 'Setiap bulan' : b.length ? b.map((m) => MONTHS[m - 1]).join(', ') : '—')
// "2026-01-15" -> "15 Jan"; jadwal = tanggal rencana bila ada, selain itu nama bulan
const dayText = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`
const scheduleText = (p: { bulan: number[]; tanggal: string[] }) => {
  const noDate = p.bulan.filter((m) => !p.tanggal.some((d) => Number(d.slice(5, 7)) === m))
  return [...p.tanggal.map(dayText), ...noDate.map((m) => MONTHS[m - 1])].join(', ') || '—'
}
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
// Progres: sesi selesai dibanding rencana bulan (minimal 1)
const progress = (p: Program) => (p.status === 'selesai' ? 100 : Math.min(100, Math.round((p.sesi_selesai / Math.max(1, p.bulan.length || 1)) * 100)))

export function ProgramTab() {
  const [tahun, setTahun] = useState(thisYear())
  const [data, setData] = useState<Res | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [kelompok, setKelompok] = useState<'' | 'staff' | 'produksi'>('')
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [view, setView] = useState<'daftar' | 'kalender'>('daftar')
  const [form, setForm] = useState<Program | 'baru' | null>(null)
  const [detail, setDetail] = useState<number | null>(null)
  const load = useCallback(() => api<Res>(`/api/hrd/training/programs?tahun=${tahun}`).then((r) => { setData(r); setError('') }).catch((e) => setError(e.message)), [tahun])
  useEffect(() => { load() }, [load])
  const manage = !!data?.can.manage

  const items = useMemo(() => {
    const term = q.trim().toLowerCase()
    return (data?.items ?? []).filter((p) =>
      (!kelompok || p.kelompok === kelompok || p.kelompok === 'semua') && (!status || p.status === status)
      && (!term || [p.kode, p.nama, p.kategori, p.penyelenggara, p.divisi.join(' ')].some((x) => x?.toLowerCase().includes(term))))
  }, [data, kelompok, status, q])
  const all = data?.items ?? []
  const aktif = all.filter((p) => p.status !== 'batal')
  const selesai = aktif.filter((p) => p.status === 'selesai').length
  const anggaran = aktif.reduce((n, p) => n + (p.anggaran ?? 0), 0)
  const realisasi = aktif.reduce((n, p) => n + (p.realisasi_biaya ?? 0), 0)
  const target = aktif.reduce((n, p) => n + (p.target_peserta ?? 0), 0)
  const hadir = aktif.reduce((n, p) => n + p.peserta_hadir, 0)

  async function copyLastYear() {
    const dari = tahun - 1
    if (!(await confirmDialog({ title: 'Salin program', message: `Salin semua program training ${dari} ke ${tahun} sebagai rencana baru? Program dengan nama yang sama di ${tahun} dilewati.`, confirmLabel: 'Ya, salin' }))) return
    try {
      const r = await api<{ added: number }>('/api/hrd/training/programs', { method: 'POST', json: { salin: { dari, ke: tahun } } })
      setMessage(`${r.added} program dari ${dari} disalin ke ${tahun}.`)
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  async function remove(p: Program) {
    if (!(await confirmDialog({ title: 'Hapus program', message: `Hapus ${p.kode} · ${p.nama}? Data masuk ke Data Terhapus dan bisa dipulihkan. Sesi jadwal yang terhubung tetap ada.`, confirmLabel: 'Ya, hapus', tone: 'danger' }))) return
    try {
      await api(`/api/hrd/training/programs/${p.id}`, { method: 'DELETE' })
      setMessage(`${p.kode} dihapus.`)
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-tp-toolbar">
        <div className="pap-tp-year" role="group" aria-label="Tahun program">
          <button type="button" className="pap-icon-button" onClick={() => setTahun(tahun - 1)} aria-label="Tahun sebelumnya"><ChevronLeft /></button>
          <select className="pap-select" value={tahun} onChange={(e) => setTahun(Number(e.target.value))} aria-label="Pilih tahun">
            {(data?.years ?? [tahun]).concat(tahun).filter((y, i, a) => a.indexOf(y) === i).sort((a, b) => b - a).map((y) => <option key={y} value={y}>Program {y}</option>)}
          </select>
          <button type="button" className="pap-icon-button" onClick={() => setTahun(tahun + 1)} aria-label="Tahun berikutnya"><ChevronRight /></button>
        </div>
        <span className="pap-spacer" />
        <a className="pap-btn" href={`/api/hrd/training/programs/export?tahun=${tahun}`}><Download /> Unduh Excel</a>
        {manage && <button type="button" className="pap-btn" onClick={copyLastYear}><Copy /> Salin dari {tahun - 1}</button>}
        {manage && <button type="button" className="pap-primary-button" onClick={() => setForm('baru')}><Plus /> Program baru</button>}
      </div>

      <div className="pap-stat-grid four">
        {([
          ['Program training', `${aktif.length}`, `${aktif.filter((p) => p.kelompok !== 'produksi').length} staff · ${aktif.filter((p) => p.kelompok !== 'staff').length} produksi`, ListChecks, 'stat-1'],
          ['Selesai', aktif.length ? `${Math.round((selesai / aktif.length) * 100)}%` : '—', `${selesai} dari ${aktif.length} program`, CheckCircle2, 'stat-0'],
          ['Peserta', `${hadir.toLocaleString('id-ID')}`, target ? `hadir dari target ${target.toLocaleString('id-ID')} orang` : 'peserta hadir', Users, 'stat-1'],
          ['Anggaran', rupiah(anggaran), `realisasi ${rupiah(realisasi)}${anggaran ? ` (${Math.round((realisasi / anggaran) * 100)}%)` : ''}`, Wallet, 'stat-2'],
        ] as const).map(([label, value, note, Icon, tone]) => (
          <div key={label} className="pap-stat-card"><div><span>{label}</span><strong className="pap-stat-text">{value}</strong><small className="neutral">{note}</small></div><div className={`pap-stat-icon ${tone}`}><Icon /></div></div>
        ))}
      </div>

      <div className="pap-table-card">
        <div className="pap-card-head">
          <div><h2>Program training {tahun}</h2><p>Rencana training tahunan untuk staff dan produksi. Realisasi dihitung dari sesi Jadwal Training yang dihubungkan ke program.</p></div>
          <div className="pap-segmented" role="tablist" aria-label="Tampilan">
            <button role="tab" aria-selected={view === 'daftar'} className={view === 'daftar' ? 'active' : ''} onClick={() => setView('daftar')}><ListChecks /> Daftar</button>
            <button role="tab" aria-selected={view === 'kalender'} className={view === 'kalender' ? 'active' : ''} onClick={() => setView('kalender')}><CalendarRange /> Kalender</button>
          </div>
        </div>
        <div className="pap-filters">
          <div className="pap-segmented" role="tablist" aria-label="Kelompok">
            {([['', 'Semua'], ['staff', 'Staff'], ['produksi', 'Produksi']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={kelompok === k} className={kelompok === k ? 'active' : ''} onClick={() => setKelompok(k)}>{l}</button>)}
          </div>
          <select className="pap-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Semua status</option>
            {Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari program, kategori, penyelenggara, divisi..." /></label>
        </div>

        {view === 'daftar' ? (
          <div className="pap-table-wrap">
            <table>
              <thead><tr><th>Program</th><th>Kelompok</th><th>Jadwal</th><th>Penyelenggara</th><th className="pap-num">Peserta</th><th className="pap-num">Anggaran</th><th>Progres</th><th>Status</th><th className="pap-actions-col">Aksi</th></tr></thead>
              <tbody>
                {items.map((p) => {
                  const [label, tone] = STATUS[p.status] ?? [p.status, 'neutral']
                  const pct = progress(p)
                  return (
                    <tr key={p.id} className="pap-row-link" onClick={() => setDetail(p.id)}>
                      <td className="pap-tp-name"><div className="pap-cell-title">{p.nama}</div><div className="pap-cell-sub">{[p.kode, p.kategori, JENIS[p.jenis] ?? p.jenis].filter(Boolean).join(' · ')}</div></td>
                      <td><span className={`pap-tp-group ${p.kelompok}`}>{KELOMPOK[p.kelompok] ?? p.kelompok}</span>{p.divisi.length > 0 && <div className="pap-cell-sub">{p.divisi.slice(0, 2).join(', ')}{p.divisi.length > 2 ? ` +${p.divisi.length - 2}` : ''}</div>}</td>
                      <td><div>{p.tanggal.length ? scheduleText(p) : monthsText(p.bulan)}</div><div className="pap-cell-sub">{[p.frekuensi && FREKUENSI[p.frekuensi], p.durasi_jam && `${p.durasi_jam.toLocaleString('id-ID')} jam`].filter(Boolean).join(' · ') || '—'}</div></td>
                      <td>{p.penyelenggara ?? '—'}<div className="pap-cell-sub">{p.metode ? METODE[p.metode] : ''}</div></td>
                      <td className="pap-num pap-nowrap"><strong>{p.peserta_hadir}</strong>{p.target_peserta ? ` / ${p.target_peserta}` : ''}<div className="pap-cell-sub">hadir / target</div></td>
                      <td className="pap-num pap-nowrap">{rupiah(p.anggaran)}{p.realisasi_biaya ? <div className="pap-cell-sub">real. {rupiah(p.realisasi_biaya)}</div> : null}</td>
                      <td><div className="pap-tp-progress" title={`${p.sesi_selesai} sesi selesai`}><span style={{ width: `${pct}%` }} /></div><div className="pap-cell-sub">{p.sesi_selesai}/{Math.max(p.bulan.length, p.sesi)} sesi · {pct}%</div></td>
                      <td><span className={`pap-status ${tone}`}>{label}</span></td>
                      <td className="pap-actions-cell"><RowActions label={p.nama} onView={() => setDetail(p.id)} onEdit={manage ? () => setForm(p) : undefined} onDelete={manage ? () => remove(p) : undefined} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {data && !items.length && <div className="pap-empty">{all.length ? 'Tidak ada program yang cocok dengan filter.' : `Belum ada program training ${tahun}.${manage ? ` Klik "Program baru", atau "Salin dari ${tahun - 1}".` : ''}`}</div>}
            {!data && !error && <div className="pap-empty">Memuat program training...</div>}
          </div>
        ) : (
          <ProgramCalendar items={items} tahun={tahun} onOpen={setDetail} />
        )}
      </div>

      {form && data && <ProgramForm item={form === 'baru' ? null : form} tahun={tahun} modules={data.modules} divisi={data.divisi} onClose={() => setForm(null)} onSaved={(t) => { setForm(null); setMessage(t); load() }} />}
      {detail && <ProgramDetail id={detail} onClose={() => setDetail(null)} onEdit={manage ? (p) => { setDetail(null); setForm(p) } : undefined} />}
    </>
  )
}

// Kalender 12 bulan: kotak berwarna = rencana; centang = sudah ada sesi selesai di bulan itu
function ProgramCalendar({ items, tahun, onOpen }: { items: Program[]; tahun: number; onOpen: (id: number) => void }) {
  const now = tahun === thisYear() ? thisMonth() : 0
  return (
    <div className="pap-tp-cal-wrap">
      <div className="pap-tp-cal" role="table" aria-label={`Kalender training ${tahun}`}>
        <div className="pap-tp-cal-row head" role="row">
          <div className="pap-tp-cal-name" role="columnheader">Program</div>
          {MONTHS.map((m, i) => <div key={m} role="columnheader" className={i + 1 === now ? 'now' : ''}>{m}</div>)}
        </div>
        {items.map((p) => (
          <button type="button" key={p.id} className="pap-tp-cal-row" role="row" onClick={() => onOpen(p.id)}>
            <div className="pap-tp-cal-name" role="cell"><strong>{p.nama}</strong><small>{p.kode} · {KELOMPOK[p.kelompok]}</small></div>
            {MONTHS.map((m, i) => {
              const plan = p.bulan.includes(i + 1)
              const done = p.bulan_realisasi.includes(i + 1)
              const days = p.tanggal.filter((d) => Number(d.slice(5, 7)) === i + 1).map((d) => Number(d.slice(8, 10)))
              return <div key={m} role="cell" className={`pap-tp-cell ${plan ? `plan ${p.status}` : ''} ${done ? 'done' : ''} ${i + 1 === now ? 'now' : ''}`} title={`${MONTHS[i]}: ${done ? 'terlaksana' : plan ? `rencana${days.length ? ` tgl ${days.join(', ')}` : ''}` : '-'}`}>{done ? '✓' : days.length ? <span className="pap-tp-day">{days.join(',')}</span> : ''}</div>
            })}
          </button>
        ))}
        {!items.length && <div className="pap-empty">Tidak ada program untuk ditampilkan.</div>}
      </div>
      <p className="pap-muted pap-tp-legend"><span className="pap-tp-cell plan rencana" /> Rencana <span className="pap-tp-cell plan berjalan" /> Berjalan <span className="pap-tp-cell plan done selesai">✓</span> Terlaksana (ada sesi selesai) · Geser ke samping di layar kecil.</p>
    </div>
  )
}

function ProgramDetail({ id, onClose, onEdit }: { id: number; onClose: () => void; onEdit?: (p: Program) => void }) {
  const [item, setItem] = useState<(Program & { sessions: SessionRow[] }) | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { api<{ item: Program & { sessions: SessionRow[] } }>(`/api/hrd/training/programs/${id}`).then((r) => setItem(r.item)).catch((e) => setError(e.message)) }, [id])
  if (!item) return <Modal title="Program training" onClose={onClose}>{error ? <Notice>{error}</Notice> : <p className="pap-muted">Memuat...</p>}</Modal>
  const [label, tone] = STATUS[item.status] ?? [item.status, 'neutral']
  const pct = progress(item)
  const grid = (rows: [string, React.ReactNode][]) => <dl className="pap-detail-grid">{rows.map(([dt, dd]) => <div key={dt}><dt>{dt}</dt><dd>{dd || '—'}</dd></div>)}</dl>
  return (
    <Modal title={item.nama} subtitle={`${item.kode} · Program ${item.tahun}`} wide onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Tutup</button>{onEdit && <button className="pap-primary-button" onClick={() => onEdit(item)}>Ubah program</button>}</>}>
      <div className="pap-detail-badges">
        <span className={`pap-status ${tone}`}>{label}</span>
        <span className={`pap-tp-group ${item.kelompok}`}>{KELOMPOK[item.kelompok]}</span>
        <span className="pap-status neutral">{JENIS[item.jenis] ?? item.jenis}</span>
        {item.kategori && <span className="pap-status neutral">{item.kategori}</span>}
      </div>
      <div className="pap-tp-detail-progress">
        <div><span>Progres pelaksanaan</span><strong>{pct}%</strong></div>
        <div className="pap-tp-progress big"><span style={{ width: `${pct}%` }} /></div>
        <small className="pap-muted">{item.sesi_selesai} sesi selesai dari {item.sesi} sesi terjadwal · {item.peserta_hadir} peserta hadir{item.target_peserta ? ` dari target ${item.target_peserta}` : ''}</small>
      </div>
      <section className="pap-detail-section">
        <h3>Program</h3>
        {grid([
          ['Divisi sasaran', item.divisi.length ? item.divisi.join(', ') : `Semua ${KELOMPOK[item.kelompok].toLowerCase()}`],
          ['Modul materi', item.modul],
          ['Tujuan', item.tujuan && <span className="pap-prewrap">{item.tujuan}</span>],
          ['Indikator keberhasilan', item.indikator],
        ])}
      </section>
      <section className="pap-detail-section">
        <h3>Pelaksanaan & anggaran</h3>
        {grid([
          ['Jadwal pelaksanaan', item.tanggal.length ? scheduleText(item) : monthsText(item.bulan)],
          ['Frekuensi · durasi', [item.frekuensi && FREKUENSI[item.frekuensi], item.durasi_jam && `${item.durasi_jam.toLocaleString('id-ID')} jam per sesi`].filter(Boolean).join(' · ')],
          ['Metode', item.metode && METODE[item.metode]],
          ['Penyelenggara / pemateri', item.penyelenggara],
          ['Anggaran', rupiah(item.anggaran)],
          ['Realisasi biaya', item.realisasi_biaya !== null ? `${rupiah(item.realisasi_biaya)}${item.anggaran ? ` (${Math.round((item.realisasi_biaya / item.anggaran) * 100)}% anggaran)` : ''}` : null],
        ])}
        {item.catatan && <p className="pap-prewrap pap-muted">{item.catatan}</p>}
      </section>
      <section className="pap-detail-section">
        <h3>Realisasi: sesi Jadwal Training ({item.sessions.length})</h3>
        {item.sessions.length ? (
          <div className="pap-table-wrap">
            <table>
              <thead><tr><th>Tanggal</th><th>Sesi</th><th>Pemateri / tempat</th><th className="pap-num">Hadir</th><th>Status</th></tr></thead>
              <tbody>
                {item.sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="pap-nowrap">{formatDate(s.tanggal)}<div className="pap-cell-sub">{[s.jam_mulai, s.jam_selesai].filter(Boolean).join('–')}</div></td>
                    <td>{s.judul}{s.batch ? <div className="pap-cell-sub">{s.batch}</div> : null}</td>
                    <td>{s.pemateri ?? '—'}<div className="pap-cell-sub">{s.tempat ?? ''}</div></td>
                    <td className="pap-num">{s.hadir} / {s.peserta}</td>
                    <td><span className={`pap-status ${s.status === 'selesai' ? 'success' : s.status === 'batal' ? 'danger' : 'info'}`}>{s.status === 'selesai' ? 'Selesai' : s.status === 'batal' ? 'Batal' : 'Terjadwal'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="pap-muted">Belum ada sesi. Buat sesi di tab Jadwal Training lalu pilih program ini di isian "Program training tahunan".</p>}
      </section>
      <p className="pap-muted pap-emp-note">{[item.dibuat_oleh && `Dibuat ${item.dibuat_oleh}`, item.diubah_oleh && `diubah ${item.diubah_oleh}`, item.updated_at && formatDate(item.updated_at, true)].filter(Boolean).join(' · ')}</p>
    </Modal>
  )
}

function ProgramForm({ item, tahun, modules, divisi, onClose, onSaved }: { item: Program | null; tahun: number; modules: { id: number; judul: string }[]; divisi: string[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [v, setV] = useState({
    tahun: String(item?.tahun ?? tahun), nama: item?.nama ?? '', kategori: item?.kategori ?? '', jenis: item?.jenis ?? 'wajib', kelompok: item?.kelompok ?? 'semua',
    tujuan: item?.tujuan ?? '', frekuensi: item?.frekuensi ?? '', durasi_jam: item?.durasi_jam ? String(item.durasi_jam).replace('.', ',') : '', metode: item?.metode ?? 'internal',
    penyelenggara: item?.penyelenggara ?? '', target_peserta: item?.target_peserta ? String(item.target_peserta) : '', anggaran: item?.anggaran ? Math.round(item.anggaran).toLocaleString('id-ID') : '',
    realisasi_biaya: item?.realisasi_biaya ? Math.round(item.realisasi_biaya).toLocaleString('id-ID') : '', indikator: item?.indikator ?? '', status: item?.status ?? 'rencana',
    module_id: item?.module_id ? String(item.module_id) : '', catatan: item?.catatan ?? '',
  })
  const [bulan, setBulan] = useState<number[]>(item?.bulan ?? [])
  // Tanggal rencana per bulan: { 1: '2026-01-15', ... }
  const [tanggal, setTanggal] = useState<Record<number, string>>(() => Object.fromEntries((item?.tanggal ?? []).map((d) => [Number(d.slice(5, 7)), d])))
  const [div, setDiv] = useState<string[]>(item?.divisi ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((cur) => ({ ...cur, [k]: e.target.value }))
  // Uang: tampil dengan titik ribuan saat diketik
  const setMoney = (k: 'anggaran' | 'realisasi_biaya') => (e: { target: { value: string } }) => {
    const digits = e.target.value.replace(/\D/g, '')
    setV((cur) => ({ ...cur, [k]: digits ? Number(digits).toLocaleString('id-ID') : '' }))
  }
  const toggleMonth = (m: number) => {
    if (bulan.includes(m)) setTanggal(({ [m]: _drop, ...rest }) => rest)
    setBulan((b) => (b.includes(m) ? b.filter((x) => x !== m) : [...b, m].sort((a, c) => a - c)))
  }
  // Pilihan cepat bulan sesuai frekuensi
  const presetMonths = (f: string) => {
    const map: Record<string, number[]> = { bulanan: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], triwulan: [3, 6, 9, 12], semester: [6, 12], tahunan: bulan.length ? [bulan[0]] : [] }
    if (map[f]) setBulan(map[f])
  }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!bulan.length && !(await confirmDialog({ title: 'Bulan belum dipilih', message: 'Bulan pelaksanaan belum dipilih. Simpan tanpa bulan?', confirmLabel: 'Ya, simpan' }))) return
    setBusy(true)
    setError('')
    try {
      // Tanggal hanya untuk bulan yang masih dipilih & sesuai tahun program
      const tgl = bulan.map((m) => tanggal[m]).filter((d): d is string => !!d && d.startsWith(`${v.tahun}-`))
      const json = { ...v, bulan, tanggal: tgl, divisi: div }
      const r = await api<{ kode?: string }>(item ? `/api/hrd/training/programs/${item.id}` : '/api/hrd/training/programs', { method: item ? 'PUT' : 'POST', json })
      onSaved(item ? `${r.kode ?? item.kode} diperbarui.` : `Program ${r.kode} ditambahkan.`)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }
  const divisiOptions = [...new Set([...divisi, ...div])]
  return (
    <Modal title={item ? `Ubah ${item.kode}` : 'Program training baru'} subtitle="Rencana training tahunan untuk staff dan produksi" wide onClose={onClose}
      footer={<><span className="pap-spacer" /><button type="button" className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="tp-form" disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan program'}</button></>}>
      <form id="tp-form" className="pap-tp-form" onSubmit={save}>
        {error && <Notice onClose={() => setError('')}>{error}</Notice>}
        <section className="pap-tp-form-section">
          <h3><Target /> Informasi program</h3>
          <div className="pap-form-grid">
            <Field label="Nama program *" full><input className="pap-input" required maxLength={200} value={v.nama} onChange={set('nama')} placeholder="mis. Training K3 & APD untuk operator" /></Field>
            <Field label="Kategori">
              <input className="pap-input" list="pap-tp-kategori" maxLength={80} value={v.kategori} onChange={set('kategori')} placeholder="Pilih atau ketik" />
              <datalist id="pap-tp-kategori">{KATEGORI.map((k) => <option key={k} value={k} />)}</datalist>
            </Field>
            <Field label="Jenis"><select className="pap-select" value={v.jenis} onChange={set('jenis')}>{Object.entries(JENIS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <div className="pap-field full">
              <span>Kelompok peserta *</span>
              <div className="pap-segmented pap-tp-kelompok" role="radiogroup" aria-label="Kelompok peserta">
                {Object.entries(KELOMPOK).map(([k, l]) => <button type="button" key={k} role="radio" aria-checked={v.kelompok === k} className={v.kelompok === k ? 'active' : ''} onClick={() => setV({ ...v, kelompok: k })}>{l}</button>)}
              </div>
            </div>
            <div className="pap-field full">
              <span>Divisi sasaran <small className="pap-muted">(kosong = semua di kelompok)</small></span>
              <div className="pap-chip-tabs">{divisiOptions.map((d) => <button type="button" key={d} className={div.includes(d) ? 'active' : ''} onClick={() => setDiv(div.includes(d) ? div.filter((x) => x !== d) : [...div, d])}>{d}</button>)}</div>
            </div>
            <Field label="Tujuan program" full><textarea className="pap-input" rows={2} maxLength={3000} value={v.tujuan} onChange={set('tujuan')} placeholder="Kompetensi yang ingin dicapai" /></Field>
          </div>
        </section>
        <section className="pap-tp-form-section">
          <h3><CalendarRange /> Jadwal & pelaksanaan</h3>
          <div className="pap-form-grid">
            <Field label="Tahun *"><input className="pap-input" inputMode="numeric" maxLength={4} required value={v.tahun} onChange={(e) => setV({ ...v, tahun: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label="Frekuensi" hint="Memilih frekuensi mengisi bulan otomatis">
              <select className="pap-select" value={v.frekuensi} onChange={(e) => { setV({ ...v, frekuensi: e.target.value }); presetMonths(e.target.value) }}>
                <option value="">—</option>{Object.entries(FREKUENSI).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
            <div className="pap-field full">
              <span>Bulan pelaksanaan ({bulan.length})</span>
              <div className="pap-tp-months">{MONTHS.map((m, i) => <button type="button" key={m} className={bulan.includes(i + 1) ? 'active' : ''} aria-pressed={bulan.includes(i + 1)} onClick={() => toggleMonth(i + 1)}>{m}</button>)}</div>
            </div>
            {bulan.length > 0 && (
              <div className="pap-field full">
                <span>Tanggal rencana <small className="pap-muted">(opsional, per bulan)</small></span>
                <div className="pap-tp-dates">
                  {bulan.map((m) => {
                    const y = Number(v.tahun) || tahun
                    const mm = String(m).padStart(2, '0')
                    return (
                      <label key={m} className="pap-tp-date">
                        <b>{MONTHS[m - 1]}</b>
                        <input className="pap-input" type="date" min={`${y}-${mm}-01`} max={`${y}-${mm}-${lastDay(y, m)}`} value={tanggal[m] ?? ''}
                          onChange={(e) => setTanggal((t) => ({ ...t, [m]: e.target.value }))} aria-label={`Tanggal rencana ${MONTHS[m - 1]}`} />
                      </label>
                    )
                  })}
                </div>
              </div>
            )}
            <Field label="Durasi per sesi (jam)"><input className="pap-input pap-num" inputMode="decimal" maxLength={6} value={v.durasi_jam} onChange={set('durasi_jam')} placeholder="2" /></Field>
            <Field label="Metode"><select className="pap-select" value={v.metode} onChange={set('metode')}><option value="">—</option>{Object.entries(METODE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Penyelenggara / pemateri" full><input className="pap-input" maxLength={200} value={v.penyelenggara} onChange={set('penyelenggara')} placeholder="mis. Tim Teknik internal, Disnaker, lembaga sertifikasi" /></Field>
            <Field label="Modul materi terkait">
              <select className="pap-select" value={v.module_id} onChange={set('module_id')}><option value="">— Tidak ada —</option>{modules.map((m) => <option key={m.id} value={m.id}>{m.judul}</option>)}</select>
            </Field>
            <Field label="Status"><select className="pap-select" value={v.status} onChange={set('status')}>{Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          </div>
        </section>
        <section className="pap-tp-form-section">
          <h3><Wallet /> Target & anggaran</h3>
          <div className="pap-form-grid">
            <Field label="Target peserta (orang)"><input className="pap-input pap-num" inputMode="numeric" maxLength={6} value={v.target_peserta} onChange={(e) => setV({ ...v, target_peserta: e.target.value.replace(/\D/g, '') })} placeholder="0" /></Field>
            <Field label="Anggaran (Rp)"><input className="pap-input pap-num" inputMode="numeric" value={v.anggaran} onChange={setMoney('anggaran')} placeholder="0" /></Field>
            <Field label="Realisasi biaya (Rp)"><input className="pap-input pap-num" inputMode="numeric" value={v.realisasi_biaya} onChange={setMoney('realisasi_biaya')} placeholder="0" /></Field>
            <Field label="Indikator keberhasilan" full><input className="pap-input" maxLength={500} value={v.indikator} onChange={set('indikator')} placeholder="mis. 100% operator lulus post-test ≥ 80, kecelakaan kerja turun" /></Field>
            <Field label="Catatan" full><textarea className="pap-input" rows={2} maxLength={3000} value={v.catatan} onChange={set('catatan')} /></Field>
          </div>
        </section>
      </form>
    </Modal>
  )
}
