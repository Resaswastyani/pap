'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, CheckCircle2, ClipboardList, Clock3, ExternalLink, FileText, Link2, Paperclip, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react'
import { FILE_MAX_BYTES, PERMISSIONS, PLANNING_STATUS, type PlanningStatus } from '@/lib/permissions'
import type { UserProfile } from '@/lib/users'
import { prepareFiles } from './attachments'
import { api, Field, formatDate, formatSize, Modal, Notice, Pager, Progress, StatusBadge, usePaged, type UserOption, UserPicker, RowActions, useQuickAction } from './ui'

type Division = { id: number; code: string; name: string }
type Abilities = { edit: boolean; delete: boolean; progress: boolean; attach: boolean }
type Planning = {
  id: number
  nomor: string
  division_id: number
  division_name: string
  judul: string
  deskripsi: string | null
  tanggal_mulai: string
  tanggal_selesai: string
  status: PlanningStatus
  progress: number
  meeting_id: number | null
  meeting_nomor: string | null
  meeting_judul: string | null
  created_by: number
  created_by_name: string
  created_at: string
  file_count: number
  pic_ids: number[]
  is_pic: boolean
  can: Abilities
}
type Pic = { id: number; name: string; division_name: string }
export type PlanningFile = { id: number; type: 'link' | 'file'; name: string; url: string | null; mime: string | null; size: number | null; uploaded_by: number; uploaded_by_name: string; created_at: string }
type ProgressNote = { id: number; progress: number; status: PlanningStatus; catatan: string | null; created_by_name: string; created_at: string; updated_at: string; files: PlanningFile[]; can: { edit: boolean; delete: boolean } }
type Summary = { total: number; belum_mulai: number; berjalan: number; selesai: number }
export type PendingAttachment = { kind: 'file'; file: File } | { kind: 'link'; name: string; url: string }

const has = (user: UserProfile, permission: string) => user.role.isSuperAdmin || user.permissions.includes(permission as never)

function validateFile(file: File) {
  if (file.size > FILE_MAX_BYTES) return `${file.name}: ukuran maksimal 2 MB.`
  return ''
}

// noteId diisi untuk menambah lampiran ke catatan progress
async function uploadAttachment(planningId: number, item: PendingAttachment, noteId?: number) {
  if (item.kind === 'link') return api<{ files: PlanningFile[] }>(`/api/planning/${planningId}/files`, { method: 'POST', json: { name: item.name, url: item.url, note_id: noteId } })
  const form = new FormData()
  form.append('file', item.file)
  if (noteId) form.append('note_id', String(noteId))
  return api<{ files: PlanningFile[] }>(`/api/planning/${planningId}/files`, { method: 'POST', body: form })
}

