import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { logActivity } from '@/lib/marketing'
import { notify } from '@/lib/notifications'
import { canVerifyPayment, loadPayment, PAYMENT_JENIS, requirePayments } from '@/lib/orders'
import { pushToUsers } from '@/lib/push'

type Ctx = { params: Promise<{ id: string }> }
const paymentId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Konfirmasi pembayaran tidak ditemukan.')

// Detail; ?bukti=1 untuk melihat file bukti transfer
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requirePayments(user)
  const item = await loadPayment(await paymentId(ctx), user)
  if (new URL(request.url).searchParams.get('bukti') === '1') {
    const [[row]] = await db.query<(RowDataPacket & { bukti: Buffer | null })[]>('SELECT bukti FROM payment_confirmations WHERE id = ?', [item.id])
    if (!row?.bukti) fail(404, 'Bukti tidak ada.')
    return new NextResponse(new Uint8Array(row.bukti!), {
      headers: { 'Content-Type': item.bukti_mime ?? 'application/octet-stream', 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(item.bukti_name ?? 'bukti')}`, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' },
    })
  }
  return NextResponse.json({ item, canVerify: canVerifyPayment(user) })
})

// Accounting memverifikasi: { status: 'diterima' | 'ditolak', alasan }
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requirePayments(user)
  if (!canVerifyPayment(user)) fail(403, 'Pembayaran diverifikasi oleh Accounting.')
  const item = await loadPayment(await paymentId(ctx), user)
  if (item.status !== 'menunggu') fail(400, 'Pembayaran ini sudah diverifikasi.')
  const body = await readJson(request)
  const status = body.status === 'ditolak' ? 'ditolak' : body.status === 'diterima' ? 'diterima' : fail(400, 'Status tidak valid.')
  const alasan = str(body.alasan, 500)
  if (status === 'ditolak' && !alasan) fail(400, 'Isi alasan penolakan (mis. dana belum masuk).')
  await db.query("UPDATE payment_confirmations SET status = ?, alasan = ?, verified_by = ?, verified_at = NOW() WHERE id = ? AND status = 'menunggu'", [status, alasan || null, user.id, item.id])
  const label = `${PAYMENT_JENIS[item.jenis as keyof typeof PAYMENT_JENIS]} Rp ${Math.round(item.nominal).toLocaleString('id-ID')}`
  if (item.quotation_id) {
    const [[q]] = await db.query<(RowDataPacket & { prospect_id: number | null })[]>('SELECT prospect_id FROM quotations WHERE id = ?', [item.quotation_id])
    if (q?.prospect_id) await logActivity(db, { prospectId: q.prospect_id, userId: user.id, jenis: 'catatan', hasil: `Pembayaran ${label} ${status === 'diterima' ? 'diterima Accounting' : `ditolak Accounting: ${alasan}`}` })
  }
  if (item.created_by !== user.id) {
    await pushToUsers(await notify([item.created_by], {
      type: 'pembayaran',
      title: `Pembayaran ${item.pembayar} ${status === 'diterima' ? 'diterima' : 'ditolak'}`,
      body: `${label}${alasan ? ` · ${alasan}` : ''} · oleh ${user.name}`,
      paymentId: item.id,
      refKey: `bayar:${item.id}:${status}`,
    }))
  }
  return NextResponse.json({ ok: true })
})
