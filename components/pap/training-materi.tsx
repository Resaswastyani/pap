'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { BookOpen, ChevronLeft, ChevronRight, ExternalLink, Eye, FileSpreadsheet, FileText, Image as ImageIcon, Link2, Maximize, PlayCircle, Presentation, Search } from 'lucide-react'
import { api, formatSize, Modal, Notice } from './ui'

// Tab Materi: semua file dari folder Drive Training dengan preview di dalam SIMPAP.
// Folder bersifat privat, jadi Slides/Docs/PDF ditampilkan lewat server (akun Google di Master Data) dan digambar dengan PDF.js,
// sehingga karyawan tanpa akses Drive tetap bisa melihat, termasuk di HP (browser HP tidak bisa menampilkan PDF di iframe).

export type PreviewItem = { id: number; judul: string; jenis: 'video' | 'dokumen' | 'link'; mime: string | null; drive_file_id: string | null; link: string | null; embed: string | null }
type Item = PreviewItem & { modul: string; ukuran: number | null; folder: string | null }

type Mode = 'pdf' | 'image' | 'frame' | 'none'
function previewMode(m: PreviewItem): Mode {
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
  useEffect(() => {
    api<{ items: Item[] }>('/api/hrd/training/materials').then((r) => setItems(r.items)).catch((e) => setError(e.message))
  }, [])
  const term = q.trim().toLowerCase()
  const shown = (items ?? []).filter((m) => !term || [m.judul, m.modul, m.folder].some((x) => x?.toLowerCase().includes(term)))
  const groups = [...new Set(shown.map((m) => m.modul))].map((modul) => ({ modul, files: shown.filter((m) => m.modul === modul) }))
  return (
    <div className="pap-table-card">
      <div className="pap-card-head"><div><h2>Materi training</h2><p>Klik materi untuk melihat preview-nya di sini, tanpa perlu membuka Google Drive.</p></div></div>
      <div className="pap-filters">
        <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari materi..." /></label>
      </div>
      {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
      <div className="pap-sop-group">
        {groups.map((g) => (
          <div key={g.modul} className="pap-materi-group">
            {groups.length > 1 && <h3>{g.modul} <small>{g.files.length} materi</small></h3>}
            <div className="pap-sop-grid pap-materi-grid">
              {g.files.map((m) => {
                const { label, Icon } = kindOf(m)
                return (
                  <button key={m.id} type="button" className="pap-sop-card" onClick={() => setPreview(m.id)}>
                    <span className="pap-sop-thumb">
                      <Icon />
                      {m.drive_file_id && <img src={`/api/hrd/training/materials/${m.id}/thumb?s=480`} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} />}
                      <span className="pap-materi-kind">{label}</span>
                    </span>
                    <span className="pap-sop-title">{m.judul}</span>
                    <span className="pap-sop-meta pap-materi-meta"><Eye /> Lihat preview{m.ukuran ? ` · ${formatSize(m.ukuran)}` : ''}</span>
                  </button>
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
    </div>
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
        {m.link && <a className="pap-btn" href={m.link} target="_blank" rel="noreferrer"><ExternalLink /> <span className="pap-materi-hide-sm">Buka di Drive</span></a>}
        <span className="pap-spacer" />
        <button type="button" className="pap-btn" disabled={!prev} onClick={() => prev && onChange(prev.id)}><ChevronLeft /> <span className="pap-materi-hide-sm">Sebelumnya</span></button>
        <button type="button" className="pap-btn" disabled={!next} onClick={() => next && onChange(next.id)}><span className="pap-materi-hide-sm">Berikutnya</span> <ChevronRight /></button>
      </>}>
      {mode === 'pdf' && <PdfViewer key={m.id} url={`/api/hrd/training/materials/${m.id}/pdf`} fallback={m.embed} />}
      {mode === 'image' && <div className="pap-materi-image"><img src={`/api/hrd/training/materials/${m.id}/thumb?s=1200`} alt={m.judul} /></div>}
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
