'use client'

import { useCallback, useEffect, useState } from 'react'
import { BookOpen, CheckCircle2, ExternalLink, Eye, EyeOff, FileText, FolderOpen, GraduationCap, Link2, Pencil, PlayCircle, Plus, RefreshCw, Search, Trash2, Users } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { api, Field, formatDate, formatSize, Modal, Notice, confirmDialog } from './ui'
import { MaterialForm, MateriTab, PreviewDialog } from './training-materi'
import { JadwalTab } from './training-schedule'

// Training Karyawan: tab Materi (folder Google Drive + preview), Jadwal (spreadsheet), Modul & Peserta (subfolder = modul, peserta & nilai dicatat HRD)

type Module = {
  id: number; dari_drive: boolean; judul: string; kategori: string | null; deskripsi: string | null; sasaran: string | null; wajib: boolean; durasi_menit: number | null
  aktif: boolean; video: number; dokumen: number; thumb_id: number | null; peserta: number; selesai: number
}
type Sync = { at: string | null; source: string | null; modul: number; materi: number; error: string | null }
type Res = { items: Module[]; divisi: string[]; folderUrl: string | null; sync: Sync; warning: string | null; can: { manage: boolean } }
type Material = { id: number; sumber: 'drive' | 'manual' | 'upload'; tersembunyi: boolean; ukuran: number | null; drive_file_id: string | null; judul: string; jenis: 'video' | 'dokumen' | 'link'; url: string | null; folder: string | null; mime: string | null; link: string | null; embed: string | null }
type Participant = { id: number; employee_id: number; nama: string; nip: string; divisi: string | null; jabatan: string | null; status: 'terdaftar' | 'selesai' | 'tidak_lulus'; tanggal: string | null; nilai: number | null; catatan: string | null }
type Employee = { id: number; nama: string; nip: string; divisi: string | null; jabatan: string | null }
type Detail = { item: Module & { created_at: string }; materials: Material[]; participants: Participant[]; summary: { peserta: number; selesai: number }; employees: Employee[]; can: { manage: boolean } }

const P_STATUS = { terdaftar: 'Terdaftar', selesai: 'Selesai', tidak_lulus: 'Tidak lulus' } as const
const P_TONE = { terdaftar: 'info', selesai: 'success', tidak_lulus: 'danger' } as const

