import type { ResultSetHeader } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { PERMISSIONS, PLANNING_STATUS } from '@/lib/permissions'
import { loadMeeting } from '@/lib/meeting'
import { assertDivision, canViewAllDivisions, notifyPics, parseDate, PLANNING_SELECT, serializePlanning, validPics, type PlanningRow } from '@/lib/planning'

// Daftar planning sesuai cakupan divisi user + ringkasan
export const GET = handle(async (request: Request) => {
  const user = await requireUser(PERMISSIONS.planningView)
  const params = new URL(request.url).searchParams
  const where: string[] = []
  const args: unknown[] = []

  const division = int(params.get('division'))
  const isPicOf = 'EXISTS (SELECT 1 FROM planning_pics x WHERE x.planning_id = p.id AND x.user_id = ?)'
  if (!canViewAllDivisions(user)) {
    // Divisi sendiri + planning divisi lain yang menjadikan user sebagai PIC
    where.push(`(p.division_id = ? OR ${isPicOf})`)
    args.push(user.division.id, user.id)
  } else if (division) {
    where.push('p.division_id = ?')
    args.push(division)
  }
  if (params.get('mine') === '1') where.push(isPicOf), args.push(user.id)
  const meeting = int(params.get('meeting'))
  if (meeting) where.push('p.meeting_id = ?'), args.push(meeting)
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

// Buat planning (lead/admin); langsung aktif tanpa approval.
// meeting_id opsional (planning hasil meeting), pic_ids = PIC tambahan (pembuat otomatis PIC)
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
  const meeting = body.meeting_id ? await loadMeeting(user, Number(body.meeting_id)) : null
  const pics = await validPics(body.pic_ids, user.id)

  const conn = await db.getConnection()
  let id = 0
  try {
    await conn.beginTransaction()
    const [result] = await conn.query<ResultSetHeader>(
      "INSERT INTO plannings (division_id, meeting_id, judul, deskripsi, tanggal_mulai, tanggal_selesai, approval, created_by) VALUES (?, ?, ?, ?, ?, ?, 'disetujui', ?)",
      [divisionId, meeting?.id ?? null, judul, str(body.deskripsi, 5000) || null, mulai, selesai, user.id],
    )
    id = result.insertId
    await conn.query("UPDATE plannings SET nomor = CONCAT('PLN-', DATE_FORMAT(created_at, '%Y%m'), '-', LPAD(id, 4, '0')) WHERE id = ?", [id])
    await conn.query('INSERT INTO planning_pics (planning_id, user_id) VALUES ?', [pics.map((userId) => [id, userId])])
    await notifyPics(conn, pics.filter((userId) => userId !== user.id), { id, judul, mulai, selesai, meetingJudul: meeting?.judul }, user.name)
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
  const [rows] = await db.query<PlanningRow[]>(`${PLANNING_SELECT} WHERE p.id = ?`, [id])
  return NextResponse.json({ item: serializePlanning(user, rows[0]) }, { status: 201 })
})
