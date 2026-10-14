import type { RowDataPacket } from 'mysql2'
import { fail } from '@/lib/api'
import { db } from '@/lib/db'
import { PERMISSIONS, type PlanningStatus } from '@/lib/permissions'
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
  (SELECT COUNT(*) FROM planning_files f WHERE f.planning_id = p.id) AS file_count
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
     FROM planning_files f JOIN users u ON u.id = f.uploaded_by WHERE f.planning_id = ? ORDER BY f.id`,
    [planningId],
  )
  return rows
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
