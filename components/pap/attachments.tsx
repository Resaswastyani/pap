'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, Clipboard, Download, FileText, Link2, Paperclip, Trash2, X } from 'lucide-react'
import { attachmentPreview } from '@/lib/attachment-preview'
import { ATTACHMENT_MAX_BYTES, VIDEO_ATTACHMENT_MAX_BYTES } from '@/lib/permissions'
import { compressImage, isCompressibleImage } from './compress'
import { api, formatDate, formatSize, Notice, confirmDialog } from './ui'

// Lampiran generik Prospek & Request Sample: semua format file (maks 2 MB), foto langsung dari kamera, atau link
// draft: link yang sudah diketik tetapi belum ditekan "Tambah link" (tetap ikut terkirim)
export type PendingAttachments = { files: File[]; links: { url: string; name: string }[]; draft?: { url: string; name: string } }
export const emptyAttachments = (): PendingAttachments => ({ files: [], links: [] })

type Attachment = { id: number; kind: 'file' | 'link'; name: string; url: string | null; mime: string | null; size: number | null; uploaded_by: number; created_at: string; uploaded_by_name: string }

const normalizeUrl = (value: string) => (/^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`)

const isVideo = (f: File) => f.type.startsWith('video/') || /\.(mp4|mov|m4v|3gp|webm|mkv|avi)$/i.test(f.name)

// Foto dari kamera HP biasanya > 2 MB: perkecil ke JPEG sampai muat; file lain > 2 MB ditolak.
// allowVideo (lampiran Prospek): video boleh sampai 10 MB.
async function fitFile(file: File, allowVideo = false): Promise<File> {
  if (allowVideo && isVideo(file)) {
    if (file.size <= VIDEO_ATTACHMENT_MAX_BYTES) return file
    throw new Error(`${file.name}: video ${formatSize(file.size)}, maksimal 10 MB. Simpan di Google Drive lalu tambahkan sebagai link.`)
  }
  if (file.size <= ATTACHMENT_MAX_BYTES) return file
  if (!isCompressibleImage(file)) throw new Error(`${file.name}: ukuran ${formatSize(file.size)}, maksimal 2 MB.`)
  return compressImage(file, ATTACHMENT_MAX_BYTES)
}

async function fitFiles(list: File[], allowVideo = false) {
  const ok: File[] = []
  const errors: string[] = []
  for (const f of list) {
    try {
      ok.push(await fitFile(f, allowVideo))
    } catch (e) {
      errors.push((e as Error).message)
    }
  }
  return { ok, errors }
}

// Gambar dari clipboard (Ctrl+V / tempel screenshot): diberi nama "Screenshot <tanggal jam>.png"
export function clipboardImages(e: ClipboardEvent | React.ClipboardEvent) {
  const items = [...(e.clipboardData?.items ?? [])]
  const stamp = new Date().toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'medium' }).replace(/[/:]/g, '-').replace(/,/g, '')
  return items
    .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
    .map((it, i, all) => {
      const f = it.getAsFile()!
      const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')
      return new File([f], `Screenshot ${stamp}${all.length > 1 ? ` (${i + 1})` : ''}.${ext}`, { type: f.type })
    })
}
// Tempel gambar di mana saja selama komponen tampil (teks biasa tetap tertempel seperti biasa)
function usePasteImages(enabled: boolean, onImages: (files: File[]) => void) {
  const ref = useRef(onImages)
  ref.current = onImages
  useEffect(() => {
    if (!enabled) return
    const handler = (e: ClipboardEvent) => {
      const files = clipboardImages(e)
      if (!files.length) return
      e.preventDefault()
      ref.current(files)
    }
    document.addEventListener('paste', handler)
    return () => document.removeEventListener('paste', handler)
  }, [enabled])
}

// Pratinjau kecil gambar yang belum diunggah
function PendingThumb({ file }: { file: File }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    const url = URL.createObjectURL(file)
    setSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  return src ? <img className="pap-attach-thumb" src={src} alt="" /> : <FileText />
}

const cameraName = () => `Foto ${new Date().toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }).replace(/[/:]/g, '-')}.jpg`

function FileButtons({ disabled, onFiles }: { disabled?: boolean; onFiles: (files: File[], fromCamera: boolean) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <button type="button" className="pap-btn" disabled={disabled} onClick={() => fileRef.current?.click()}><Paperclip /> File</button>
      <button type="button" className="pap-btn" disabled={disabled} onClick={() => cameraRef.current?.click()}><Camera /> Foto langsung</button>
      <input ref={fileRef} type="file" multiple hidden onChange={(e) => { onFiles([...(e.target.files ?? [])], false); e.target.value = '' }} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onFiles([...(e.target.files ?? [])], true); e.target.value = '' }} />
    </>
  )
}

// Isian lampiran yang belum dikirim (dipakai di form tambah); diunggah setelah data tersimpan
// pasteImages: gambar yang ditempel (Ctrl+V) selama form terbuka langsung masuk lampiran
export function AttachmentInput({ value, onChange, allowVideo = false, pasteImages = false }: { value: PendingAttachments; onChange: (v: PendingAttachments) => void; allowVideo?: boolean; pasteImages?: boolean }) {
  const url = value.draft?.url ?? ''
  const name = value.draft?.name ?? ''
  const setUrl = (v: string) => onChange({ ...value, draft: { url: v, name } })
  const setName = (v: string) => onChange({ ...value, draft: { url, name: v } })
  const [error, setError] = useState('')
  const addLink = () => {
    if (!url.trim()) return
    onChange({ ...value, links: [...value.links, { url: normalizeUrl(url), name: name.trim() }], draft: undefined })
  }
  async function addFiles(list: File[], fromCamera: boolean) {
    const named = fromCamera ? list.map((f) => new File([f], cameraName(), { type: f.type })) : list
    const { ok, errors } = await fitFiles(named, allowVideo)
    setError(errors.join(' '))
    if (ok.length) onChange({ ...value, files: [...value.files, ...ok] })
  }
  usePasteImages(pasteImages, (files) => addFiles(files, false))
  return (
    <div className="pap-attach-editor">
      {pasteImages && <div className="pap-paste-hint"><Clipboard /> Tempel screenshot langsung di sini dengan <kbd>Ctrl</kbd>+<kbd>V</kbd> (atau tekan <kbd>PrtSc</kbd> / <kbd>Win</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> dulu untuk mengambil layar).</div>}
      <div className="pap-attach-row">
        <FileButtons onFiles={addFiles} />
        <small className="pap-muted">{allowVideo ? 'Foto, video (maks 10 MB), atau file lain (maks 2 MB). Foto besar dikompres otomatis.' : 'Semua format file, maks 2 MB per file. Gambar lebih besar dikompres otomatis ke 2 MB.'}</small>
      </div>
      <div className="pap-attach-row">
        <input className="pap-input" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Link (opsional): Google Drive, katalog, dll." onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLink() } }} />
        <input className="pap-input" value={name} maxLength={255} onChange={(e) => setName(e.target.value)} placeholder="Judul link (opsional)" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLink() } }} />
        <button type="button" className="pap-btn" disabled={!url.trim()} onClick={addLink}><Link2 /> Tambah link</button>
      </div>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {(value.links.length > 0 || value.files.length > 0) && (
        <ul className="pap-attach-pending">
          {value.links.map((l, i) => <li key={`l${i}`}><Link2 /><span>{l.name || l.url}</span><button type="button" aria-label="Hapus link" onClick={() => onChange({ ...value, links: value.links.filter((_, j) => j !== i) })}><X /></button></li>)}
          {value.files.map((f, i) => <li key={`f${i}`}>{f.type.startsWith('image/') ? <PendingThumb file={f} /> : <FileText />}<span>{f.name} · {formatSize(f.size)}</span><button type="button" aria-label="Hapus file" onClick={() => onChange({ ...value, files: value.files.filter((_, j) => j !== i) })}><X /></button></li>)}
        </ul>
      )}
    </div>
  )
}

async function postAttachment(basePath: string, part: { file: File } | { url: string; name: string }) {
  const form = new FormData()
  if ('file' in part) form.append('file', part.file)
  else {
    form.append('url', part.url)
    if (part.name) form.append('name', part.name)
  }
  await api(basePath, { method: 'POST', body: form })
}

// Unggah satu per satu (batas body request 4,5 MB); mengembalikan pesan untuk yang gagal
export async function uploadPendingAttachments(basePath: string, pending: PendingAttachments) {
  const failed: string[] = []
  for (const file of pending.files) await postAttachment(basePath, { file }).catch((e) => failed.push((e as Error).message))
  for (const link of pendingLinks(pending)) await postAttachment(basePath, link).catch((e) => failed.push((e as Error).message))
  return failed
}

// Daftar lampiran di halaman detail + tambah file / foto / link
// preview: tampilkan pratinjau (gambar, thumbnail link Google Drive, kartu jenis file untuk PDF / link lain) di atas daftar
export function AttachmentPanel({ title = 'Lampiran', basePath, fileBase, canAdd, currentUserId, isAdmin, allowVideo = false, pasteImages = false, preview = false }: {
  title?: string; basePath: string; fileBase: string; canAdd: boolean; currentUserId: number; isAdmin: boolean; allowVideo?: boolean; pasteImages?: boolean; preview?: boolean
}) {
  const [items, setItems] = useState<Attachment[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [linking, setLinking] = useState(false)
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const load = useCallback(() => {
    api<{ items: Attachment[] }>(basePath).then((r) => setItems(r.items)).catch((e) => setError(e.message))
  }, [basePath])
  useEffect(load, [load])

  async function run(task: () => Promise<string[] | unknown>) {
    setBusy(true)
    setError('')
    try {
      const failed = await task()
      if (Array.isArray(failed) && failed.length) setError(failed.join(' '))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      load()
    }
  }
  const addFiles = (list: File[], fromCamera: boolean) => run(async () => {
    const named = fromCamera ? list.map((f) => new File([f], cameraName(), { type: f.type })) : list
    const { ok, errors } = await fitFiles(named, allowVideo)
    return [...errors, ...(await uploadPendingAttachments(basePath, { files: ok, links: [] }))]
  })
  usePasteImages(pasteImages && canAdd, (files) => addFiles(files, false))
  const addLink = () => run(async () => {
    await postAttachment(basePath, { url: normalizeUrl(url), name: name.trim() })
    setUrl('')
    setName('')
    setLinking(false)
  })

  if (!items.length && !canAdd) return null
  return (
    <section className="pap-detail-section">
      <div className="pap-section-head">
        <h3>{title} ({items.length})</h3>
        {canAdd && (
          <div className="pap-inline-actions">
            <FileButtons disabled={busy} onFiles={addFiles} />
            <button type="button" className="pap-btn" disabled={busy} onClick={() => setLinking((v) => !v)}><Link2 /> Link</button>
          </div>
        )}
      </div>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      {pasteImages && canAdd && <p className="pap-muted pap-paste-note"><Clipboard className="pap-inline-icon" /> Screenshot bisa langsung ditempel (Ctrl+V).</p>}
      {busy && <p className="pap-muted">Mengunggah...</p>}
      {linking && (
        <div className="pap-attach-row">
          <input className="pap-input" inputMode="url" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Tempel link" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (url.trim()) addLink() } }} />
          <input className="pap-input" value={name} maxLength={255} onChange={(e) => setName(e.target.value)} placeholder="Judul link (opsional)" />
          <button type="button" className="pap-primary-button" disabled={busy || !url.trim()} onClick={addLink}>Simpan link</button>
        </div>
      )}
      {preview && items.length > 0 && <div className="pap-oc-designs">{items.map((a) => <AttachmentThumb key={a.id} a={a} fileBase={fileBase} />)}</div>}
      <ul className="pap-file-list">
        {items.map((a) => (
          <li key={a.id}>
            {a.kind === 'link' ? <Link2 /> : <FileText />}
            <div>
              <a href={a.kind === 'link' ? a.url! : `${fileBase}/${a.id}`} target="_blank" rel="noreferrer">{a.name}</a>
              <span>{a.kind === 'link' ? a.url : formatSize(a.size)} · {a.uploaded_by_name} · {formatDate(a.created_at, true)}</span>
            </div>
            {a.kind === 'file' && <a className="pap-icon-button" href={`${fileBase}/${a.id}?download=1`} aria-label={`Unduh ${a.name}`}><Download /></a>}
            {(a.uploaded_by === currentUserId || isAdmin) && <button type="button" className="pap-icon-button" aria-label={`Hapus ${a.name}`} onClick={async () => (await confirmDialog(`Hapus lampiran ${a.name}?`)) && run(() => api(`${fileBase}/${a.id}`, { method: 'DELETE' }))}><Trash2 /></button>}
          </li>
        ))}
      </ul>
      {!items.length && <p className="pap-muted">Belum ada lampiran.</p>}
    </section>
  )
}

// Satu kotak pratinjau lampiran; klik membuka gambar / file / link di tab baru (layar penuh)
function AttachmentThumb({ a, fileBase }: { a: Attachment; fileBase: string }) {
  const p = attachmentPreview(a, fileBase)
  const [failed, setFailed] = useState(false)
  return (
    <figure className="pap-oc-design">
      <a href={p.href} target="_blank" rel="noreferrer" title={`Buka ${p.name}`}>
        {p.src && !failed
          // aislop-ignore-next-line next/no-img-element -- pratinjau lampiran privat lewat API (bukan aset statis)
          ? <img src={p.src} alt={p.name} loading="lazy" onError={() => setFailed(true)} />
          : <span className="pap-oc-dz-noprev">{p.isLink ? <Link2 /> : <FileText />}<small>{p.type}</small></span>}
      </a>
      <figcaption title={p.name}>{p.name}</figcaption>
    </figure>
  )
}

// ---- Lampiran catatan (follow-up, catatan status request, catatan produksi) ----
export type NoteOwner = 'activity' | 'request_log' | 'stage' | 'job' | 'repair' | 'maintenance_log' | 'purchase_request' | 'damage_log' | 'complaint' | 'order_custom' | 'tech_analysis'
export type NoteAttachment = Attachment
export const pendingLinks = (p: PendingAttachments) => (p.draft?.url.trim() ? [...p.links, { url: normalizeUrl(p.draft.url), name: p.draft.name.trim() }] : p.links)
export const pendingCount = (p: PendingAttachments) => p.files.length + pendingLinks(p).length

// Dipakai setelah catatan tersimpan dan id-nya diketahui
export const uploadNoteAttachments = (owner: NoteOwner, noteId: number, pending: PendingAttachments) =>
  uploadPendingAttachments(`/api/notes/${owner}/${noteId}/attachments`, pending)

// Foto besar diperkecil otomatis; file lain > 2 MB ditolak (dipakai juga oleh Planning, Meeting, Visit)
export const prepareFiles = fitFiles

// Daftar lampiran di bawah sebuah catatan (data ikut dari API daftar catatan)
export function NoteFiles({ items, currentUserId, isAdmin, onChanged }: { items?: NoteAttachment[]; currentUserId?: number; isAdmin?: boolean; onChanged?: () => void }) {
  const [error, setError] = useState('')
  if (!items?.length) return null
  async function remove(a: NoteAttachment) {
    if (!(await confirmDialog(`Hapus lampiran ${a.name}?`))) return
    try {
      await api(`/api/notes/attachments/${a.id}`, { method: 'DELETE' })
      onChanged?.()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <>
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <ul className="pap-note-files">
        {items.map((a) => (
          <li key={a.id}>
            {a.kind === 'link' ? <Link2 /> : <FileText />}
            <a href={a.kind === 'link' ? a.url! : `/api/notes/attachments/${a.id}`} target="_blank" rel="noreferrer">{a.name}</a>
            {a.kind === 'file' && <small>{formatSize(a.size)}</small>}
            {a.kind === 'file' && <a className="pap-note-download" href={`/api/notes/attachments/${a.id}?download=1`} aria-label={`Unduh ${a.name}`} title="Unduh"><Download /></a>}
            {onChanged && (a.uploaded_by === currentUserId || isAdmin) && <button type="button" aria-label={`Hapus ${a.name}`} onClick={() => remove(a)}><X /></button>}
          </li>
        ))}
      </ul>
    </>
  )
}
