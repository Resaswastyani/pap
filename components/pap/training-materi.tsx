'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { BookOpen, ChevronLeft, ChevronRight, ExternalLink, Eye, EyeOff, FileSpreadsheet, FileText, Image as ImageIcon, Link2, Maximize, Pencil, PlayCircle, Plus, Presentation, Search, Trash2, Upload } from 'lucide-react'
import { api, confirmDialog, Field, formatSize, Modal, Notice } from './ui'

// Tab Materi: semua file dari folder Drive Training dengan preview di dalam SIMPAP.
// Folder bersifat privat, jadi Slides/Docs/PDF ditampilkan lewat server (akun Google di Master Data) dan digambar dengan PDF.js,
// sehingga karyawan tanpa akses Drive tetap bisa melihat, termasuk di HP (browser HP tidak bisa menampilkan PDF di iframe).

export type PreviewItem = { id: number; sumber: 'drive' | 'manual' | 'upload'; judul: string; jenis: 'video' | 'dokumen' | 'link'; mime: string | null; drive_file_id: string | null; link: string | null; embed: string | null }
export type MaterialItem = PreviewItem & { url: string | null; tersembunyi: boolean; ukuran: number | null; folder: string | null }
type Item = MaterialItem & { module_id: number; modul: string }

type Mode = 'pdf' | 'image' | 'video' | 'frame' | 'none'
function previewMode(m: PreviewItem): Mode {
  if (m.sumber === 'upload') {
    if (m.mime === 'application/pdf') return 'pdf'
    if (/^image\/(png|jpeg|gif|webp)$/.test(m.mime ?? '')) return 'image'
    if (/^video\/(mp4|webm)$/.test(m.mime ?? '')) return 'video'
    return 'none'
  }
  if (m.jenis === 'dokumen' && m.drive_file_id) {
    if (m.mime === 'application/pdf' || m.mime?.startsWith('application/vnd.google-apps.')) return 'pdf'
    if (m.mime?.startsWith('image/')) return 'image'
  }
  return m.embed ? 'frame' : 'none'
}

function kindOf(m: PreviewItem) {
  const t = m.mime ?? ''
  if (m.jenis === 'video') return { label: 'Video', Icon: PlayCircle }
  if (m.jenis === 'link') return { label: 'Link', Icon: Link2 }
  if (/presentation|powerpoint/.test(t)) return { label: 'Presentasi', Icon: Presentation }
  if (/spreadsheet|excel/.test(t)) return { label: 'Spreadsheet', Icon: FileSpreadsheet }
  if (t === 'application/pdf') return { label: 'PDF', Icon: FileText }
  if (t.startsWith('image/')) return { label: 'Gambar', Icon: ImageIcon }
  return { label: 'Dokumen', Icon: FileText }
}

