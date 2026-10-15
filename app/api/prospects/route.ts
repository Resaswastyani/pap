import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import {
  canSupervise, isMarketing, logActivity, MARKETING_DIVISIONS, parseDateTime, PROSPECT_SELECT, PROSPECT_SOURCES, PROSPECT_STATUS,
  prospectScope, readProspectInput, requireMarketing, requireMarketingUser,
} from '@/lib/marketing'
import { notify } from '@/lib/notifications'
import { pushToUsers } from '@/lib/push'

const PAGE_SIZE = 50

// Daftar prospek + ringkasan funnel. Staff hanya melihat prospek miliknya.
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireMarketing(user, 'prospek')
  const url = new URL(request.url)
  const scope = prospectScope(user)
  const where = [scope.sql]
  const params: (string | number)[] = [...scope.params]

  const q = str(url.searchParams.get('q'), 100)
  if (q) {
    where.push('(p.nama_usaha LIKE ? OR p.kontak_nama LIKE ? OR p.telepon LIKE ? OR p.kota LIKE ? OR p.kebutuhan LIKE ?)')
    params.push(...Array(5).fill(`%${q}%`))
  }
  const sumber = str(url.searchParams.get('sumber'), 60)
  if (sumber) {
    where.push('p.sumber = ?')
    params.push(sumber)
  }
  const owner = url.searchParams.get('owner')
  if (owner === 'me') {
    where.push('(p.assigned_to = ? OR p.maintenance_to = ?)')
    params.push(user.id, user.id)
  } else if (owner === 'none') {
    where.push('p.assigned_to IS NULL')
  } else if (int(owner)) {
    where.push('(p.assigned_to = ? OR p.maintenance_to = ?)')
    params.push(int(owner)!, int(owner)!)
  }
  const followup = url.searchParams.get('followup')
  if (followup === 'overdue') where.push("p.next_followup_at < CURDATE() AND p.status NOT IN ('gagal')")
  else if (followup === 'today') where.push("DATE(p.next_followup_at) = CURDATE() AND p.status NOT IN ('gagal')")

  // Ringkasan funnel memakai filter yang sama kecuali status
  const [summaryRows] = await db.query<(RowDataPacket & { status: string; n: number })[]>(
    `SELECT p.status, COUNT(*) AS n FROM prospects p WHERE ${where.join(' AND ')} GROUP BY p.status`,
    params,
  )
  const [[due]] = await db.query<(RowDataPacket & { overdue: number; today: number })[]>(
    `SELECT COALESCE(SUM(p.next_followup_at < CURDATE()), 0) AS overdue, COALESCE(SUM(DATE(p.next_followup_at) = CURDATE()), 0) AS today
     FROM prospects p WHERE ${scope.sql} AND p.status <> 'gagal'`,
    scope.params,
  )

  const status = url.searchParams.get('status')
  if (status && status in PROSPECT_STATUS) {
    where.push('p.status = ?')
    params.push(status)
  } else if (status === 'aktif') {
    where.push("p.status NOT IN ('handover', 'gagal')")
  }
  const view = url.searchParams.get('view')
  const page = Math.max(1, int(url.searchParams.get('page')) ?? 1)
  // Tampilan kanban butuh semua kartu aktif sekaligus (dibatasi 600)
  const limit = view === 'kanban' ? 600 : PAGE_SIZE
  const offset = view === 'kanban' ? 0 : (page - 1) * PAGE_SIZE
  const [[{ total }]] = await db.query<(RowDataPacket & { total: number })[]>(`SELECT COUNT(*) AS total FROM prospects p WHERE ${where.join(' AND ')}`, params)
  const [items] = await db.query<RowDataPacket[]>(
    `${PROSPECT_SELECT} WHERE ${where.join(' AND ')}
     ORDER BY (p.next_followup_at IS NULL), p.next_followup_at, p.updated_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  )
  const [users] = await db.query<RowDataPacket[]>(
    `SELECT u.id, u.name, d.code AS division_code, d.name AS division_name FROM users u JOIN divisions d ON d.id = u.division_id
     WHERE u.is_active = 1 AND d.code IN (?) ORDER BY d.sort_order, u.name`,
    [[...MARKETING_DIVISIONS, 'general_manager']],
  )
  return NextResponse.json({
    items: items.map((p) => ({ ...p, activity_count: Number(p.activity_count) })),
    total: Number(total),
    pageSize: PAGE_SIZE,
    summary: Object.fromEntries(summaryRows.map((r) => [r.status, Number(r.n)])),
    due: { overdue: Number(due.overdue), today: Number(due.today) },
    users,
    sources: PROSPECT_SOURCES,
    canSupervise: canSupervise(user),
  })
})

// Tambah prospek. Marketing Development otomatis menjadi sales-nya bila tidak dipilih.
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireMarketing(user, 'prospek')
  const body = await readJson(request)
  const input = readProspectInput(body)
  if (input.telepon && !body.force) {
    const [dup] = await db.query<(RowDataPacket & { nama_usaha: string })[]>('SELECT nama_usaha FROM prospects WHERE telepon = ? LIMIT 1', [input.telepon])
    if (dup.length) fail(409, `Nomor ${input.telepon} sudah terdaftar sebagai prospek "${dup[0].nama_usaha}".`)
  }
  let assigned = canSupervise(user) ? (await requireMarketingUser(body.assigned_to, 'Sales'))?.id ?? null : null
  if (!assigned && isMarketing(user) && user.division.code !== 'marketing_digital') assigned = user.id
  const nextFollowup = parseDateTime(body.next_followup_at, 'Jadwal follow-up')

  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO prospects (nama_usaha, sektor, kontak_nama, kontak_jabatan, telepon, email, alamat, kota, sumber, kebutuhan, estimasi_order, catatan,
       assigned_to, next_followup_at, created_by, last_activity_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [input.nama_usaha, input.sektor, input.kontak_nama, input.kontak_jabatan, input.telepon, input.email, input.alamat, input.kota, input.sumber,
      input.kebutuhan, input.estimasi_order, input.catatan, assigned, nextFollowup, user.id],
  )
  const id = result.insertId
  await logActivity(db, { prospectId: id, userId: user.id, jenis: 'status', hasil: `Prospek dibuat oleh ${user.name}${input.sumber ? ` (sumber: ${input.sumber})` : ''}`, statusTo: 'baru' })
  if (assigned && assigned !== user.id) {
    await pushToUsers(await notify([assigned], {
      type: 'prospek_baru',
      title: `Prospek baru untuk Anda: ${input.nama_usaha}`,
      body: [input.kontak_nama, input.kota, input.kebutuhan].filter(Boolean).join(' · ') || `Dari ${user.name}`,
      prospectId: id,
      refKey: `prospek:${id}:${assigned}`,
    }))
  }
  return NextResponse.json({ id }, { status: 201 })
})
