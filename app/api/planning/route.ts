import type { ResultSetHeader } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { PERMISSIONS, PLANNING_STATUS } from '@/lib/permissions'
import { assertDivision, canViewAllDivisions, parseDate, PLANNING_SELECT, serializePlanning, type PlanningRow } from '@/lib/planning'

// Daftar planning sesuai cakupan divisi user + ringkasan
export const GET = handle(async (request: Request) => {
  const user = await requireUser(PERMISSIONS.planningView)
  const params = new URL(request.url).searchParams
  const where: string[] = []
  const args: unknown[] = []

  const division = int(params.get('division'))
  if (!canViewAllDivisions(user)) {
    where.push('p.division_id = ?')
    args.push(user.division.id)
  } else if (division) {
    where.push('p.division_id = ?')
    args.push(division)
  }
  const status = params.get('status')
  if (status && status in PLANNING_STATUS) {
    where.push('p.status = ?')
    args.push(status)
  }
  const q = str(params.get('q'), 100)
  if (q) {
    where.push('(p.judul LIKE ? OR p.nomor LIKE ? OR p.deskripsi LIKE ?)')
    args.push(`%${q}%`, `%${q}%`, `%${q}%`)
  }

  const [rows] = await db.query<PlanningRow[]>(
    `${PLANNING_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.tanggal_mulai DESC, p.id DESC LIMIT 500`,
    args,
  )
  const items = rows.map((row) => serializePlanning(user, row))
  const summary = {
    total: items.length,
    belum_mulai: items.filter((item) => item.status === 'belum_mulai').length,
    berjalan: items.filter((item) => item.status === 'berjalan').length,
    selesai: items.filter((item) => item.status === 'selesai').length,
  }
  return NextResponse.json({ items, summary })
})

// Buat planning (lead/admin); langsung aktif tanpa approval
export const POST = handle(async (request: Request) => {
  const user = await requireUser(PERMISSIONS.planningCreate)
  const body = await readJson(request)
  const judul = str(body.judul, 200)
  if (!judul) fail(400, 'Judul wajib diisi.')
  const mulai = parseDate(body.tanggal_mulai, 'Tanggal mulai')
  const selesai = parseDate(body.tanggal_selesai, 'Tanggal selesai')
  if (selesai < mulai) fail(400, 'Tanggal selesai tidak boleh sebelum tanggal mulai.')
  // Hanya admin/super admin yang boleh membuat untuk divisi lain
  const divisionId = canViewAllDivisions(user) && body.division_id ? await assertDivision(body.division_id) : user.division.id

  const [result] = await db.query<ResultSetHeader>(
    "INSERT INTO plannings (division_id, judul, deskripsi, tanggal_mulai, tanggal_selesai, approval, created_by) VALUES (?, ?, ?, ?, ?, 'disetujui', ?)",
    [divisionId, judul, str(body.deskripsi, 5000) || null, mulai, selesai, user.id],
  )
  await db.query("UPDATE plannings SET nomor = CONCAT('PLN-', DATE_FORMAT(created_at, '%Y%m'), '-', LPAD(id, 4, '0')) WHERE id = ?", [result.insertId])
  const [rows] = await db.query<PlanningRow[]>(`${PLANNING_SELECT} WHERE p.id = ?`, [result.insertId])
  return NextResponse.json({ item: serializePlanning(user, rows[0]) }, { status: 201 })
})
