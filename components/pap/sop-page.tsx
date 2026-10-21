'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExternalLink, FolderOpen, PlayCircle, RefreshCw, Search, Settings2 } from 'lucide-react'
import type { UserProfile } from '@/lib/users'
import { api, Field, formatDate, Modal, Notice } from './ui'

type Video = {
  id: number; drive_file_id: string; judul: string; nama_file: string; folder: string | null; mime: string | null; ukuran: number | null
  diubah_drive: string | null; kategori: string; lini: string | null; kategori_manual: boolean
}
type SyncInfo = { at: string | null; source: string | null; count: number; error: string | null }

export function SopPage(_props: { user: UserProfile }) {
  const [items, setItems] = useState<Video[]>([])
  const [kategoriList, setKategoriList] = useState<string[]>([])
  const [folderUrl, setFolderUrl] = useState('')
  const [sync, setSync] = useState<SyncInfo | null>(null)
  const [can, setCan] = useState({ manage: false })
  const [kategori, setKategori] = useState('')
  const [lini, setLini] = useState('')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [playing, setPlaying] = useState<Video | null>(null)
  const [folderForm, setFolderForm] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await api<{ items: Video[]; folderUrl: string; sync: SyncInfo; warning: string | null; kategori: string[]; can: typeof can }>('/api/sop')
      setItems(res.items)
      setFolderUrl(res.folderUrl)
      setSync(res.sync)
      setKategoriList(res.kategori)
      setCan(res.can)
      if (res.warning) setError(res.warning)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  async function syncNow() {
    setBusy(true)
    setError('')
    try {
      const res = await api<{ sync: SyncInfo }>('/api/sop', { method: 'POST' })
      setMessage(`Sinkron selesai: ${res.sync.count} video dari ${res.sync.source}.`)
      setTimeout(() => setMessage(''), 5000)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const term = q.trim().toLowerCase()
  const visible = useMemo(
    () => items.filter((v) => (!kategori || v.kategori === kategori) && (!lini || v.lini === lini || (lini === '-' && !v.lini)) && (!term || `${v.judul} ${v.folder ?? ''}`.toLowerCase().includes(term))),
    [items, kategori, lini, term],
  )
  const counts = useMemo(() => Object.fromEntries(kategoriList.map((k) => [k, items.filter((v) => v.kategori === k).length])), [items, kategoriList])
  const groups = kategoriList.filter((k) => visible.some((v) => v.kategori === k))

  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">TEKNIK</p>
          <h1>SOP Mesin</h1>
          <span>Video SOP pengoperasian dan perawatan mesin dari folder Google Drive Teknik. Klik video untuk memutarnya; video baru di folder ikut muncul setelah sinkron.</span>
        </div>
        <div className="pap-inline-actions pap-wrap">
          {folderUrl && <a className="pap-btn" href={folderUrl} target="_blank" rel="noreferrer"><FolderOpen /> Buka folder Drive</a>}
          {can.manage && <button className="pap-btn" onClick={() => setFolderForm(true)}><Settings2 /> Link folder</button>}
          {can.manage && <button className="pap-primary-button" disabled={busy} onClick={syncNow}><RefreshCw /> {busy ? 'Menyinkron...' : 'Sinkron sekarang'}</button>}
        </div>
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}

      <div className="pap-table-card">
        <div className="pap-filters pap-filters-top">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari judul video..." /></label>
          <select className="pap-select" value={kategori} onChange={(e) => setKategori(e.target.value)} aria-label="Filter mesin">
            <option value="">Semua mesin ({items.length})</option>
            {kategoriList.map((k) => <option key={k} value={k}>{k === 'Umum' ? 'Umum / utilitas' : `MC ${k}`} ({counts[k] ?? 0})</option>)}
          </select>
          <select className="pap-select" value={lini} onChange={(e) => setLini(e.target.value)} aria-label="Filter lini">
            <option value="">Semua lini</option>
            <option value="PP">Inline PP</option>
            <option value="HD">Inline HD</option>
            <option value="-">Tidak disebut</option>
          </select>
          {sync?.at && <small className="pap-muted">Sinkron {formatDate(sync.at, true)}{sync.source ? ` · ${sync.source}` : ''}</small>}
        </div>
        {groups.map((g) => (
          <section key={g} className="pap-sop-group">
            <h3>{g === 'Umum' ? 'Umum / utilitas' : `MC ${g}`} <small>{visible.filter((v) => v.kategori === g).length} video</small></h3>
            <div className="pap-sop-grid">
              {visible.filter((v) => v.kategori === g).map((v) => (
                <button key={v.id} type="button" className="pap-sop-card" onClick={() => setPlaying(v)}>
                  <span className="pap-sop-thumb">
                    <img src={`/api/sop/${v.id}/thumb?s=480`} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
                    <PlayCircle />
                  </span>
                  <span className="pap-sop-title">{v.judul}</span>
                  <span className="pap-sop-meta">{[v.lini && `Inline ${v.lini}`, v.folder].filter(Boolean).join(' · ') || 'Video SOP'}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
        {!loading && !visible.length && <div className="pap-empty">{items.length ? 'Tidak ada video yang cocok dengan filter.' : 'Belum ada video SOP. Klik "Sinkron sekarang" untuk membaca folder Drive.'}</div>}
        {loading && <div className="pap-empty">Memuat video SOP...</div>}
      </div>

      {playing && <VideoModal video={playing} kategoriList={kategoriList} canManage={can.manage} onClose={() => setPlaying(null)} onChanged={load} />}
      {folderForm && <FolderForm current={folderUrl} onClose={() => setFolderForm(false)} onSaved={(text) => { setFolderForm(false); setMessage(text); load() }} />}
    </>
  )
}

function VideoModal({ video, kategoriList, canManage, onClose, onChanged }: { video: Video; kategoriList: string[]; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const [values, setValues] = useState({ kategori: video.kategori, lini: video.lini ?? '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const changed = values.kategori !== video.kategori || (values.lini || null) !== video.lini
  async function save() {
    setBusy(true)
    setError('')
    try {
      await api(`/api/sop/${video.id}`, { method: 'PATCH', json: values })
      setSaved('Kelompok mesin disimpan.')
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const driveUrl = `https://drive.google.com/file/d/${video.drive_file_id}/view`
  return (
    <Modal
      title={video.judul}
      subtitle={[video.kategori === 'Umum' ? 'Umum / utilitas' : `MC ${video.kategori}`, video.lini && `Inline ${video.lini}`, video.folder].filter(Boolean).join(' · ')}
      wide
      onClose={onClose}
      footer={<><a className="pap-btn" href={driveUrl} target="_blank" rel="noreferrer"><ExternalLink /> Buka di Google Drive</a><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Tutup</button></>}
    >
      <div className="pap-sop-player">
        <iframe src={`https://drive.google.com/file/d/${video.drive_file_id}/preview`} title={video.judul} allow="autoplay; fullscreen" allowFullScreen />
      </div>
      <p className="pap-hint">Video diputar dari Google Drive. Bila tidak tampil, buka di Google Drive (akun Anda perlu akses ke folder SOP).</p>
      {canManage && (
        <section className="pap-detail-section">
          <h3>Kelompok mesin</h3>
          {error && <Notice onClose={() => setError('')}>{error}</Notice>}
          {saved && <Notice kind="success" onClose={() => setSaved('')}>{saved}</Notice>}
          <div className="pap-inline-actions pap-wrap">
            <select className="pap-select" value={values.kategori} onChange={(e) => setValues((v) => ({ ...v, kategori: e.target.value }))} aria-label="Kelompok mesin">
              {kategoriList.map((k) => <option key={k} value={k}>{k === 'Umum' ? 'Umum / utilitas' : `MC ${k}`}</option>)}
            </select>
            <select className="pap-select" value={values.lini} onChange={(e) => setValues((v) => ({ ...v, lini: e.target.value }))} aria-label="Lini">
              <option value="">Semua lini</option><option value="PP">Inline PP</option><option value="HD">Inline HD</option>
            </select>
            <button className="pap-primary-button" disabled={busy || !changed} onClick={save}>{busy ? 'Menyimpan...' : 'Simpan'}</button>
          </div>
          <p className="pap-hint">{video.kategori_manual ? 'Kelompok sudah diatur manual dan tidak ditimpa saat sinkron.' : 'Kelompok ditebak otomatis dari nama file; betulkan bila keliru.'}</p>
        </section>
      )}
    </Modal>
  )
}

function FolderForm({ current, onClose, onSaved }: { current: string; onClose: () => void; onSaved: (text: string) => void }) {
  const [url, setUrl] = useState(current)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await api<{ sync: SyncInfo }>('/api/sop', { method: 'PATCH', json: { folder_url: url } })
      onSaved(`Folder SOP diganti; ${res.sync.count} video terbaca.`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="Link folder SOP" onClose={onClose} footer={<><span className="pap-spacer" /><button className="pap-btn" onClick={onClose}>Batal</button><button className="pap-primary-button" form="sop-folder-form" disabled={busy}>{busy ? 'Menyinkron...' : 'Simpan & sinkron'}</button></>}>
      <form id="sop-folder-form" className="pap-form-grid" onSubmit={submit}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Link folder Google Drive" full hint='Folder dibaca dengan akun Google di Master Data, atau langsung bila folder dibagikan "siapa saja yang memiliki link". Subfolder ikut dibaca.'>
          <input className="pap-input" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://drive.google.com/drive/folders/..." />
        </Field>
      </form>
    </Modal>
  )
}
