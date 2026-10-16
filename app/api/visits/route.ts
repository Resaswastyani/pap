import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import {
  canSupervise, isMarketing, loadProspect, logActivity, MARKETING_DIVISIONS, parseDateTime, PIPELINE, requireMarketing, requireMarketingUser,
  serializeVisit, VISIT_SELECT, VISIT_TYPES, visitScope, type ProspectStatus,
} from '@/lib/marketing'
import { formatWaktu, notify } from '@/lib/notifications'
import { pushToUsers } from '@/lib/push'

const DATE = /^\d{4}-\d{2}-\d{2}$/

// Jadwal visit dalam rentang tanggal. Staff melihat jadwalnya sendiri; Lead/GM semua sales.
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireMarketing(user, 'visit')
  const url = new URL(request.url)
  const from = url.searchParams.get('from') ?? ''
  const to = url.searchParams.get('to') ?? ''
  if (!DATE.test(from) || !DATE.test(to)) fail(400, 'Rentang tanggal tidak valid.')
  const scope = visitScope(user)
  const where = [scope.sql, 'v.jadwal >= ?', 'v.jadwal < ? + INTERVAL 1 DAY']
  const params: (string | number)[] = [...scope.params, from, to]
  const sales = int(url.searchParams.get('sales'))
  if (sales) {
    where.push('v.sales_id = ?')
    params.push(sales)
  }
  const status = str(url.searchParams.get('status'), 20)
  if (status) {
    where.push('v.status = ?')
    params.push(status)
  }
  const [items] = await db.query<RowDataPacket[]>(`${VISIT_SELECT} WHERE ${where.join(' AND ')} ORDER BY v.jadwal`, params)
  const [[stats]] = await db.query<(RowDataPacket & { today: number; pending: number; done_month: number; missed: number })[]>(
    `SELECT COALESCE(SUM(DATE(v.jadwal) = CURDATE() AND v.status = 'terjadwal'), 0) AS today,
       COALESCE(SUM(v.status = 'terjadwal' AND v.jadwal >= NOW()), 0) AS pending,
       COALESCE(SUM(v.status = 'selesai' AND v.jadwal >= DATE_FORMAT(CURDATE(), '%Y-%m-01')), 0) AS done_month,
       COALESCE(SUM(v.status = 'terjadwal' AND v.jadwal < NOW() - INTERVAL 1 HOUR), 0) AS missed
     FROM visits v WHERE ${scope.sql}`,
    scope.params,
  )
  const [users] = await db.query<RowDataPacket[]>(
    `SELECT u.id, u.name, d.code AS division_code, d.name AS division_name FROM users u JOIN divisions d ON d.id = u.division_id
     WHERE u.is_active = 1 AND d.code IN (?) ORDER BY d.sort_order, u.name`,
    [[...MARKETING_DIVISIONS, 'general_manager']],
  )
  return NextResponse.json({
    items: items.map(serializeVisit),
    stats: Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, Number(v)])),
    users,
    canSupervise: canSupervise(user),
  })
})

// Jadwalkan visit ke prospek atau customer. Prospek yang belum "janji temu" otomatis naik statusnya.
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireMarketing(user, 'visit')
  const body = await readJson(request)
  const jadwal = parseDateTime(body.jadwal, 'Jadwal visit', true)!
  const jenis = str(body.jenis, 20) || 'visit'
  if (!(jenis in VISIT_TYPES)) fail(400, 'Jenis visit tidak valid.')
  // Supervisor memilih sales; bila kosong, dirinya sendiri hanya jika ia orang marketing (bukan admin/IT)
  const chosen = canSupervise(user) ? (await requireMarketingUser(body.sales_id, 'Sales'))?.id ?? null : null
  const salesId = chosen ?? (isMarketing(user) || user.division.code === 'general_manager' ? user.id : fail(400, 'Pilih sales yang akan melakukan visit.'))

  let prospect: RowDataPacket | null = null
  let customer: (RowDataPacket & { id: number; name: string; bill_street: string | null; bill_city: string | null }) | null = null
  if (int(body.prospect_id)) {
    prospect = await loadProspect(int(body.prospect_id)!, user)
  } else if (int(body.customer_id)) {
    const [[row]] = await db.query<(RowDataPacket & { id: number; name: string; bill_street: string | null; bill_city: string | null })[]>(
      'SELECT id, name, bill_street, bill_city FROM customers WHERE id = ?', [int(body.customer_id)],
    )
    customer = row ?? fail(400, 'Customer tidak ditemukan.')
  } else {
    fail(400, 'Pilih prospek atau customer yang dikunjungi.')
  }
  const alamat = str(body.alamat, 500) || (prospect ? [prospect.alamat, prospect.kota] : [customer!.bill_street, customer!.bill_city]).filter(Boolean).join(', ') || null
  const tujuan = str(body.tujuan, 500) || null

  const [result] = await db.query<ResultSetHeader>(
    'INSERT INTO visits (prospect_id, customer_id, sales_id, jenis, jadwal, tujuan, alamat, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [prospect?.id ?? null, customer?.id ?? null, salesId, jenis, jadwal, tujuan, alamat, user.id],
  )
  const visitId = result.insertId
  const targetName = prospect?.nama_usaha ?? customer!.name
  if (prospect) {
    const status = prospect.status as ProspectStatus
    const advance = PIPELINE.indexOf(status) >= 0 && PIPELINE.indexOf(status) < PIPELINE.indexOf('janji_temu')
    if (advance) await db.query("UPDATE prospects SET status = 'janji_temu' WHERE id = ?", [prospect.id])
    await logActivity(db, {
      prospectId: prospect.id, visitId, userId: user.id, jenis: 'catatan',
      hasil: `${VISIT_TYPES[jenis as keyof typeof VISIT_TYPES]} dijadwalkan ${formatWaktu(jadwal)}${tujuan ? `: ${tujuan}` : ''}`,
      statusFrom: advance ? status : null, statusTo: advance ? 'janji_temu' : null,
    })
  } else {
    await logActivity(db, { customerId: customer!.id, visitId, userId: user.id, jenis: 'catatan', hasil: `Visit dijadwalkan ${formatWaktu(jadwal)}${tujuan ? `: ${tujuan}` : ''}` })
  }
  if (salesId !== user.id) {
    await pushToUsers(await notify([salesId], {
      type: 'visit_reminder',
      title: `Jadwal visit baru: ${targetName}`,
      body: [formatWaktu(jadwal), alamat].filter(Boolean).join(' · '),
      visitId,
      refKey: `visit-baru:${visitId}`,
    }))
  }
  return NextResponse.json({ id: visitId }, { status: 201 })
})
