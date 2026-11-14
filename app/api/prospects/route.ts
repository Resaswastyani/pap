import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser, pageParams } from '@/lib/api'
import { db } from '@/lib/db'
import {
  applyStatusFilter, canSupervise, isMarketing, logActivity, MARKETING_DIVISIONS, parseDateTime, PROSPECT_SELECT, PROSPECT_SOURCES,
  prospectFilter, prospectScope, readProspectInput, readProspectProducts, saveProspectProducts, requireMarketing, requireMarketingUser,
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
  const { where, params } = prospectFilter(user, url.searchParams)

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

  applyStatusFilter(where, params, url.searchParams.get('status'))
  const view = url.searchParams.get('view')
  const { page, pageSize } = pageParams(url.searchParams, PAGE_SIZE)
  // Tampilan kanban butuh semua kartu aktif sekaligus (dibatasi 600)
  const limit = view === 'kanban' ? 600 : pageSize
  const offset = view === 'kanban' ? 0 : (page - 1) * pageSize
  const [[{ total }]] = await db.query<(RowDataPacket & { total: number })[]>(`SELECT COUNT(*) AS total FROM prospects p WHERE ${where.join(' AND ')}`, params)
  const [items] = await db.query<RowDataPacket[]>(
    `${PROSPECT_SELECT} WHERE ${where.join(' AND ')}
     ORDER BY (p.next_followup_at IS NULL), p.next_followup_at, p.updated_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  )
  // Pilihan filter Bidang Usaha: semua bidang usaha yang ada di prospek yang bisa dilihat user
  const [sectors] = await db.query<RowDataPacket[]>(
    `SELECT DISTINCT TRIM(p.sektor) AS sektor FROM prospects p WHERE ${scope.sql} AND TRIM(COALESCE(p.sektor, '')) <> '' ORDER BY sektor LIMIT 200`,
    scope.params,
  )
  const [users] = await db.query<RowDataPacket[]>(
    `SELECT u.id, u.name, d.code AS division_code, d.name AS division_name FROM users u JOIN divisions d ON d.id = u.division_id
     WHERE u.is_active = 1 AND d.code IN (?) ORDER BY d.sort_order, u.name`,
    [[...MARKETING_DIVISIONS, 'general_manager']],
  )
  return NextResponse.json({
    items: items.map((p) => ({ ...p, activity_count: Number(p.activity_count) })),
    total: Number(total),
    pageSize,
    summary: Object.fromEntries(summaryRows.map((r) => [r.status, Number(r.n)])),
    due: { overdue: Number(due.overdue), today: Number(due.today) },
    users,
    sources: PROSPECT_SOURCES,
    sectors: sectors.map((r) => String(r.sektor)),
    canSupervise: canSupervise(user),
  })
})

// Tambah prospek. Marketing Development otomatis menjadi sales-nya bila tidak dipilih.
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireMarketing(user, 'prospek')
  const body = await readJson(request)
  const input = readProspectInput(body)
  const products = readProspectProducts(body)
  if (products) input.kebutuhan = products.map((p) => p.label).join('; ').slice(0, 500) || null
  if (input.telepon && !body.force) {
    const [dup] = await db.query<(RowDataPacket & { nama_usaha: string })[]>('SELECT nama_usaha FROM prospects WHERE telepon = ? LIMIT 1', [input.telepon])
    if (dup.length) fail(409, `Nomor ${input.telepon} sudah terdaftar sebagai prospek "${dup[0].nama_usaha}".`)
  }
  let assigned = canSupervise(user) ? (await requireMarketingUser(body.assigned_to, 'Sales'))?.id ?? null : null
  if (!assigned && isMarketing(user) && user.division.code !== 'marketing_digital') assigned = user.id
  const nextFollowup = parseDateTime(body.next_followup_at, 'Jadwal follow-up')

  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO prospects (nama_usaha, sektor, kontak_nama, kontak_jabatan, telepon, email, alamat, kota, sumber, kebutuhan, estimasi_order, kompetitor, payment, catatan,
       assigned_to, next_followup_at, created_by, last_activity_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [input.nama_usaha, input.sektor, input.kontak_nama, input.kontak_jabatan, input.telepon, input.email, input.alamat, input.kota, input.sumber,
      input.kebutuhan, input.estimasi_order, input.kompetitor, input.payment, input.catatan, assigned, nextFollowup, user.id],
  )
  const id = result.insertId
  if (products) await saveProspectProducts(id, products)
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