// focusId: buka detail planning ini saat halaman dibuka (dari notifikasi atau meeting)
export function PlanningPage({ user, focusId, onOpenMeeting }: { user: UserProfile; focusId?: number | null; onOpenMeeting: (id: number) => void }) {
  const viewAll = has(user, PERMISSIONS.planningViewAll)
  const [divisions, setDivisions] = useState<Division[]>([])
  const [items, setItems] = useState<Planning[]>([])
  const [summary, setSummary] = useState<Summary>({ total: 0, belum_mulai: 0, berjalan: 0, selesai: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [division, setDivision] = useState(viewAll ? '' : String(user.division.id))
  const [status, setStatus] = useState('')
  const [mine, setMine] = useState('')
  const [q, setQ] = useState('')
  const [form, setForm] = useState<Planning | 'new' | null>(null)
  useQuickAction('buat-planning', () => setForm('new'))
  const [detailId, setDetailId] = useState<number | null>(focusId ?? null)

  useEffect(() => {
    if (focusId) setDetailId(focusId)
  }, [focusId])

  useEffect(() => {
    api<{ items: Division[] }>('/api/divisions').then((res) => setDivisions(res.items)).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (division) params.set('division', division)
      if (status) params.set('status', status)
      if (mine) params.set('mine', '1')
      if (q.trim()) params.set('q', q.trim())
      const res = await api<{ items: Planning[]; summary: Summary }>(`/api/planning?${params}`)
      setItems(res.items)
      setSummary(res.summary)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [division, status, mine, q])

  useEffect(() => {
    const timer = setTimeout(load, q ? 300 : 0)
    return () => clearTimeout(timer)
  }, [load, q])

  const flash = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 4000)
  }

  const divisionOptions = viewAll ? divisions : divisions.filter((d) => d.id === user.division.id)
  const stats: [string, number, string, string][] = [
    ['Total planning', summary.total, viewAll && !division ? 'Semua divisi' : divisions.find((d) => String(d.id) === division)?.name ?? user.division.name, 'stat-1'],
    ['Belum mulai', summary.belum_mulai, 'Menunggu dikerjakan', 'stat-2'],
    ['Sedang berjalan', summary.berjalan, 'Dalam pengerjaan', 'stat-0'],
    ['Selesai', summary.selesai, 'Progress 100%', 'stat-0'],
  ]

  const paged = usePaged(items, items.length)
  return (
    <>
      <div className="pap-page-heading">
        <div>
          <p className="pap-eyebrow">KOLABORASI</p>
          <h1>Planning</h1>
          <span>Rencana kerja per divisi yang dibuat lead, beserta monitoring progress.</span>
        </div>
        {has(user, PERMISSIONS.planningCreate) && <button className="pap-primary-button" onClick={() => setForm('new')}><Plus /> Buat planning</button>}
      </div>
      {message && <Notice kind="success" onClose={() => setMessage('')}>{message}</Notice>}
      <div className="pap-stat-grid four">
        {stats.map(([label, value, note, tone]) => (
          <div className="pap-stat-card" key={label}>
            <div><span>{label}</span><strong>{value}</strong><small className="neutral">{note}</small></div>
            <div className={`pap-stat-icon ${tone}`}>{label === 'Belum mulai' ? <Clock3 /> : label === 'Total planning' ? <ClipboardList /> : <CheckCircle2 />}</div>
          </div>
        ))}
      </div>
      <div className="pap-table-card">
        <div className="pap-card-head">
          <div>
            <h2>Daftar planning</h2>
            <p>{viewAll ? 'Anda dapat melihat planning semua divisi' : `Menampilkan planning divisi ${user.division.name}`}</p>
          </div>
        </div>
        <div className="pap-filters">
          <label className="pap-filter-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari judul atau nomor..." /></label>
          <select className="pap-select" value={division} onChange={(e) => setDivision(e.target.value)} disabled={!viewAll} aria-label="Filter divisi">
            {viewAll && <option value="">Semua divisi</option>}
            {divisionOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select className="pap-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter status">
            <option value="">Semua status</option>
            {Object.entries(PLANNING_STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <select className="pap-select" value={mine} onChange={(e) => setMine(e.target.value)} aria-label="Filter PIC">
            <option value="">Semua planning</option>
            <option value="mine">PIC saya</option>
          </select>
        </div>
        {error && <div className="pap-card-notice"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <div className="pap-table-wrap">
          <table>
            <thead><tr><th>Nomor / Judul</th><th>Divisi</th><th>Periode</th><th>Progress</th><th>Status</th><th className="pap-actions-col">Aksi</th></tr></thead>
            <tbody>
              {paged.items.map((item) => (
                <tr key={item.id} className="pap-row-link" onClick={() => setDetailId(item.id)}>
                  <td>
                    <div className="pap-cell-title">{item.judul}</div>
                    <div className="pap-cell-sub">{item.nomor} · oleh {item.created_by_name}{item.meeting_nomor ? <> · <CalendarDays className="pap-inline-icon" />{item.meeting_nomor}</> : null}{item.file_count ? <> · <Paperclip className="pap-inline-icon" />{item.file_count}</> : null}{item.is_pic && <span className="pap-chip">PIC</span>}</div>
                  </td>
                  <td>{item.division_name}</td>
                  <td className="pap-nowrap">{formatDate(item.tanggal_mulai)} – {formatDate(item.tanggal_selesai)}</td>
                  <td><Progress value={item.progress} /></td>
                  <td><StatusBadge value={item.status} /></td>
                  <td className="pap-actions-cell"><RowActions label={item.judul} onView={() => setDetailId(item.id)} onEdit={item.can.edit ? () => setForm(item) : undefined} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !items.length && <div className="pap-empty">Belum ada planning{q || status || mine ? ' yang cocok dengan filter' : ''}.</div>}
          {loading && !items.length && <div className="pap-empty">Memuat planning...</div>}
        </div>
        <Pager {...paged.pager} noun="planning" />
      </div>

      {form && (
        <PlanningForm
          user={user}
          initial={form === 'new' ? null : form}
          onClose={() => setForm(null)}
          onSaved={(text, id) => {
            setForm(null)
            flash(text)
            load()
            if (id) setDetailId(id)
          }}
        />
      )}
      {detailId && (
        <PlanningDetail
          id={detailId}
          onOpenMeeting={onOpenMeeting}
          onClose={() => setDetailId(null)}
          onChanged={load}
          onEdit={(item) => { setDetailId(null); setForm(item) }}
          onDeleted={() => { setDetailId(null); flash('Planning dihapus.'); load() }}
        />
      )}
    </>
  )
}

export type MeetingSource = { id: number; nomor: string; judul: string; hasil: string | null; participantIds: number[] }

// Dipakai di menu Planning dan dari detail meeting (meeting terisi = planning hasil meeting)
export function PlanningForm({ user, initial = null, meeting, onClose, onSaved }: { user: UserProfile; initial?: Planning | null; meeting?: MeetingSource; onClose: () => void; onSaved: (message: string, id?: number) => void }) {
  const viewAll = has(user, PERMISSIONS.planningViewAll)
  const today = new Date().toISOString().slice(0, 10)
  const [divisions, setDivisions] = useState<Division[]>([])
  const [users, setUsers] = useState<UserOption[]>([])
  // Pembuat tidak otomatis menjadi PIC; planning baru dimulai tanpa PIC terpilih
  const [pics, setPics] = useState<Set<number>>(new Set(initial?.pic_ids ?? []))
  const [values, setValues] = useState({
    judul: initial?.judul ?? '',
    division_id: String(initial?.division_id ?? user.division.id),
    tanggal_mulai: initial?.tanggal_mulai ?? today,
    tanggal_selesai: initial?.tanggal_selesai ?? today,
    deskripsi: initial?.deskripsi ?? (meeting?.hasil ? `Tindak lanjut meeting ${meeting.nomor}:\n${meeting.hasil}` : ''),
  })
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (key: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }))

  useEffect(() => {
    api<{ items: Division[] }>('/api/divisions').then((res) => setDivisions(viewAll ? res.items : res.items.filter((d) => d.id === user.division.id))).catch(() => {})
    api<{ items: UserOption[] }>('/api/users/options').then((res) => setUsers(res.items)).catch((e) => setError(e.message))
  }, [viewAll, user.division.id])

  // Peserta meeting yang ikut menjadi PIC (pembuat tetap terkunci)
  const meetingParticipants = meeting?.participantIds.filter((id) => users.some((u) => u.id === id)) ?? []

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!pics.size) return setError('Pilih minimal satu person in charge (PIC).')
    setSaving(true)
    setError('')
    try {
      const payload = { ...values, division_id: Number(values.division_id), pic_ids: [...pics], meeting_id: meeting?.id }
      if (initial) {
        await api(`/api/planning/${initial.id}`, { method: 'PATCH', json: payload })
        onSaved('Planning diperbarui.')
        return
      }
      const res = await api<{ item: Planning }>('/api/planning', { method: 'POST', json: payload })
      const failed: string[] = []
      for (const item of attachments) {
        try {
          await uploadAttachment(res.item.id, item)
        } catch (err) {
          failed.push((err as Error).message)
        }
      }
      onSaved(failed.length ? `Planning dibuat, tetapi ${failed.length} lampiran gagal: ${failed.join(' ')}` : 'Planning dibuat.', res.item.id)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      wide
      title={initial ? 'Edit planning' : meeting ? 'Buat planning dari meeting' : 'Buat planning'}
      subtitle={initial ? initial.nomor : meeting ? `${meeting.nomor} · ${meeting.judul}` : 'Planning langsung aktif dan dapat diupdate progress-nya oleh divisi'}
      onClose={onClose}
      footer={<><button type="button" className="pap-btn" onClick={onClose}>Batal</button><button type="submit" form="planning-form" className="pap-primary-button" disabled={saving}>{saving ? 'Menyimpan...' : initial ? 'Simpan' : 'Buat planning'}</button></>}
    >
      <form id="planning-form" className="pap-form-grid" onSubmit={submit}>
        {error && <div className="full"><Notice onClose={() => setError('')}>{error}</Notice></div>}
        <Field label="Judul" full><input className="pap-input" required maxLength={200} value={values.judul} onChange={set('judul')} placeholder="Contoh: Follow up 20 calon customer sektor F&B" /></Field>
        <Field label="Divisi" hint={viewAll ? undefined : 'Planning dibuat untuk divisi Anda'}>
          <select className="pap-select" value={values.division_id} onChange={set('division_id')} disabled={!viewAll}>
            {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <div className="pap-field-pair">
          <Field label="Tanggal mulai"><input className="pap-input" type="date" required value={values.tanggal_mulai} onChange={set('tanggal_mulai')} /></Field>
          <Field label="Tanggal selesai"><input className="pap-input" type="date" required min={values.tanggal_mulai} value={values.tanggal_selesai} onChange={set('tanggal_selesai')} /></Field>
        </div>
        <Field label="Deskripsi" full><textarea className="pap-input" rows={4} maxLength={5000} value={values.deskripsi} onChange={set('deskripsi')} placeholder="Tujuan, target, dan langkah kerja" /></Field>
        <div className="full">
          <div className="pap-section-head">
            <span className="pap-field-label">Person in charge (PIC)</span>
            {meetingParticipants.length > 1 && (
              <button type="button" className="pap-link-button" onClick={() => setPics(new Set([...pics, ...meetingParticipants]))}>Pilih semua peserta meeting</button>
            )}
          </div>
          <UserPicker users={users} selected={pics} noun="PIC" onChange={setPics} />
          <small className="pap-hint">PIC dapat melihat planning ini dan mengupdate progress-nya, walaupun dari divisi lain.</small>
        </div>
        {!initial && (
          <div className="full">
            <AttachmentPicker onAdd={(item) => setAttachments((list) => [...list, item])} onError={setError} />
            {attachments.length > 0 && (
              <ul className="pap-file-list">
                {attachments.map((item, index) => (
                  <li key={index}>
                    {item.kind === 'file' ? <FileText /> : <Link2 />}
                    <div><strong>{item.kind === 'file' ? item.file.name : item.name}</strong><span>{item.kind === 'file' ? formatSize(item.file.size) : item.url}</span></div>
                    <button type="button" className="pap-icon-button" aria-label="Hapus lampiran" onClick={() => setAttachments((list) => list.filter((_, i) => i !== index))}><Trash2 /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </form>
    </Modal>
  )
}

export function AttachmentPicker({ onAdd, onError, busy, label = 'Lampiran (opsional)' }: { onAdd: (item: PendingAttachment) => void; onError: (message: string) => void; busy?: boolean; label?: string }) {
  const [linkOpen, setLinkOpen] = useState(false)
  const [link, setLink] = useState({ name: '', url: '' })
  return (
    <div className="pap-attach">
      <div className="pap-attach-actions">
        <span className="pap-attach-label">{label}</span>
        <label className={`pap-btn ${busy ? 'disabled' : ''}`}>
          <Upload /> Upload file
          <input type="file" hidden multiple disabled={busy} onChange={async (e) => {
            const list = Array.from(e.target.files ?? [])
            e.target.value = ''
            // Foto besar diperkecil otomatis; file lain > 2 MB ditolak
            const { ok, errors } = await prepareFiles(list)
            for (const file of ok) {
              const problem = validateFile(file)
              if (problem) onError(problem)
              else onAdd({ kind: 'file', file })
            }
            if (errors.length) onError(errors.join(' '))
          }} />
        </label>
        <button type="button" className="pap-btn" onClick={() => setLinkOpen((v) => !v)} disabled={busy}><Link2 /> Tambah link</button>
      </div>
      <small className="pap-hint">Semua format file, maks. 2 MB per file.</small>
      {linkOpen && (
        <div className="pap-link-row">
          <input className="pap-input" placeholder="Nama link (opsional)" value={link.name} onChange={(e) => setLink((v) => ({ ...v, name: e.target.value }))} />
          <input className="pap-input" placeholder="https://..." value={link.url} onChange={(e) => setLink((v) => ({ ...v, url: e.target.value }))} />
          <button type="button" className="pap-primary-button" onClick={() => {
            if (!/^https?:\/\/\S+$/i.test(link.url.trim())) return onError('Link harus diawali http:// atau https://')
            onAdd({ kind: 'link', name: link.name.trim(), url: link.url.trim() })
            setLink({ name: '', url: '' })
            setLinkOpen(false)
          }}>Tambah</button>
        </div>
      )}
    </div>
  )
}

// basePath: URL unduh file (planning atau meeting); canDelete boleh berupa fungsi per file
export function FileItems({ files, canDelete, busy, onDelete, basePath = '/api/planning/files' }: { files: PlanningFile[]; canDelete: boolean | ((file: PlanningFile) => boolean); busy: boolean; onDelete: (file: PlanningFile) => void; basePath?: string }) {
  return (
    <ul className="pap-file-list">
      {files.map((file) => (
        <li key={file.id}>
          {file.type === 'link' ? <Link2 /> : <FileText />}
          <div>
            <a href={file.type === 'link' ? file.url! : `${basePath}/${file.id}`} target="_blank" rel="noopener noreferrer">{file.name} <ExternalLink className="pap-inline-icon" /></a>
            <span>{file.type === 'link' ? file.url : formatSize(file.size)} · {file.uploaded_by_name}</span>
          </div>
          {(typeof canDelete === 'function' ? canDelete(file) : canDelete) && <button className="pap-icon-button" aria-label={`Hapus ${file.name}`} disabled={busy} onClick={() => window.confirm(`Hapus lampiran "${file.name}"?`) && onDelete(file)}><Trash2 /></button>}
        </li>
      ))}
    </ul>
  )
}

export function PendingItems({ items, onRemove }: { items: PendingAttachment[]; onRemove: (index: number) => void }) {
  if (!items.length) return null
  return (
    <ul className="pap-file-list">
      {items.map((item, index) => (
        <li key={index}>
          {item.kind === 'file' ? <FileText /> : <Link2 />}
          <div><strong>{item.kind === 'file' ? item.file.name : item.name || item.url}</strong><span>{item.kind === 'file' ? formatSize(item.file.size) : item.url}</span></div>
          <button type="button" className="pap-icon-button" aria-label="Hapus lampiran" onClick={() => onRemove(index)}><Trash2 /></button>
        </li>
      ))}
    </ul>
  )
}

function NoteCard({ note, planningId, busy, run, onError }: { note: ProgressNote; planningId: number; busy: boolean; run: (action: () => Promise<unknown>) => Promise<void>; onError: (message: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(note.catatan ?? '')
  const edited = note.updated_at !== note.created_at
  return (
    <li className="pap-note-item">
      <div className="pap-note-head">
        <span className="pap-note-progress">{note.progress}%</span>
        <StatusBadge value={note.status} />
        <span className="pap-note-meta"><strong>{note.created_by_name}</strong> · {formatDate(note.created_at, true)}{edited && ' · diedit'}</span>
        {note.can.edit && !editing && (
          <span className="pap-note-actions">
            <button className="pap-icon-button" aria-label="Edit catatan" disabled={busy} onClick={() => { setText(note.catatan ?? ''); setEditing(true) }}><Pencil /></button>
            <button className="pap-icon-button danger" aria-label="Hapus catatan" disabled={busy} onClick={() => window.confirm('Hapus catatan progress ini beserta lampirannya?') && run(() => api(`/api/planning/notes/${note.id}`, { method: 'DELETE' }))}><Trash2 /></button>
          </span>
        )}
      </div>
      {editing ? (
        <div className="pap-note-edit">
          <textarea className="pap-input" rows={3} maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Catatan progress" autoFocus />
          <AttachmentPicker label="Tambah lampiran ke catatan" busy={busy} onError={onError} onAdd={(attachment) => run(() => uploadAttachment(planningId, attachment, note.id))} />
          <div className="pap-inline-actions">
            <button className="pap-btn" onClick={() => setEditing(false)}>Selesai</button>
            <button className="pap-primary-button" disabled={busy || text === (note.catatan ?? '')} onClick={() => run(async () => { await api(`/api/planning/notes/${note.id}`, { method: 'PATCH', json: { catatan: text } }); setEditing(false) })}>Simpan catatan</button>
          </div>
        </div>
      ) : (
        note.catatan && <p className="pap-prewrap">{note.catatan}</p>
      )}
      {note.files.length > 0 && <FileItems files={note.files} canDelete={note.can.edit} busy={busy} onDelete={(file) => run(() => api(`/api/planning/files/${file.id}`, { method: 'DELETE' }))} />}
    </li>
  )
}

function PlanningDetail({ id, onOpenMeeting, onClose, onChanged, onEdit, onDeleted }: { id: number; onOpenMeeting: (id: number) => void; onClose: () => void; onChanged: () => void; onEdit: (item: Planning) => void; onDeleted: () => void }) {
  const [item, setItem] = useState<Planning | null>(null)
  const [files, setFiles] = useState<PlanningFile[]>([])
  const [notes, setNotes] = useState<ProgressNote[]>([])
  const [pics, setPics] = useState<Pic[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState<PlanningStatus>('belum_mulai')
  const [catatan, setCatatan] = useState('')
  const [pending, setPending] = useState<PendingAttachment[]>([])

  const load = useCallback(async () => {
    try {
      const res = await api<{ item: Planning; files: PlanningFile[]; notes: ProgressNote[]; pics: Pic[] }>(`/api/planning/${id}`)
      setItem(res.item)
      setFiles(res.files)
      setNotes(res.notes)
      setPics(res.pics)
      setProgress(res.item.progress)
      setStatus(res.item.status)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [id])
  useEffect(() => { load() }, [load])

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    try {
      await action()
      await load()
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Status ikut menyesuaikan progress, tetap bisa diubah manual
  function changeProgress(value: number) {
    const next = Math.max(0, Math.min(100, value))
    setProgress(next)
    setStatus((current) => (next >= 100 ? 'selesai' : next > 0 && (current === 'belum_mulai' || current === 'selesai') ? 'berjalan' : next === 0 && current === 'berjalan' ? 'belum_mulai' : current))
  }

  function saveProgress() {
    if (!item) return
    const form = new FormData()
    form.append('progress', String(progress))
    form.append('status', status)
    form.append('catatan', catatan)
    form.append('links', JSON.stringify(pending.filter((p) => p.kind === 'link').map((p) => (p.kind === 'link' ? { name: p.name, url: p.url } : null))))
    for (const p of pending) if (p.kind === 'file') form.append('files', p.file)
    return run(async () => {
      await api(`/api/planning/${item.id}/progress`, { method: 'POST', body: form })
      setCatatan('')
      setPending([])
    })
  }

  const progressChanged = !!item && (progress !== item.progress || status !== item.status)
  const hasNote = !!catatan.trim() || pending.length > 0
  const overdue = useMemo(() => item && item.status !== 'selesai' && item.tanggal_selesai < new Date().toISOString().slice(0, 10), [item])

  if (!item) return <Modal title="Detail planning" onClose={onClose}>{error ? <Notice>{error}</Notice> : <p className="pap-muted">Memuat...</p>}</Modal>

  return (
    <Modal
      wide
      title={item.judul}
      subtitle={`${item.nomor} · ${item.division_name}`}
      onClose={onClose}
      footer={!(item.can.delete || item.can.edit) ? undefined : (
        <>
          {item.can.delete && <button className="pap-btn danger" disabled={busy} onClick={() => window.confirm(`Hapus planning "${item.judul}"?`) && run(async () => { await api(`/api/planning/${item.id}`, { method: 'DELETE' }); onDeleted() })}><Trash2 /> Hapus</button>}
          <span className="pap-spacer" />
          {item.can.edit && <button className="pap-btn" onClick={() => onEdit(item)}><Pencil /> Edit</button>}
        </>
      )}
    >
      {error && <Notice onClose={() => setError('')}>{error}</Notice>}
      <div className="pap-detail-badges"><StatusBadge value={item.status} />{item.is_pic && <span className="pap-status info">Anda PIC</span>}{overdue && <span className="pap-status danger">Lewat tenggat</span>}</div>
      <dl className="pap-detail-grid">
        <div><dt>Periode</dt><dd>{formatDate(item.tanggal_mulai)} – {formatDate(item.tanggal_selesai)}</dd></div>
        <div><dt>Dibuat oleh</dt><dd>{item.created_by_name} · {formatDate(item.created_at, true)}</dd></div>
        <div><dt>Progress</dt><dd><Progress value={item.progress} /></dd></div>
        <div>
          <dt>Dari meeting</dt>
          <dd>{item.meeting_id ? <button className="pap-link-button" onClick={() => onOpenMeeting(item.meeting_id!)}><CalendarDays className="pap-inline-icon" /> {item.meeting_nomor} · {item.meeting_judul}</button> : <span className="pap-muted">—</span>}</dd>
        </div>
      </dl>
      <section className="pap-detail-section">
        <h3>Person in charge ({pics.length})</h3>
        <div className="pap-participants">
          {pics.map((p) => <span key={p.id} className="pap-participant"><strong>{p.name}{p.id === item.created_by && <small className="pap-hint-inline"> · pembuat</small>}</strong><small>{p.division_name}</small></span>)}
        </div>
      </section>
      <section className="pap-detail-section">
        <h3>Deskripsi</h3>
        <p className="pap-prewrap">{item.deskripsi || <span className="pap-muted">Tidak ada deskripsi.</span>}</p>
      </section>
      <section className="pap-detail-section">
        <h3>Lampiran ({files.length})</h3>
        {files.length > 0 ? (
          <FileItems files={files} canDelete={item.can.attach} busy={busy} onDelete={(file) => run(() => api(`/api/planning/files/${file.id}`, { method: 'DELETE' }))} />
        ) : <p className="pap-muted">Belum ada lampiran.</p>}
        {item.can.attach && <AttachmentPicker busy={busy} onError={setError} onAdd={(attachment) => run(() => uploadAttachment(item.id, attachment))} />}
      </section>
      <section className="pap-detail-section">
        <h3>Catatan progress ({notes.length})</h3>
        {notes.length > 0 ? (
          <ul className="pap-note-list">
            {notes.map((note) => <NoteCard key={`${note.id}-${note.updated_at}`} note={note} planningId={item.id} busy={busy} run={run} onError={setError} />)}
          </ul>
        ) : <p className="pap-muted">Belum ada catatan progress.</p>}
      </section>
      {item.can.progress && (
        <section className="pap-detail-section pap-progress-update">
          <h3>Update progress</h3>
          <div className="pap-progress-editor">
            <input type="range" min={0} max={100} step={5} value={progress} onChange={(e) => changeProgress(Number(e.target.value))} aria-label="Progress" />
            <input className="pap-input pap-progress-number" type="number" min={0} max={100} value={progress} onChange={(e) => changeProgress(Number(e.target.value) || 0)} aria-label="Progress persen" />
            <select className="pap-select" value={status} onChange={(e) => setStatus(e.target.value as PlanningStatus)} aria-label="Status">
              {Object.entries(PLANNING_STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </div>
          <label className="pap-field pap-progress-note">
            <span>Catatan progress (opsional)</span>
            <textarea className="pap-input" rows={3} maxLength={5000} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Apa yang sudah dikerjakan, kendala, atau rencana berikutnya" />
          </label>
          <AttachmentPicker label="Lampiran catatan (opsional)" busy={busy} onError={setError} onAdd={(attachment) => setPending((list) => [...list, attachment])} />
          <PendingItems items={pending} onRemove={(index) => setPending((list) => list.filter((_, i) => i !== index))} />
          <div className="pap-inline-actions pap-progress-submit">
            <small className="pap-hint">Tanggal &amp; waktu catatan dicatat otomatis.</small>
            <button className="pap-primary-button" disabled={busy || (!progressChanged && !hasNote)} onClick={saveProgress}>{hasNote ? 'Simpan progress & catatan' : 'Simpan progress'}</button>
          </div>
        </section>
      )}
    </Modal>
  )
}
