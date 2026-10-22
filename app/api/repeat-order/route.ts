import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { handle, int, requireUser, str, pageParams } from '@/lib/api'
import { db } from '@/lib/db'
import { MARKETING_DIVISIONS } from '@/lib/marketing'
import { REPEAT_BASE, REPEAT_STATUS, requireRepeatOrder, seesAllCustomers, serializeRepeat } from '@/lib/repeat-order'
import { CRM_INACTIVE_DAYS } from '@/lib/customers'

const PAGE_SIZE = 50

// Daftar customer untuk dipantau repeat order-nya, diurutkan dari yang paling mendesak
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireRepeatOrder(user)
  const url = new URL(request.url)
  const all = seesAllCustomers(user)
  const where: string[] = []
  const params: (string | number)[] = []
  if (!all) {
    where.push('x.maintenance_to = ?')
    params.push(user.id)
  } else {
    const pic = url.searchParams.get('pic')
    if (pic === 'me') { where.push('x.maintenance_to = ?'); params.push(user.id) }
    else if (pic === 'none') where.push('x.maintenance_to IS NULL')
    else if (int(pic)) { where.push('x.maintenance_to = ?'); params.push(int(pic)!) }
  }
  const q = str(url.searchParams.get('q'), 100)
  if (q) {
    where.push('(x.name LIKE ? OR x.customer_no LIKE ? OR x.bill_city LIKE ?)')
    params.push(`%${q}%`, `%${q}%`, `%${q}%`)
  }
  const base = `SELECT * FROM (${REPEAT_BASE}) x ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`
  const [summaryRows] = await db.query<(RowDataPacket & { status: string; n: number })[]>(`SELECT status, COUNT(*) AS n FROM (${base}) y GROUP BY status`, params)
  const [[due]] = await db.query<(RowDataPacket & { today: number; overdue: number })[]>(
    `SELECT COALESCE(SUM(DATE(next_followup_at) = CURDATE()), 0) AS today, COALESCE(SUM(next_followup_at < CURDATE()), 0) AS overdue FROM (${base}) y`,
    params,
  )

  const status = url.searchParams.get('status') ?? 'perlu'
  const filter: string[] = []
  if (status === 'perlu') filter.push("status IN ('waktunya', 'berisiko')")
  else if (status === 'followup') filter.push('next_followup_at < CURDATE() + INTERVAL 1 DAY')
  else if (status in REPEAT_STATUS) filter.push(`status = ${db.escape(status)}`)
  const { page, pageSize } = pageParams(url.searchParams, PAGE_SIZE)
  const order = `ORDER BY FIELD(status, 'waktunya', 'berisiko', 'aman', 'nonaktif'), ${status === 'followup' ? 'next_followup_at,' : ''} hari_terlambat DESC, total_amount DESC`
  const filtered = `SELECT * FROM (${base}) y ${filter.length ? `WHERE ${filter.join(' AND ')}` : ''}`
  const [[{ total }]] = await db.query<(RowDataPacket & { total: number })[]>(`SELECT COUNT(*) AS total FROM (${filtered}) z`, params)
  const [items] = await db.query<RowDataPacket[]>(`${filtered} ${order} LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize])
  const [users] = await db.query<RowDataPacket[]>(
    `SELECT u.id, u.name, d.code AS division_code, d.name AS division_name FROM users u JOIN divisions d ON d.id = u.division_id
     WHERE u.is_active = 1 AND d.code IN (?) ORDER BY d.code = 'marketing_maintenance' DESC, u.name`,
    [[...MARKETING_DIVISIONS]],
  )
  return NextResponse.json({
    items: items.map(serializeRepeat),
    total: Number(total),
    pageSize,
    inactiveDays: CRM_INACTIVE_DAYS,
    summary: Object.fromEntries(summaryRows.map((r) => [r.status, Number(r.n)])),
    due: { today: Number(due.today), overdue: Number(due.overdue) },
    users,
    seesAll: all,
  })
})
