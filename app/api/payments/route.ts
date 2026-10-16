import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { logActivity } from '@/lib/marketing'
import { notify } from '@/lib/notifications'
import { canVerifyPayment, PAYMENT_FILE_MAX, PAYMENT_JENIS, PAYMENT_SELECT, readPaymentForm, requirePayments, seesAllPayments, serializePayment } from '@/lib/orders'
import { pushToUsers } from '@/lib/push'
import { loadQuotation } from '@/lib/quotations'
import { divisionUsers } from '@/lib/requests'

// Konfirmasi pembayaran + faktur Accurate yang belum lunas
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requirePayments(user)
  const url = new URL(request.url)
  const all = seesAllPayments(user)
  const where: string[] = [all ? '1 = 1' : 'p.created_by = ?']
  const params: (string | number)[] = all ? [] : [user.id]
  const status = str(url.searchParams.get('status'), 20)
  if (['menunggu', 'diterima', 'ditolak'].includes(status)) {
    where.push('p.status = ?')
    params.push(status)
  }
  const q = str(url.searchParams.get('q'), 100)
  if (q) {
    where.push('(p.pembayar LIKE ? OR q.nomor LIKE ? OR q.order_nomor LIKE ?)')
    params.push(`%${q}%`, `%${q}%`, `%${q}%`)
  }
  const [items] = await db.query<RowDataPacket[]>(`${PAYMENT_SELECT} WHERE ${where.join(' AND ')} ORDER BY FIELD(p.status, 'menunggu', 'ditolak', 'diterima'), p.id DESC LIMIT 300`, params)
  const [[sum]] = await db.query<(RowDataPacket & Record<string, string>)[]>(
    `SELECT COALESCE(SUM(status = 'menunggu'), 0) AS menunggu, COALESCE(SUM(IF(status = 'menunggu', nominal, 0)), 0) AS nilai_menunggu,
       COALESCE(SUM(IF(status = 'diterima' AND verified_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01'), nominal, 0)), 0) AS diterima_bulan_ini
     FROM payment_confirmations p ${all ? '' : 'WHERE p.created_by = ?'}`,
    all ? [] : [user.id],
  )
  // Faktur Accurate belum lunas (piutang) - untuk Accounting & marketing yang menagih
  const [unpaid] = await db.query<RowDataPacket[]>(
    `SELECT i.number, i.trans_date, i.total_amount, DATEDIFF(CURDATE(), i.trans_date) AS umur, c.id AS customer_id, c.name AS customer_name, c.customer_no,
       um.name AS maintenance_name
     FROM accurate_sales_invoices i LEFT JOIN customers c ON c.accurate_id = i.customer_accurate_id LEFT JOIN users um ON um.id = c.maintenance_to
     WHERE i.status = 'Belum Lunas' ${all ? '' : 'AND c.maintenance_to = ?'} ORDER BY i.trans_date LIMIT 200`,
    all ? [] : [user.id],
  )
  return NextResponse.json({
    items: items.map(serializePayment),
    summary: Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, Number(v)])),
    unpaid: unpaid.map((u) => ({ ...u, total_amount: Number(u.total_amount ?? 0), umur: Number(u.umur) })),
    canVerify: canVerifyPayment(user),
  })
})

// Marketing mengirim konfirmasi pembayaran (multipart; bukti transfer opsional, gambar/PDF maks 4 MB) -> notifikasi Accounting
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requirePayments(user)
  const form = await request.formData().catch(() => fail(400, 'Data tidak valid.'))
  const input = readPaymentForm(form)
  let pembayar = input.pembayar
  let customerId = input.customer_id
  let prospectId: number | null = null
  if (input.quotation_id) {
    const q = await loadQuotation(input.quotation_id, user)
    pembayar ||= q.kepada
    customerId ??= q.customer_id
    prospectId = q.prospect_id
  }
  if (!pembayar) fail(400, 'Isi nama pembayar / customer.')
  const file = form.get('bukti')
  let bukti: Buffer | null = null
  let mime: string | null = null
  let name: string | null = null
  if (file instanceof File && file.size) {
    if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.type)) fail(400, 'Bukti transfer harus gambar (JPG/PNG/WEBP) atau PDF.')
    if (file.size > PAYMENT_FILE_MAX) fail(400, 'Ukuran bukti maksimal 4 MB.')
    bukti = Buffer.from(await file.arrayBuffer())
    mime = file.type
    name = file.name.slice(0, 255)
  }
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO payment_confirmations (quotation_id, customer_id, pembayar, jenis, nominal, tanggal_bayar, metode, bukti, bukti_mime, bukti_name, catatan, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.quotation_id, customerId, pembayar, input.jenis, input.nominal, input.tanggal_bayar, input.metode, bukti, mime, name, input.catatan, user.id],
  )
  const id = result.insertId
  const label = `${PAYMENT_JENIS[input.jenis as keyof typeof PAYMENT_JENIS]} Rp ${Math.round(input.nominal).toLocaleString('id-ID')}`
  if (prospectId) await logActivity(db, { prospectId, userId: user.id, jenis: 'catatan', hasil: `Konfirmasi pembayaran ${label} dikirim ke Accounting` })
  const accounting = (await divisionUsers(['accounting'])).filter((u) => u !== user.id)
  await pushToUsers(await notify(accounting, {
    type: 'pembayaran',
    title: `Konfirmasi pembayaran: ${pembayar}`,
    body: `${label} · ${input.tanggal_bayar}${input.metode ? ` · ${input.metode}` : ''} · dari ${user.name}`,
    paymentId: id,
    refKey: `bayar:${id}:baru`,
  }))
  return NextResponse.json({ id }, { status: 201 })
})