export function MateriTab({ manage }: { manage: boolean }) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [preview, setPreview] = useState<number | null>(null)
  const [modules, setModules] = useState<{ id: number; judul: string }[]>([])
  const [form, setForm] = useState<Item | 'baru' | null>(null)
  const [message, setMessage] = useState('')
  const load = useCallback(() => api<{ items: Item[]; modules: { id: number; judul: string }[] }>('/api/hrd/training/materials').then((r) => { setItems(r.items); setModules(r.modules) }).catch((e) => setError(e.message)), [])
  useEffect(() => { load() }, [load])
  const term = q.trim().toLowerCase()
  const shown = (items ?? []).filter((m) => !term || [m.judul, m.modul, m.folder].some((x) => x?.toLowerCase().includes(term)))
  const groups = [...new Set(shown.map((m) => m.modul))].map((modul) => ({ modul, files: shown.filter((m) => m.modul === modul) }))
  return (
    <div className="pap-table-card">
      <div className="pap-card-head"><div><h2>Materi training</h2><p>Klik materi untuk melihat preview-nya di sini, tanpa perlu membuka Google Drive.</p></div>{manage && <button className="pap-primary-button" onClick={() => setForm('baru')}><Plus /> Tambah materi</button>}</div>
      <div className="pap-filters">
        <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari materi..." /></label>
      </div>
      {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
      {message && <div className="pap-card-notice"><Notice kind="success" onClose={() => setMessage('')}>{message}</Notice></div>}
      <div className="pap-sop-group">
        {groups.map((g) => (
          <div key={g.modul} className="pap-materi-group">
            {groups.length > 1 && <h3>{g.modul} <small>{g.files.length} materi</small></h3>}
            <div className="pap-sop-grid pap-materi-grid">
              {g.files.map((m) => {
                const { label, Icon } = kindOf(m)
                return (
                  <div key={m.id} className={`pap-materi-item ${m.tersembunyi ? 'is-hidden' : ''}`}>
                  <button type="button" className="pap-sop-card" onClick={() => setPreview(m.id)}>
                    <span className="pap-sop-thumb">
                      <Icon />
                      {m.drive_file_id && <img src={`/api/hrd/training/materials/${m.id}/thumb?s=480`} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} />}
                      <span className="pap-materi-kind">{label}</span>
                    </span>
                    <span className="pap-sop-title">{m.judul}</span>
                    <span className="pap-sop-meta pap-materi-meta">{m.tersembunyi ? <><EyeOff /> Disembunyikan</> : <><Eye /> Lihat preview</>}{m.ukuran ? ` · ${formatSize(m.ukuran)}` : ''}</span>
                  </button>
                  {manage && <button type="button" className="pap-icon-button pap-materi-edit" aria-label={`Ubah ${m.judul}`} title="Ubah materi" onClick={() => setForm(m)}><Pencil /></button>}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
        {items && !items.length && (
          <div className="pap-empty"><BookOpen style={{ width: 22, height: 22, opacity: 0.5 }} /><div>Belum ada materi. {manage ? 'Periksa link folder lewat tombol "Sumber Drive", lalu klik Sinkron.' : 'HRD akan menambahkan materi training.'}</div></div>
        )}
        {items && items.length > 0 && !shown.length && <div className="pap-empty">Tidak ada materi yang cocok.</div>}
        {!items && !error && <div className="pap-empty">Memuat materi...</div>}
      </div>
      {preview !== null && <PreviewDialog items={shown} id={preview} onChange={setPreview} onClose={() => setPreview(null)} />}
      {form && <MaterialForm item={form === 'baru' ? null : form} modules={modules} onClose={() => setForm(null)} onSaved={(t) => { setForm(null); setMessage(t); load() }} />}
    </div>
  )
}

// Tambah / ubah materi: file diunggah ke SIMPAP (maks 10 MB) atau link. Materi dari Drive: ubah judul & sembunyikan.
export function MaterialForm({ item, moduleId, modules, onClose, onSaved }: { item: MaterialItem | null; moduleId?: number; modules?: { id: number; judul: string }[]; onClose: () => void; onSaved: (text: string) => void }) {
  const [mode, setMode] = useState<'file' | 'link'>(item?.sumber === 'manual' ? 'link' : 'file')
  const [modul, setModul] = useState(String(moduleId ?? ''))
  const [judul, setJudul] = useState(item?.judul ?? '')
  const [url, setUrl] = useState(item?.url ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const isDrive = item?.sumber === 'drive'
  const path = item ? `/api/hrd/training/materials/${item.id}` : `/api/hrd/training/${modul}/materials`
  async function run(fn: () => Promise<unknown>, text: string) {
    setBusy(true)
    setError('')
    try {
      await fn()
      onSaved(text)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }
  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (file && file.size > 10 * 1024 * 1024) return setError(`${file.name}: ukuran maksimal 10 MB. Untuk file lebih besar, simpan di folder Drive Training atau tambahkan sebagai link.`)
    if (mode === 'file' && !isDrive && (file || !item)) {
      if (!file) return setError('Pilih file terlebih dahulu.')
      const body = new FormData()
      body.set('file', file)
      body.set('judul', judul)
      return run(() => api(path, { method: item ? 'PATCH' : 'POST', body }), item ? 'Materi diperbarui.' : 'Materi ditambahkan.')
    }
    if (item?.sumber === 'upload') {
      const body = new FormData()
      body.set('judul', judul)
      return run(() => api(path, { method: 'PATCH', body }), 'Materi diperbarui.')
    }
    run(() => api(path, { method: item ? 'PATCH' : 'POST', json: isDrive ? { judul } : { judul, url } }), item ? 'Materi diperbarui.' : 'Materi ditambahkan.')
  }
  const remove = async () => {
    if (await confirmDialog(`Hapus materi ${item!.judul}? Tindakan ini tidak bisa dibatalkan.`)) run(() => api(path, { method: 'DELETE' }), 'Materi dihapus.')
  }
  return (
    <Modal title={item ? 'Ubah materi' : 'Tambah materi'} subtitle={isDrive ? 'Materi dari Google Drive: isi file diubah di Drive' : undefined} onClose={onClose}
      footer={<>
        {item && !isDrive && <button type="button" className="pap-btn danger" disabled={busy} onClick={remove}><Trash2 /> Hapus</button>}
        {isDrive && <button type="button" className="pap-btn" disabled={busy} onClick={() => run(() => api(path, { method: 'PATCH', json: { tersembunyi: !item!.tersembunyi } }), item!.tersembunyi ? 'Materi ditampilkan lagi.' : 'Materi disembunyikan dari karyawan.')}>{item!.tersembunyi ? <Eye /> : <EyeOff />} {item!.tersembunyi ? 'Tampilkan' : 'Sembunyikan'}</button>}
        <span className="pap-spacer" />
        <button type="button" className="pap-btn" onClick={onClose}>Batal</button>
        <button className="pap-primary-button" form="material-form" disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan'}</button>
      </>}>
      <form id="material-form" className="pap-form-grid" onSubmit={submit}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        {!item && !moduleId && (
          <Field label="Modul training *" full>
            <select className="pap-select" required value={modul} onChange={(e) => setModul(e.target.value)}>
              <option value="">Pilih modul...</option>
              {modules?.map((m) => <option key={m.id} value={m.id}>{m.judul}</option>)}
            </select>
          </Field>
        )}
        {!item && (
          <div className="full pap-segmented" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'file'} className={mode === 'file' ? 'active' : ''} onClick={() => setMode('file')}><Upload /> Unggah file</button>
            <button type="button" role="tab" aria-selected={mode === 'link'} className={mode === 'link' ? 'active' : ''} onClick={() => setMode('link')}><Link2 /> Link</button>
          </div>
        )}
        <Field label={item ? 'Judul *' : 'Judul'} hint={item ? undefined : 'Kosongkan untuk memakai nama file / link'} full><input className="pap-input" required={!!item} maxLength={255} value={judul} onChange={(e) => setJudul(e.target.value)} /></Field>
        {mode === 'link' && !isDrive && <Field label="Link *" hint="YouTube, Google Drive, Vimeo, atau halaman web" full><input className="pap-input" type="url" required maxLength={1000} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></Field>}
        {mode === 'file' && !isDrive && (
          <Field label={item ? 'Ganti file' : 'File *'} hint={item ? 'Kosongkan bila file tidak diganti. Maksimal 10 MB.' : 'PDF, gambar, Word, Excel, PowerPoint, dll. Maksimal 10 MB; file lebih besar lewat folder Drive atau link.'} full>
            <input className="pap-input" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
        )}
      </form>
    </Modal>
  )
}

// Dialog preview dengan tombol materi sebelum / berikutnya
export function PreviewDialog({ items, id, onChange, onClose }: { items: PreviewItem[]; id: number; onChange: (id: number) => void; onClose: () => void }) {
  const index = items.findIndex((m) => m.id === id)
  const m = items[index]
  if (!m) return null
  const mode = previewMode(m)
  const prev = items[index - 1]
  const next = items[index + 1]
  return (
    <Modal title={m.judul} subtitle={`${kindOf(m).label} · materi ${index + 1} dari ${items.length}`} wide onClose={onClose}
      footer={<>
        {m.link && <a className="pap-btn" href={m.link} target="_blank" rel="noreferrer"><ExternalLink /> <span className="pap-materi-hide-sm">{m.sumber === 'upload' ? 'Buka / unduh' : m.sumber === 'manual' ? 'Buka link' : 'Buka di Drive'}</span></a>}
        <span className="pap-spacer" />
        <button type="button" className="pap-btn" disabled={!prev} onClick={() => prev && onChange(prev.id)}><ChevronLeft /> <span className="pap-materi-hide-sm">Sebelumnya</span></button>
        <button type="button" className="pap-btn" disabled={!next} onClick={() => next && onChange(next.id)}><span className="pap-materi-hide-sm">Berikutnya</span> <ChevronRight /></button>
      </>}>
      {mode === 'pdf' && <PdfViewer key={m.id} url={m.sumber === 'upload' ? m.link! : `/api/hrd/training/materials/${m.id}/pdf`} fallback={m.embed} />}
      {mode === 'image' && <div className="pap-materi-image"><img src={m.sumber === 'upload' ? m.link! : `/api/hrd/training/materials/${m.id}/thumb?s=1200`} alt={m.judul} /></div>}
      {mode === 'video' && <div className="pap-sop-player"><video key={m.id} src={m.link!} controls /></div>}
      {mode === 'frame' && (
        <>
          <div className="pap-sop-player"><iframe key={m.id} src={m.embed!} title={m.judul} allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen /></div>
          {m.embed!.includes('drive.google.com') && <p className="pap-hint">File ini ditampilkan oleh Google Drive, jadi perlu login dengan akun Google yang punya akses ke foldernya.{m.jenis === 'dokumen' ? ' Agar bisa dilihat semua karyawan, di Google Drive buka file ini lalu pilih File > Simpan sebagai Google Slide / Dokumen.' : ''}</p>}
        </>
      )}
      {mode === 'none' && <p className="pap-muted">Preview tidak tersedia. {m.link ? 'Buka lewat tombol di bawah.' : ''}</p>}
    </Modal>
  )
}

type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage>; destroy: () => Promise<void> }
type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number }
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void>; cancel: () => void }
}

async function loadPdfJs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString()
  return pdfjs
}

// Penampil slide: satu halaman selebar layar, geser dengan tombol / panah keyboard / usap, layar penuh untuk TV
function PdfViewer({ url, fallback }: { url: string; fallback: string | null }) {
  const [doc, setDoc] = useState<PdfDoc | null>(null)
  const [page, setPage] = useState(1)
  const [error, setError] = useState('')
  const [rendering, setRendering] = useState(true)
  const [width, setWidth] = useState(0)
  const canvas = useRef<HTMLCanvasElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const swipe = useRef<number | null>(null)

  useEffect(() => {
    let alive = true
    let opened: PdfDoc | null = null
    ;(async () => {
      const res = await fetch(url, { credentials: 'same-origin' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Preview gagal dimuat (${res.status}).`)
      const data = await res.arrayBuffer()
      const pdfjs = await loadPdfJs()
      opened = (await pdfjs.getDocument({ data }).promise) as unknown as PdfDoc
      if (alive) setDoc(opened)
    })().catch((e: Error) => { if (alive) { setError(e.message); setRendering(false) } })
    return () => { alive = false; opened?.destroy() }
  }, [url])

  useEffect(() => {
    const el = stage.current
    if (!el) return
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!doc || !width || !canvas.current) return
    let cancelled = false
    let task: { promise: Promise<void>; cancel: () => void } | null = null
    setRendering(true)
    doc.getPage(page).then((p) => {
      if (cancelled || !canvas.current) return
      const base = p.getViewport({ scale: 1 })
      // Muat dalam tinggi layar agar tombol halaman tetap terlihat
      const fit = Math.min(width / base.width, window.innerHeight * (document.fullscreenElement ? 0.88 : 0.56) / base.height)
      const viewport = p.getViewport({ scale: fit * Math.min(window.devicePixelRatio || 1, 2) })
      const c = canvas.current
      c.width = viewport.width
      c.height = viewport.height
      c.style.width = `${Math.floor(base.width * fit)}px`
      c.style.height = `${Math.floor(base.height * fit)}px`
      task = p.render({ canvasContext: c.getContext('2d')!, viewport })
      return task.promise.then(() => { if (!cancelled) setRendering(false) })
    }).catch(() => {})
    return () => { cancelled = true; task?.cancel() }
  }, [doc, page, width])

  const total = doc?.numPages ?? 0
  const go = useCallback((n: number) => setPage((cur) => Math.min(Math.max(1, cur + n), total || 1)), [total])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1)
      if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go])

  if (error) {
    return (
      <>
        <Notice>{error}</Notice>
        {fallback && <div className="pap-sop-player"><iframe src={fallback} title="Preview Google Drive" allowFullScreen /></div>}
      </>
    )
  }
  return (
    <div className="pap-pdf" ref={box}>
      <div className="pap-pdf-stage" ref={stage}
        onTouchStart={(e) => { swipe.current = e.touches[0].clientX }}
        onTouchEnd={(e) => {
          if (swipe.current === null) return
          const dx = e.changedTouches[0].clientX - swipe.current
          swipe.current = null
          if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1)
        }}>
        <canvas ref={canvas} className={doc ? '' : 'pap-pdf-empty'} />
        {rendering && <div className="pap-pdf-loading"><span className="pap-spinner" /> {doc ? 'Memuat halaman...' : 'Menyiapkan preview...'}</div>}
      </div>
      <div className="pap-pdf-bar">
        <button type="button" className="pap-icon-button" aria-label="Halaman sebelumnya" disabled={page <= 1} onClick={() => go(-1)}><ChevronLeft /></button>
        <span>{total ? `Halaman ${page} / ${total}` : '—'}</span>
        <button type="button" className="pap-icon-button" aria-label="Halaman berikutnya" disabled={!total || page >= total} onClick={() => go(1)}><ChevronRight /></button>
        <button type="button" className="pap-icon-button pap-pdf-full" aria-label="Layar penuh" title="Layar penuh" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : box.current?.requestFullscreen?.())}><Maximize /></button>
      </div>
    </div>
  )
}