export function TrainingPage(_props: { user: UserProfile }) {
  const [data, setData] = useState<Res | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [tab, setTab] = useState<'materi' | 'jadwal' | 'modul'>('materi')
  const [materiKey, setMateriKey] = useState(0)
  const [q, setQ] = useState('')
  const [kategori, setKategori] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  const [form, setForm] = useState<Module | 'baru' | null>(null)
  const [folderForm, setFolderForm] = useState(false)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => api<Res>('/api/hrd/training').then((r) => { setData(r); setError('') }).catch((e) => setError(e.message)), [])
  useEffect(() => { load() }, [load])
  async function sync() {
    setBusy(true)
    try {
      const r = await api<{ sync: Sync }>('/api/hrd/training', { method: 'PUT' })
      setMessage(`Sinkron selesai: ${r.sync.modul} modul, ${r.sync.materi} materi dari Google Drive.`)
      setMateriKey((k) => k + 1)
      load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const items = data?.items ?? []
  const categories = [...new Set(items.map((m) => m.kategori).filter((k): k is string => !!k))].sort()
  const term = q.trim().toLowerCase()
  const shown = items.filter((m) => (!kategori || m.kategori === kategori) && (!term || [m.judul, m.kategori, m.deskripsi, m.sasaran].some((x) => x?.toLowerCase().includes(term))))
  const manage = !!data?.can.manage

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">SDM · GOOGLE DRIVE</p>
          <h1>Training Karyawan</h1>
          <span>Materi training dari Google Drive dengan preview langsung, jadwal & rekap kehadiran dari spreadsheet, serta catatan peserta & nilai oleh HRD.</span>
        </div>
        {manage && tab === 'modul' && <button className="pap-primary-button" onClick={() => setForm('baru')}><Plus /> Modul baru</button>}
      </div>
      <div className="pap-segmented pap-page-tabs" role="tablist" aria-label="Bagian training">
        <button role="tab" aria-selected={tab === 'materi'} className={tab === 'materi' ? 'active' : ''} onClick={() => setTab('materi')}>Materi</button>
        <button role="tab" aria-selected={tab === 'jadwal'} className={tab === 'jadwal' ? 'active' : ''} onClick={() => setTab('jadwal')}>Jadwal Training</button>
        <button role="tab" aria-selected={tab === 'modul'} className={tab === 'modul' ? 'active' : ''} onClick={() => setTab('modul')}>Modul & Peserta</button>
      </div>
      {tab !== 'jadwal' && <>
      <div className="pap-sync-bar">
        <div className="pap-sync-items">
          <span className="pap-sync-title">Google Drive</span>
          <span className="pap-sync-item">Folder Training: {data?.sync.at ? `sinkron ${formatDate(data.sync.at, true)}${data.sync.source ? ` · ${data.sync.source}` : ''}` : manage && !data?.folderUrl ? 'link folder belum diisi' : 'belum pernah sinkron'}</span>
        </div>
        {manage && <button className="pap-btn" onClick={() => setFolderForm(true)}><FolderOpen /> Sumber Drive</button>}
        {manage && data?.folderUrl && <button className="pap-btn" disabled={busy} onClick={sync}><RefreshCw className={busy ? 'pap-spin' : ''} /> {busy ? 'Menyinkronkan...' : 'Sinkron'}</button>}
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {(error || data?.warning) && <Notice onClose={() => setError('')}>{error || data?.warning}</Notice>}
      </>}
      {tab === 'materi' && <MateriTab key={materiKey} manage={manage} />}
      {tab === 'jadwal' && <JadwalTab />}
      {tab === 'modul' && <>
      <div className="pap-stat-grid four">
        {([
          ['Modul training', `${items.filter((m) => m.aktif).length}`, `${items.filter((m) => m.aktif && m.wajib).length} wajib`, BookOpen, 'stat-1'],
          ['Video', `${items.reduce((n, m) => n + m.video, 0)}`, `${items.reduce((n, m) => n + m.dokumen, 0)} dokumen`, PlayCircle, 'stat-1'],
          ['Peserta tercatat', `${items.reduce((n, m) => n + m.peserta, 0)}`, 'Semua modul', Users, 'stat-1'],
          ['Selesai', `${items.reduce((n, m) => n + m.selesai, 0)}`, 'Peserta lulus / selesai', GraduationCap, 'stat-0'],
        ] as const).map(([label, value, note, Icon, tone]) => (
          <div key={label} className="pap-stat-card"><div><span>{label}</span><strong className="pap-stat-text">{value}</strong><small className="neutral">{note}</small></div><div className={`pap-stat-icon ${tone}`}><Icon /></div></div>
        ))}
      </div>
      <div className="pap-table-card">
        <div className="pap-card-head"><div><h2>Modul training</h2><p>Klik modul untuk menonton video, membuka materi{manage ? ', dan mencatat peserta' : ''}.</p></div></div>
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari modul, kategori, divisi..." /></label>
          <select className="pap-select" value={kategori} onChange={(e) => setKategori(e.target.value)} aria-label="Filter kategori">
            <option value="">Semua kategori</option>
            {categories.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <div className="pap-sop-group">
          <div className="pap-sop-grid">
            {shown.map((m) => (
              <button key={m.id} type="button" className={`pap-sop-card ${m.aktif ? '' : 'pap-training-hidden'}`} onClick={() => setOpen(m.id)}>
                <span className="pap-sop-thumb">
                  {m.thumb_id && <img src={`/api/hrd/training/materials/${m.thumb_id}/thumb?s=480`} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />}
                  {m.video ? <PlayCircle /> : <BookOpen />}
                </span>
                <span className="pap-sop-title">{m.judul}</span>
                <span className="pap-sop-meta">
                  {[m.kategori, `${m.video} video`, m.dokumen ? `${m.dokumen} dokumen` : null, m.durasi_menit ? `${m.durasi_menit} menit` : null].filter(Boolean).join(' · ')}
                </span>
                <span className="pap-sop-meta pap-training-badges">
                  {m.wajib && <span className="pap-status warning">Wajib</span>}
                  {m.sasaran && <span className="pap-chip">{m.sasaran}</span>}
                  {!m.aktif && <span className="pap-status neutral">Disembunyikan</span>}
                  {m.peserta > 0 && <span>{m.selesai}/{m.peserta} selesai</span>}
                </span>
              </button>
            ))}
          </div>
          {data && !items.length && (
            <div className="pap-empty">
              Belum ada modul training. {manage ? 'Buat folder "Training Karyawan" di Google Drive dengan satu subfolder per modul (isi video / dokumen), lalu tempel link-nya lewat tombol "Folder Drive". Bisa juga "Modul baru" dengan link video saja.' : 'HRD akan menambahkan modul training.'}
            </div>
          )}
          {data && items.length > 0 && !shown.length && <div className="pap-empty">Tidak ada modul yang cocok.</div>}
          {!data && !error && <div className="pap-empty">Memuat modul training...</div>}
        </div>
      </div>
      </>}
      {open && <ModuleDetail id={open} onClose={() => setOpen(null)} onEdit={(m) => { setOpen(null); setForm(m) }} onChanged={load} />}
      {form && <ModuleForm item={form === 'baru' ? null : form} divisi={data?.divisi ?? []} onClose={() => setForm(null)} onSaved={(t) => { setForm(null); setMessage(t); load() }} />}
      {folderForm && <FolderForm current={data?.folderUrl ?? ''} onClose={() => setFolderForm(false)} onSaved={(t) => { setFolderForm(false); setMessage(t); setMateriKey((k) => k + 1); load() }} />}
    </>
  )
}

function ModuleDetail({ id, onClose, onEdit, onChanged }: { id: number; onClose: () => void; onEdit: (m: Module) => void; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState<Material | null>(null)
  const [materialForm, setMaterialForm] = useState<Material | 'baru' | null>(null)
  const [preview, setPreview] = useState<number | null>(null)
  const load = useCallback(() => api<Detail>(`/api/hrd/training/${id}`).then((r) => {
    setD(r)
    setPlaying((cur) => cur ?? r.materials.find((m) => m.embed) ?? null)
  }).catch((e) => setError(e.message)), [id])
  useEffect(() => { load() }, [load])
  async function run(fn: () => Promise<unknown>) {
    setError('')
    try {
      await fn()
      await load()
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  if (!d) return <Modal title="Modul training" onClose={onClose}>{error ? <Notice>{error}</Notice> : <p className="pap-muted">Memuat...</p>}</Modal>
  const m = d.item
  const videos = d.materials.filter((x) => x.embed)
  const others = d.materials.filter((x) => !x.embed)
  const previewable = others.filter((x) => x.drive_file_id || x.sumber === 'upload').map((x) => ({ ...x, embed: x.drive_file_id ? `https://drive.google.com/file/d/${x.drive_file_id}/preview` : null }))
  const editButton = (x: Material) => d.can.manage && <button type="button" className="pap-icon-button" aria-label={`Ubah ${x.judul}`} title="Ubah materi" onClick={() => setMaterialForm(x)}><Pencil /></button>
  return (
    <Modal title={m.judul} subtitle={[m.kategori, m.sasaran ? `Sasaran: ${m.sasaran}` : 'Semua karyawan', m.durasi_menit && `${m.durasi_menit} menit`, m.dari_drive ? 'dari Google Drive' : 'modul manual'].filter(Boolean).join(' · ')} wide onClose={onClose}
      footer={<>
        {d.can.manage && !m.dari_drive && <button className="pap-btn danger" onClick={async () => (await confirmDialog(`Hapus modul ${m.judul}? Catatan pesertanya ikut terhapus.`)) && run(async () => { await api(`/api/hrd/training/${id}`, { method: 'DELETE' }); onClose() })}><Trash2 /> Hapus</button>}
        {d.can.manage && <button className="pap-btn" onClick={() => run(() => api(`/api/hrd/training/${id}`, { method: 'PATCH', json: { aktif: !m.aktif } }))}><EyeOff /> {m.aktif ? 'Sembunyikan' : 'Tampilkan'}</button>}
        <span className="pap-spacer" />
        <button className="pap-btn" onClick={onClose}>Tutup</button>
        {d.can.manage && <button className="pap-primary-button" onClick={() => onEdit(m)}><Pencil /> Ubah modul</button>}
      </>}>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-detail-badges">
        {m.wajib && <span className="pap-status warning">Wajib</span>}
        {!m.aktif && <span className="pap-status neutral">Disembunyikan</span>}
        <span className="pap-status success">{d.summary.selesai}/{d.summary.peserta} peserta selesai</span>
      </div>
      {m.deskripsi && <p className="pap-prewrap">{m.deskripsi}</p>}
      {playing?.embed && (
        <section className="pap-detail-section">
          <h3>{playing.judul}</h3>
          <div className="pap-sop-player"><iframe key={playing.id} src={playing.embed} title={playing.judul} allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen /></div>
          {playing.embed.includes('drive.google.com') && <p className="pap-hint">Video dari Google Drive perlu akun Anda punya akses ke foldernya (atau folder dibagikan ke siapa saja yang memiliki link).</p>}
        </section>
      )}
      <section className="pap-detail-section">
        <h3>Materi ({d.materials.length})</h3>
        {!d.materials.length && <p className="pap-muted">Belum ada materi. {d.can.manage ? 'Klik "Tambah materi" di bawah untuk mengunggah file atau menambah link.' : ''}</p>}
        <ul className="pap-file-list">
          {videos.map((x) => (
            <li key={x.id} className={playing?.id === x.id ? 'active' : ''}>
              <PlayCircle />
              <div><button type="button" className="pap-link-plain" onClick={() => setPlaying(x)}>{x.judul}</button><span>{[x.folder, x.sumber === 'drive' ? 'Video Google Drive' : 'Link video', x.tersembunyi && 'Disembunyikan'].filter(Boolean).join(' · ')}</span></div>
              {x.link && <a className="pap-icon-button" href={x.link} target="_blank" rel="noreferrer" aria-label="Buka di tab baru"><ExternalLink /></a>}
              {editButton(x)}
            </li>
          ))}
          {others.map((x) => (
            <li key={x.id}>
              {x.jenis === 'link' ? <Link2 /> : <FileText />}
              <div>{x.link ? <a href={x.link} target="_blank" rel="noreferrer">{x.judul} <ExternalLink className="pap-inline-icon" /></a> : <span>{x.judul}</span>}<span>{[x.folder, x.jenis === 'link' ? 'Link' : x.sumber === 'upload' ? 'File SIMPAP' : 'Dokumen Google Drive', x.ukuran ? formatSize(x.ukuran) : null, x.tersembunyi && 'Disembunyikan'].filter(Boolean).join(' · ')}</span></div>
              {(x.drive_file_id || x.sumber === 'upload') && <button type="button" className="pap-icon-button" title="Lihat preview" aria-label={`Lihat preview ${x.judul}`} onClick={() => setPreview(x.id)}><Eye /></button>}
              {editButton(x)}
            </li>
          ))}
        </ul>
        {d.can.manage && <button type="button" className="pap-btn pap-add-item" onClick={() => setMaterialForm('baru')}><Plus /> Tambah materi</button>}
      </section>
      {d.can.manage && <Participants id={id} detail={d} onChanged={() => run(async () => {})} />}
      {preview !== null && <PreviewDialog items={previewable} id={preview} onChange={setPreview} onClose={() => setPreview(null)} />}
      {materialForm && <MaterialForm item={materialForm === 'baru' ? null : materialForm} moduleId={id} onClose={() => setMaterialForm(null)} onSaved={() => { setMaterialForm(null); run(async () => {}) }} />}
    </Modal>
  )
}

function Participants({ id, detail, onChanged }: { id: number; detail: Detail; onChanged: () => void }) {
  const [pick, setPick] = useState<Set<number>>(new Set())
  const [q, setQ] = useState('')
  const [divisi, setDivisi] = useState('')
  const [v, setV] = useState({ status: 'terdaftar', tanggal: '', nilai: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const registered = new Set(detail.participants.map((p) => p.employee_id))
  const term = q.trim().toLowerCase()
  const divisions = [...new Set(detail.employees.map((e) => e.divisi).filter((x): x is string => !!x))].sort()
  const candidates = detail.employees.filter((e) => (!divisi || e.divisi === divisi) && (!term || [e.nama, e.nip, e.jabatan].some((x) => x?.toLowerCase().includes(term))))
  async function save(ids: number[], values = v) {
    if (!ids.length) return
    setBusy(true)
    setError('')
    try {
      await api(`/api/hrd/training/${id}/participants`, { method: 'PUT', json: { employee_ids: ids, ...values } })
      setPick(new Set())
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function remove(employeeId: number) {
    if (!(await confirmDialog('Hapus karyawan ini dari peserta?'))) return
    await api(`/api/hrd/training/${id}/participants?employee_id=${employeeId}`, { method: 'DELETE' }).catch((e) => setError(e.message))
    onChanged()
  }
  return (
    <section className="pap-detail-section">
      <h3>Peserta ({detail.participants.length})</h3>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {detail.participants.length > 0 && (
        <div className="pap-table-wrap bordered">
          <table>
            <thead><tr><th>Karyawan</th><th>Status</th><th>Tanggal</th><th className="pap-num">Nilai</th><th /></tr></thead>
            <tbody>
              {detail.participants.map((p) => (
                <tr key={p.id}>
                  <td><div className="pap-cell-title">{p.nama}</div><div className="pap-cell-sub">{p.nip} · {p.jabatan ?? p.divisi ?? ''}</div></td>
                  <td><span className={`pap-status ${P_TONE[p.status]}`}>{P_STATUS[p.status]}</span></td>
                  <td className="pap-nowrap">{p.tanggal ? formatDate(p.tanggal) : '—'}</td>
                  <td className="pap-num">{p.nilai ?? '—'}</td>
                  <td className="pap-nowrap">
                    <span className="pap-inline-actions">
                      {p.status !== 'selesai' && <button className="pap-icon-button" title="Tandai selesai hari ini" aria-label="Tandai selesai" disabled={busy} onClick={() => save([p.employee_id], { status: 'selesai', tanggal: new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10), nilai: '' })}><CheckCircle2 /></button>}
                      <button className="pap-icon-button" title="Hapus" aria-label="Hapus peserta" onClick={() => remove(p.employee_id)}><Trash2 /></button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="pap-inline-panel">
        <strong>Catat peserta</strong>
        <div className="pap-filters pap-training-pick">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari karyawan..." /></label>
          <select className="pap-select" value={divisi} onChange={(e) => setDivisi(e.target.value)} aria-label="Divisi"><option value="">Semua divisi</option>{divisions.map((x) => <option key={x} value={x}>{x}</option>)}</select>
          <button type="button" className="pap-btn" onClick={() => setPick(new Set([...pick, ...candidates.map((e) => e.id)]))}>Pilih semua ({candidates.length})</button>
        </div>
        <div className="pap-training-employees">
          {candidates.map((e) => (
            <label key={e.id} className="pap-check">
              <input type="checkbox" checked={pick.has(e.id)} onChange={() => setPick((cur) => { const next = new Set(cur); if (next.has(e.id)) next.delete(e.id); else next.add(e.id); return next })} />
              <span>{e.nama} <small className="pap-muted">{e.jabatan ?? ''}{registered.has(e.id) ? ' · sudah tercatat' : ''}</small></span>
            </label>
          ))}
        </div>
        <div className="pap-form-grid">
          <Field label="Status"><select className="pap-select" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>{Object.entries(P_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Tanggal"><input className="pap-input" type="date" value={v.tanggal} onChange={(e) => setV({ ...v, tanggal: e.target.value })} /></Field>
          <Field label="Nilai (0–100, opsional)"><input className="pap-input" type="number" min={0} max={100} step="any" value={v.nilai} onChange={(e) => setV({ ...v, nilai: e.target.value })} /></Field>
        </div>
        <button className="pap-primary-button" disabled={busy || !pick.size} onClick={() => save([...pick])}><Users /> {busy ? 'Menyimpan...' : `Simpan ${pick.size} peserta`}</button>
      </div>
    </section>
  )
}

function ModuleForm({ item, divisi, onClose, onSaved }: { item: Module | null; divisi: string[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [v, setV] = useState({
    judul: item?.judul ?? '', kategori: item?.kategori ?? '', deskripsi: item?.deskripsi ?? '', sasaran: item?.sasaran ? item.sasaran.split(',').map((s) => s.trim()).filter(Boolean) : [] as string[],
    wajib: item?.wajib ?? false, durasi_menit: item?.durasi_menit?.toString() ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (item) await api(`/api/hrd/training/${item.id}`, { method: 'PATCH', json: v })
      else await api('/api/hrd/training', { method: 'POST', json: v })
      onSaved(item ? 'Modul training diperbarui.' : 'Modul training ditambahkan. Buka modulnya untuk menambah link video & peserta.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const toggle = (d: string) => setV({ ...v, sasaran: v.sasaran.includes(d) ? v.sasaran.filter((x) => x !== d) : [...v.sasaran, d] })
  return (
    <Modal title={item ? 'Ubah modul training' : 'Modul training baru'} subtitle={item?.dari_drive ? 'Judul mengikuti nama subfolder di Google Drive' : 'Modul tanpa folder Drive (mis. link video saja)'} onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="training-form" disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan'}</button></>}>
      <form id="training-form" className="pap-form-grid" onSubmit={save}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Judul *" full><input className="pap-input" required maxLength={255} value={v.judul} disabled={item?.dari_drive} onChange={(e) => setV({ ...v, judul: e.target.value })} placeholder="Mis. K3 Dasar Area Produksi" /></Field>
        <Field label="Kategori"><input className="pap-input" maxLength={80} value={v.kategori} onChange={(e) => setV({ ...v, kategori: e.target.value })} placeholder="Mis. K3, Mesin, Soft skill" /></Field>
        <Field label="Durasi (menit)"><input className="pap-input" type="number" min={0} value={v.durasi_menit} onChange={(e) => setV({ ...v, durasi_menit: e.target.value })} /></Field>
        <Field label="Deskripsi / tujuan" full><textarea className="pap-input" rows={3} maxLength={5000} value={v.deskripsi} onChange={(e) => setV({ ...v, deskripsi: e.target.value })} /></Field>
        <div className="pap-field full">
          <span>Sasaran divisi (kosong = semua karyawan)</span>
          <div className="pap-chip-tabs">{divisi.map((d) => <button type="button" key={d} className={v.sasaran.includes(d) ? 'active' : ''} onClick={() => toggle(d)}>{d}</button>)}</div>
        </div>
        <label className="pap-check full"><input type="checkbox" checked={v.wajib} onChange={(e) => setV({ ...v, wajib: e.target.checked })} /><span>Training wajib</span></label>
      </form>
    </Modal>
  )
}

function FolderForm({ current, onClose, onSaved }: { current: string; onClose: () => void; onSaved: (message: string) => void }) {
  const [url, setUrl] = useState(current)
  const [sheet, setSheet] = useState('')
  useEffect(() => { api<{ url: string | null }>('/api/hrd/training/schedule').then((r) => setSheet(r.url ?? '')).catch(() => {}) }, [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = await api<{ sync: Sync }>('/api/hrd/training', { method: 'PATCH', json: { folder_url: url } })
      await api('/api/hrd/training/schedule', { method: 'PATCH', json: { url: sheet } })
      onSaved(url ? `Sumber disimpan dan disinkron: ${r.sync.materi} materi, jadwal${sheet ? ' diperbarui' : ' dikosongkan'}.` : 'Link folder dikosongkan.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="Sumber Google Drive Training" subtitle="Folder materi dan spreadsheet jadwal" onClose={onClose}
      footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="training-folder" disabled={busy}>{busy ? 'Menyinkronkan...' : 'Simpan & sinkron'}</button></>}>
      <form id="training-folder" className="pap-form-grid" onSubmit={save}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Link folder materi" full><input className="pap-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://drive.google.com/drive/folders/..." /></Field>
        <Field label="Link spreadsheet jadwal" full><input className="pap-input" value={sheet} onChange={(e) => setSheet(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." /></Field>
        <p className="pap-muted full">File langsung di folder induk masuk modul &quot;Umum&quot;; subfolder menjadi modul tersendiri. Folder dan spreadsheet dibaca dengan akun Google di Master Data (bagikan ke akun itu sebagai Viewer). Spreadsheet perlu tab &quot;Rekap Data&quot; dan &quot;BATCH-1, BATCH-2, ...&quot;. Sinkron otomatis tiap ±6 jam.</p>
      </form>
    </Modal>
  )
}
