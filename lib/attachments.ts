import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'
import { readLink } from '@/lib/marketing'
import { ATTACHMENT_MAX_BYTES } from '@/lib/permissions'

// Lampiran generik (file apa pun maks 2 MB, atau link):
// - prospect / sample: lampiran data Prospek & Request Sample
// - activity / request_log / stage / job: lampiran catatan (tabel note_attachments)
const OWNERS = {
  prospect: { table: 'prospect_attachments', fk: 'prospect_id', type: null },
  sample: { table: 'sample_attachments', fk: 'sample_id', type: null },
  activity: { table: 'note_attachments', fk: 'owner_id', type: 'activity' },
  request_log: { table: 'note_attachments', fk: 'owner_id', type: 'request_log' },
  stage: { table: 'note_attachments', fk: 'owner_id', type: 'stage' },
  job: { table: 'note_attachments', fk: 'owner_id', type: 'job' },
  repair: { table: 'note_attachments', fk: 'owner_id', type: 'repair' },
} as const
export type AttachmentOwner = keyof typeof OWNERS
export const NOTE_OWNERS = ['activity', 'request_log', 'stage', 'job', 'repair'] as const
export type NoteOwner = (typeof NOTE_OWNERS)[number]
export const isNoteOwner = (value: string): value is NoteOwner => (NOTE_OWNERS as readonly string[]).includes(value)

export type AttachmentRow = RowDataPacket & {
  id: number; kind: 'file' | 'link'; name: string; url: string | null; mime: string | null; size: number | null; data: Buffer | null; uploaded_by: number
}

const scope = (owner: AttachmentOwner, alias = '') => {
  const o = OWNERS[owner]
  return { table: o.table, where: `${alias}${o.fk} = ?${o.type ? ` AND ${alias}owner_type = '${o.type}'` : ''}` }
}

export function validAttachmentFile(value: unknown) {
  if (!(value instanceof File) || !value.size) return fail(400, 'File wajib dipilih.')
  if (!value.name.trim()) fail(400, 'Nama file tidak valid.')
  if (value.size > ATTACHMENT_MAX_BYTES) fail(400, `${value.name}: ukuran maksimal 2 MB.`)
  return value
}

const LIST_COLS = 'a.id, a.kind, a.name, a.url, a.mime, a.size, a.uploaded_by, a.created_at, u.name AS uploaded_by_name'

export async function listAttachments(owner: AttachmentOwner, ownerId: number) {
  const s = scope(owner, 'a.')
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${LIST_COLS} FROM ${s.table} a JOIN users u ON u.id = a.uploaded_by WHERE ${s.where} ORDER BY a.id`, [ownerId])
  return rows
}

// Tempelkan daftar lampiran ke setiap catatan (satu query untuk semua catatan)
export async function withNoteAttachments<T extends { id: number }>(owner: NoteOwner, notes: T[]) {
  if (!notes.length) return notes.map((n) => ({ ...n, attachments: [] as RowDataPacket[] }))
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT a.owner_id, ${LIST_COLS} FROM note_attachments a JOIN users u ON u.id = a.uploaded_by
     WHERE a.owner_type = ? AND a.owner_id IN (?) ORDER BY a.id`,
    [owner, notes.map((n) => n.id)],
  )
  const byNote = new Map<number, RowDataPacket[]>()
  for (const { owner_id, ...row } of rows) byNote.set(owner_id, [...(byNote.get(owner_id) ?? []), row as RowDataPacket])
  return notes.map((n) => ({ ...n, attachments: byNote.get(n.id) ?? [] }))
}

// Multipart: "file" untuk file, atau "url" (+ "name") untuk link
export async function addAttachment(owner: AttachmentOwner, ownerId: number, form: FormData, userId: number) {
  const o = OWNERS[owner]
  const cols = o.type ? 'owner_type, ' : ''
  const typeVal = o.type ? [o.type] : []
  const fileValue = form.get('file')
  if (fileValue instanceof File && fileValue.size) {
    const file = validAttachmentFile(fileValue)
    await db.query(`INSERT INTO ${o.table} (${cols}${o.fk}, kind, name, mime, size, data, uploaded_by) VALUES (${o.type ? '?, ' : ''}?, 'file', ?, ?, ?, ?, ?)`, [
      ...typeVal, ownerId, file.name.slice(0, 255), (file.type || 'application/octet-stream').slice(0, 150), file.size, Buffer.from(await file.arrayBuffer()), userId,
    ])
    return { kind: 'file' as const, name: file.name }
  }
  const link = readLink(form.get('url'), str(form.get('name'), 255) || undefined)
  await db.query(`INSERT INTO ${o.table} (${cols}${o.fk}, kind, name, url, uploaded_by) VALUES (${o.type ? '?, ' : ''}?, 'link', ?, ?, ?)`, [...typeVal, ownerId, link.name, link.url, userId])
  return { kind: 'link' as const, name: link.name }
}

export async function getAttachment(owner: AttachmentOwner, id: number) {
  const o = OWNERS[owner]
  const [[row]] = await db.query<(AttachmentRow & { owner_id: number })[]>(`SELECT *, ${o.fk} AS owner_id FROM ${o.table} WHERE id = ?`, [id])
  return row ?? fail(404, 'Lampiran tidak ditemukan.')
}

// Lampiran catatan: jenis pemiliknya dibaca dari baris lampiran
export async function getNoteAttachment(id: number) {
  const [[row]] = await db.query<(AttachmentRow & { owner_id: number; owner_type: NoteOwner })[]>('SELECT * FROM note_attachments WHERE id = ?', [id])
  return row ?? fail(404, 'Lampiran tidak ditemukan.')
}

export async function deleteAttachment(owner: AttachmentOwner, id: number) {
  await db.query(`DELETE FROM ${OWNERS[owner].table} WHERE id = ?`, [id])
}

// Hapus lampiran catatan yang catatannya sudah tidak ada (dipanggil setelah catatan/tahap dihapus)
export async function deleteNoteAttachments(owner: NoteOwner, ownerIds: number[]) {
  if (ownerIds.length) await db.query('DELETE FROM note_attachments WHERE owner_type = ? AND owner_id IN (?)', [owner, ownerIds])
}

// Gambar & PDF ditampilkan di browser; format lain selalu diunduh (aman untuk file apa pun)
export function attachmentResponse(row: AttachmentRow, download: boolean) {
  if (row.kind === 'link') return NextResponse.redirect(row.url!)
  const inline = !download && /^(image\/(jpeg|png|webp|gif)|application\/pdf)$/.test(row.mime ?? '')
  return new NextResponse(new Uint8Array(row.data!), {
    headers: {
      'Content-Type': inline ? row.mime! : 'application/octet-stream',
      'Content-Length': String(row.size ?? row.data!.length),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
