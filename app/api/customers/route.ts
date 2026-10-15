import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageCustomer, canViewCustomers, CRM_CASE, CRM_INACTIVE_DAYS, CRM_STATUS, CUSTOMER_SELECT, readCustomerInput, requireMenu, saveCustomerToAccurate, upsertLocalCustomer } from '@/lib/customers'

// Daftar customer + status CRM + ringkasan per status
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireMenu(user, canViewCustomers(user))
  const params = new URL(request.url).searchParams
  const where: string[] = []
  const args: unknown[] = []
  const q = str(params.get('q'), 100)
  if (q) where.push('(c.name LIKE ? OR c.customer_no LIKE ? OR c.bill_city LIKE ? OR c.email LIKE ?)'), args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`)
  const status = params.get('status')
  if (status && status in CRM_STATUS) where.push(`(${CRM_CASE}) = ?`), args.push(status)
  if (params.get('suspended') !== '1') where.push('c.suspended = 0')
  const page = Math.max(1, int(params.get('page')) ?? 1)
  const pageSize = 50

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const [items] = await db.query<RowDataPacket[]>(
    `${CUSTOMER_SELECT} ${whereSql} ORDER BY (s.last_order IS NULL), s.last_order DESC, c.name LIMIT ? OFFSET ?`,
    [...args, pageSize, (page - 1) * pageSize],
  )
  const [[{ total }]] = await db.query<(RowDataPacket & { total: number })[]>(
    `SELECT COUNT(*) AS total FROM customers c LEFT JOIN (
       SELECT customer_accurate_id, COUNT(*) AS order_count, MAX(trans_date) AS last_order FROM accurate_sales_invoices GROUP BY customer_accurate_id
     ) s ON s.customer_accurate_id = c.accurate_id ${whereSql}`,
    args,
  )
  const [counts] = await db.query<(RowDataPacket & { crm_status: string; n: number })[]>(
    `SELECT ${CRM_CASE} AS crm_status, COUNT(*) AS n FROM customers c LEFT JOIN (
       SELECT customer_accurate_id, COUNT(*) AS order_count, MAX(trans_date) AS last_order FROM accurate_sales_invoices GROUP BY customer_accurate_id
     ) s ON s.customer_accurate_id = c.accurate_id WHERE c.suspended = 0 GROUP BY crm_status`,
  )
  const summary = Object.fromEntries(Object.keys(CRM_STATUS).map((key) => [key, Number(counts.find((c) => c.crm_status === key)?.n ?? 0)]))
  return NextResponse.json({
    items: items.map((row) => ({ ...row, order_count: Number(row.order_count), product_count: Number(row.product_count), total_amount: Number(row.total_amount) })),
    total: Number(total),
    page,
    pageSize,
    summary,
    inactiveDays: CRM_INACTIVE_DAYS,
    canManage: canManageCustomer(user),
  })
})

// Customer baru: dibuat di Accurate, lalu disalin ke PAP-MS
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  if (!canManageCustomer(user)) fail(403, 'Anda tidak punya akses untuk menambah customer.')
  const input = readCustomerInput(await readJson(request))
  const saved = await saveCustomerToAccurate(input, null)
  const id = await upsertLocalCustomer(input, saved.accurateId, saved.customerNo)
  return NextResponse.json({ id }, { status: 201 })
})
