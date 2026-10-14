import type { RowDataPacket } from 'mysql2'
import { fail } from '@/lib/api'
import { db } from '@/lib/db'
import { FILE_ACCEPT, FILE_MAX_BYTES, PERMISSIONS, type PlanningStatus } from '@/lib/permissions'
import { can, type UserProfile } from '@/lib/users'

export type PlanningRow = RowDataPacket & {
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
  created_by: number
  created_by_name: string
  created_at: string
  updated_at: string
  file_count: number
}

export const PLANNING_SELECT = `SELECT p.id, p.nomor, p.division_id, d.name AS division_name, p.judul, p.deskripsi,
  p.tanggal_mulai, p.tanggal_selesai, p.status, p.progress, p.created_by, cr.name AS created_by_name,
  p.created_at, p.updated_at,
  (SELECT COUNT(*) FROM planning_files f WHERE f.planning_id = p.id AND f.note_id IS NULL) AS file_count
  FROM plannings p
  JOIN divisions d ON d.id = p.division_id
  JOIN users cr ON cr.id = p.created_by`

export const canViewAllDivisions = (user: UserProfile) => can(user, PERMISSIONS.planningViewAll)

export const inScope = (user: UserProfile, divisionId: number) => canViewAllDivisions(user) || divisionId === user.division.id

// Hak aksi user terhadap satu planning (dipakai API & dikirim ke UI)
// Planning dibuat lead tanpa approval; staff divisi hanya update progress
export function planningAbilities(user: UserProfile, row: Pick<PlanningRow, 'division_id' | 'created_by'>) {
  const scoped = inScope(user, row.division_id)
  const edit = scoped && (can(user, PERMISSIONS.planningManage) || (row.created_by === user.id && can(user, PERMISSIONS.planningCreate)))
  const progress = edit || (scoped && can(user, PERMISSIONS.planningUpdateProgress))
  return { edit, delete: edit, progress, attach: progress }
}

export function serializePlanning(user: UserProfile, row: PlanningRow) {
  return { ...row, file_count: Number(row.file_count), can: planningAbilities(user, row) }
}

export async function loadPlanning(user: UserProfile, id: number) {
  const [rows] = await db.query<PlanningRow[]>(`${PLANNING_SELECT} WHERE p.id = ? LIMIT 1`, [id])
  const row = rows[0]
  if (!row || !inScope(user, row.division_id)) fail(404, 'Planning tidak ditemukan.')
  return row as PlanningRow
}

export async function loadFiles(planningId: number) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT f.id, f.type, f.name, f.url, f.mime, f.size, f.uploaded_by, u.name AS uploaded_by_name, f.created_at
     FROM planning_files f JOIN users u ON u.id = f.uploaded_by WHERE f.planning_id = ? AND f.note_id IS NULL ORDER BY f.id`,
    [planningId],
  )
  return rows
}

export type NoteRow = RowDataPacket & { id: number; planning_id: number; progress: number; status: PlanningStatus; catatan: string | null; created_by: number; created_by_name: string; created_at: string; updated_at: string }

// Catatan progress: penulis bisa edit/hapus catatannya; lead/admin (hak edit planning) bisa semua
export function noteAbilities(user: UserProfile, planning: Pick<PlanningRow, 'division_id' | 'created_by'>, note: Pick<NoteRow, 'created_by'>) {
  const ability = planningAbilities(user, planning)
  const edit = ability.edit || (ability.progress && note.created_by === user.id)
  return { edit, delete: edit }
}

export async function loadNotes(user: UserProfile, planning: PlanningRow) {
  const [notes] = await db.query<NoteRow[]>(
    `SELECT n.id, n.planning_id, n.progress, n.status, n.catatan, n.created_by, u.name AS created_by_name, n.created_at, n.updated_at
     FROM planning_progress_notes n JOIN users u ON u.id = n.created_by WHERE n.planning_id = ? ORDER BY n.created_at DESC, n.id DESC`,
    [planning.id],
  )
  const [files] = await db.query<RowDataPacket[]>(
    `SELECT f.id, f.note_id, f.type, f.name, f.url, f.mime, f.size, f.uploaded_by, u.name AS uploaded_by_name, f.created_at
     FROM planning_files f JOIN users u ON u.id = f.uploaded_by WHERE f.planning_id = ? AND f.note_id IS NOT NULL ORDER BY f.id`,
    [planning.id],
  )
  return notes.map((note) => ({ ...note, files: files.filter((file) => file.note_id === note.id), can: noteAbilities(user, planning, note) }))
}

export async function loadNote(noteId: number) {
  const [rows] = await db.query<NoteRow[]>('SELECT id, planning_id, progress, status, catatan, created_by FROM planning_progress_notes WHERE id = ?', [noteId])
  return (rows[0] as NoteRow) ?? fail(404, 'Catatan tidak ditemukan.')
}

// Validasi lampiran (dipakai lampiran planning & catatan progress)
export function validUpload(value: unknown) {
  if (!(value instanceof File) || !value.size) return fail(400, 'File wajib dipilih.')
  if (!(value.type in FILE_ACCEPT)) fail(400, `${value.name}: format harus gambar (JPG/PNG/WEBP/GIF), PDF, atau Word.`)
  if (value.size > FILE_MAX_BYTES) fail(400, `${value.name}: ukuran maksimal 5 MB.`)
  return value
}

export function validLink(value: { name?: unknown; url?: unknown }) {
  const url = typeof value.url === 'string' ? value.url.trim().slice(0, 1000) : ''
  let parsed: URL | null = null
  try {
    parsed = new URL(url)
  } catch {}
  if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) return fail(400, 'Link harus diawali http:// atau https://')
  const name = typeof value.name === 'string' ? value.name.trim().slice(0, 255) : ''
  return { name: name || parsed.hostname, url }
}

type Queryable = { query: typeof db.query }
export async function insertAttachment(conn: Queryable, target: { planningId: number; noteId: number | null; userId: number }, item: { file: File } | { link: { name: string; url: string } }) {
  if ('file' in item) {
    await conn.query(
      "INSERT INTO planning_files (planning_id, note_id, type, name, mime, size, data, uploaded_by) VALUES (?, ?, 'file', ?, ?, ?, ?, ?)",
      [target.planningId, target.noteId, item.file.name.slice(0, 255), item.file.type, item.file.size, Buffer.from(await item.file.arrayBuffer()), target.userId],
    )
  } else {
    await conn.query("INSERT INTO planning_files (planning_id, note_id, type, name, url, uploaded_by) VALUES (?, ?, 'link', ?, ?, ?)", [
      target.planningId,
      target.noteId,
      item.link.name,
      item.link.url,
      target.userId,
    ])
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export function parseDate(value: unknown, label: string) {
  if (typeof value !== 'string' || !DATE_RE.test(value) || Number.isNaN(Date.parse(value))) fail(400, `${label} tidak valid.`)
  return value as string
}

export async function assertDivision(id: unknown) {
  const divisionId = Number(id)
  const [rows] = await db.query<RowDataPacket[]>('SELECT id FROM divisions WHERE id = ?', [divisionId])
  if (!rows.length) fail(400, 'Divisi tidak valid.')
  return divisionId
}
