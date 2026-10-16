import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { withNoteAttachments } from '@/lib/attachments'
import { db } from '@/lib/db'
import { ACTIVITY_TYPES, canSupervise, logActivity, parseDateTime, requireMarketingUser } from '@/lib/marketing'
import { notify } from '@/lib/notifications'
import { pushToUsers } from '@/lib/push'
import { loadRepeatCustomer, requireRepeatOrder } from '@/lib/repeat-order'

type Ctx = { params: Promise<{ id: string }> }
const customerId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Customer tidak ditemukan.')

// Detail: data repeat order + riwayat follow-up + faktur terakhir
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireRepeatOrder(user)
  const item = await loadRepeatCustomer(await customerId(ctx), user)
  const [activities] = await db.query<RowDataPacket[]>(
    `SELECT a.id, a.jenis, a.hasil, a.created_at, u.name AS user_name FROM marketing_activities a JOIN users u ON u.id = a.user_id
     WHERE a.customer_id = ? ORDER BY a.id DESC LIMIT 100`,
    [item.id],
  )
  const notes = await withNoteAttachments('activity', activities as (RowDataPacket & { id: number })[])
  const [invoices] = await db.query<RowDataPacket[]>(
    'SELECT number, trans_date, total_amount, status FROM accurate_sales_invoices WHERE customer_accurate_id = ? ORDER BY trans_date DESC LIMIT 12',
    [item.accurate_id],
  )
  return NextResponse.json({ item, activities: notes, invoices: invoices.map((i) => ({ ...i, total_amount: Number(i.total_amount ?? 0) })), canAssign: canSupervise(user) })
})

// Catat follow-up customer (WA/telepon/visit/...) + jadwal follow-up berikutnya, atau ganti PIC (Lead/GM)
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireRepeatOrder(user)
  const item = await loadRepeatCustomer(await customerId(ctx), user)
  const body = await readJson(request)

  if (body.maintenance_to !== undefined) {
    if (!canSupervise(user)) fail(403, 'Hanya Lead / GM yang dapat mengganti PIC customer.')
    const pic = await requireMarketingUser(body.maintenance_to, 'PIC')
    await db.query('UPDATE customers SET maintenance_to = ? WHERE id = ?', [pic?.id ?? null, item.id])
    await logActivity(db, { customerId: item.id, userId: user.id, jenis: 'handover', hasil: pic ? `PIC Marketing Maintenance: ${pic.name}` : 'PIC dikosongkan' })
    if (pic && pic.id !== user.id) {
      await pushToUsers(await notify([pic.id], {
        type: 'repeat_order',
        title: `Customer baru untuk Anda jaga: ${item.name}`,
        body: `${item.order_count}x order · terakhir ${item.last_order}`,
        customerId: item.id,
        refKey: `repeat-pic:${item.id}:${pic.id}`,
      }))
    }
    return NextResponse.json({ ok: true })
  }

  const jenis = str(body.jenis, 20)
  if (!(jenis in ACTIVITY_TYPES)) fail(400, 'Jenis follow-up tidak valid.')
  const hasil = str(body.hasil, 5000) || null
  if (!hasil && !(Number(body.lampiran) > 0)) fail(400, 'Isi catatan follow-up atau tambahkan lampiran.')
  const next = parseDateTime(body.next_followup_at, 'Jadwal follow-up')
  const id = await logActivity(db, { customerId: item.id, userId: user.id, jenis, hasil })
  await db.query('UPDATE customers SET last_contact_at = NOW(), next_followup_at = ? WHERE id = ?', [next, item.id])
  return NextResponse.json({ ok: true, id }, { status: 201 })
})
