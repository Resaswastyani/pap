import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canSupervise, loadVisit, logActivity, parseDateTime, requireMarketing, requireMarketingUser, VISIT_TYPES } from '@/lib/marketing'
import { formatWaktu } from '@/lib/notifications'

type Ctx = { params: Promise<{ id: string }> }

const visitId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Jadwal visit tidak ditemukan.')

export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireMarketing(user, 'visit')
  return NextResponse.json({ item: await loadVisit(await visitId(ctx), user) })
})

// Jadwal ulang / ubah tujuan / batalkan visit yang belum check-in
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireMarketing(user, 'visit')
  const visit = await loadVisit(await visitId(ctx), user)
  if (visit.status !== 'terjadwal') fail(400, 'Visit yang sudah selesai / batal tidak dapat diubah.')
  const body = await readJson(request)
  if (body.status === 'batal') {
    const alasan = str(body.alasan, 500)
    await db.query("UPDATE visits SET status = 'batal', hasil = ? WHERE id = ?", [alasan || null, visit.id])
    await logActivity(db, { prospectId: visit.prospect_id, customerId: visit.customer_id, visitId: visit.id, userId: user.id, jenis: 'catatan', hasil: `Visit ${formatWaktu(visit.jadwal)} dibatalkan${alasan ? `: ${alasan}` : ''}` })
    return NextResponse.json({ ok: true })
  }
  const jadwal = parseDateTime(body.jadwal, 'Jadwal visit', true)!
  const jenis = str(body.jenis, 20) || visit.jenis
  if (!(jenis in VISIT_TYPES)) fail(400, 'Jenis visit tidak valid.')
  const salesId = canSupervise(user) && body.sales_id !== undefined ? (await requireMarketingUser(body.sales_id, 'Sales'))?.id ?? visit.sales_id : visit.sales_id
  await db.query('UPDATE visits SET jadwal = ?, jenis = ?, tujuan = ?, alamat = ?, sales_id = ? WHERE id = ?', [jadwal, jenis, str(body.tujuan, 500) || null, str(body.alamat, 500) || null, salesId, visit.id])
  if (jadwal !== visit.jadwal) {
    await logActivity(db, { prospectId: visit.prospect_id, customerId: visit.customer_id, visitId: visit.id, userId: user.id, jenis: 'catatan', hasil: `Visit dijadwal ulang ke ${formatWaktu(jadwal)}` })
  }
  return NextResponse.json({ ok: true })
})

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireMarketing(user, 'visit')
  const visit = await loadVisit(await visitId(ctx), user)
  if (visit.checkin_at && !user.role.isAdmin) fail(400, 'Visit yang sudah check-in tidak dapat dihapus.')
  if (!canSupervise(user) && visit.created_by !== user.id) fail(403, 'Hanya pembuat jadwal atau Lead yang dapat menghapus.')
  await db.query('DELETE FROM visits WHERE id = ?', [visit.id])
  return NextResponse.json({ ok: true })
})
