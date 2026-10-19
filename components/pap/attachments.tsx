'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, Download, FileText, Link2, Paperclip, Trash2, X } from 'lucide-react'
import { ATTACHMENT_MAX_BYTES } from '@/lib/permissions'
import { api, formatDate, formatSize, Notice } from './ui'

// Lampiran generik Prospek & Request Sample: semua format file (maks 2 MB), foto langsung dari kamera, atau link
export type PendingAttachments = { files: File[]; links: { url: string; name: string }[] }
export const emptyAttachments = (): PendingAttachments => ({ files: [], links: [] })

type Attachment = { id: number; kind: 'file' | 'link'; name: string; url: string | null; mime: string | null; size: number | null; uploaded_by: number; created_at: string; uploaded_by_name: string }

const normalizeUrl = (value: string) => (/^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`)

// Foto dari kamera HP biasanya > 2 MB: perkecil ke JPEG sampai muat; file lain > 2 MB ditolak
async function fitFile(file: File): Promise<File> {
  if (file.size <= ATTACHMENT_MAX_BYTES) return file
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error(`${file.name}: ukuran ${formatSize(file.size)}, maksimal 2 MB.`)
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error(`${file.name}: gambar tidak dapat dibaca.`))
      el.src = url
    })
    for (const [maxSide, quality] of [[2048, 0.82], [1600, 0.78], [1280, 0.72], [1024, 0.65]] as const) {
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.naturalWidth * scale)
      canvas.height = Math.round(img.naturalHeight * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
      if (blob && blob.size <= ATTACHMENT_MAX_BYTES) return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
    }
    throw new Error(`${file.name}: gambar terlalu besar walau sudah diperkecil.`)
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function fitFiles(list: File[]) {
  const ok: File[] = []
  const errors: string[] = []
  for (const f of list) {
    try {
      ok.push(await fitFile(f))
    } catch (e) {
      errors.push((e as Error).message)
    }
  }
  return { ok, errors }
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
export function AttachmentInput({ value, onChange }: { value: PendingAttachments; onChange: (v: PendingAttachments) => void }) {
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const addLink = () => {
    if (!url.trim()) return
    onChange({ ...value, links: [...value.links, { url: normalizeUrl(url), name: name.trim() }] })
    setUrl('')
    setName('')
  }
  async function addFiles(list: File[], fromCamera: boolean) {
    const named = fromCamera ? list.map((f) => new File([f], cameraName(), { type: f.type })) : list
    const { ok, errors } = await fitFiles(named)
    setError(errors.join(' '))
    if (ok.length) onChange({ ...value, files: [...value.files, ...ok] })
  }
  return (
    <div className="pap-attach-editor">
      <div className="pap-attach-row">
        <FileButtons onFiles={addFiles} />
        <small className="pap-muted">Semua format file, maks 2 MB per file. Foto besar diperkecil otomatis.</small>
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
          {value.files.map((f, i) => <li key={`f${i}`}><FileText /><span>{f.name} · {formatSize(f.size)}</span><button type="button" aria-label="Hapus file" onClick={() => onChange({ ...value, files: value.files.filter((_, j) => j !== i) })}><X /></button></li>)}
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
  for (const link of pending.links) await postAttachment(basePath, link).catch((e) => failed.push((e as Error).message))
  return failed
}

// Daftar lampiran di halaman detail + tambah file / foto / link
export function AttachmentPanel({ title = 'Lampiran', basePath, fileBase, canAdd, currentUserId, isAdmin }: {
  title?: string; basePath: string; fileBase: string; canAdd: boolean; currentUserId: number; isAdmin: boolean
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
    const { ok, errors } = await fitFiles(named)
    return [...errors, ...(await uploadPendingAttachments(basePath, { files: ok, links: [] }))]
  })
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
      {busy && <p className="pap-muted">Mengunggah...</p>}
      {linking && (
        <div className="pap-attach-row">
          <input className="pap-input" inputMode="url" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Tempel link" onKeyDown={(e) => { if (e.key === 'Enter' && url.trim()) addLink() }} />
          <input className="pap-input" value={name} maxLength={255} onChange={(e) => setName(e.target.value)} placeholder="Judul link (opsional)" />
          <button type="button" className="pap-primary-button" disabled={busy || !url.trim()} onClick={addLink}>Simpan link</button>
        </div>
      )}
      <ul className="pap-file-list">
        {items.map((a) => (
          <li key={a.id}>
            {a.kind === 'link' ? <Link2 /> : <FileText />}
            <div>
              <a href={a.kind === 'link' ? a.url! : `${fileBase}/${a.id}`} target="_blank" rel="noreferrer">{a.name}</a>
              <span>{a.kind === 'link' ? a.url : formatSize(a.size)} · {a.uploaded_by_name} · {formatDate(a.created_at, true)}</span>
            </div>
            {a.kind === 'file' && <a className="pap-icon-button" href={`${fileBase}/${a.id}?download=1`} aria-label={`Unduh ${a.name}`}><Download /></a>}
            {(a.uploaded_by === currentUserId || isAdmin) && <button type="button" className="pap-icon-button" aria-label={`Hapus ${a.name}`} onClick={() => window.confirm(`Hapus lampiran ${a.name}?`) && run(() => api(`${fileBase}/${a.id}`, { method: 'DELETE' }))}><Trash2 /></button>}
          </li>
        ))}
      </ul>
      {!items.length && <p className="pap-muted">Belum ada lampiran.</p>}
    </section>
  )
}

// ---- Lampiran catatan (follow-up, catatan status request, catatan produksi) ----
export type NoteOwner = 'activity' | 'request_log' | 'stage' | 'job' | 'repair'
export type NoteAttachment = Attachment
export const pendingCount = (p: PendingAttachments) => p.files.length + p.links.length

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
    if (!window.confirm(`Hapus lampiran ${a.name}?`)) return
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
            {onChanged && (a.uploaded_by === currentUserId || isAdmin) && <button type="button" aria-label={`Hapus ${a.name}`} onClick={() => remove(a)}><X /></button>}
          </li>
        ))}
      </ul>
    </>
  )
}
