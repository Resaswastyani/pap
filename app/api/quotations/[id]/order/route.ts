import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { toNumber } from '@/lib/hpp'
import { logActivity } from '@/lib/marketing'
import { canWriteQuotation, loadQuotation, requireQuotation } from '@/lib/quotations'

type Ctx = { params: Promise<{ id: string }> }

// Quotation diterima -> data order untuk Surat Order & Proforma Invoice (nomor SO / PI dibuat sekali)
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireQuotation(user)
  if (!canWriteQuotation(user)) fail(403, 'Surat order dibuat oleh Marketing.')
  const item = await loadQuotation(int((await ctx.params).id) ?? 0, user)
  if (item.status !== 'diterima') fail(400, 'Surat order dibuat dari penawaran yang sudah Diterima.')
  const body = await readJson(request)
  const tanggalKirim = str(body.tanggal_kirim, 10)
  if (tanggalKirim && !/^\d{4}-\d{2}-\d{2}$/.test(tanggalKirim)) fail(400, 'Tanggal kirim tidak valid.')
  const dp = toNumber(body.dp_persen)
  if (dp !== null && (dp < 0 || dp > 100)) fail(400, 'DP harus 0–100%.')
  const ongkir = toNumber(String(body.ongkir ?? '').replace(/\./g, ''))
  if (ongkir !== null && ongkir < 0) fail(400, 'Ongkir tidak valid.')
  let expeditionId = int(body.expedition_id)
  if (expeditionId) {
    const [[e]] = await db.query<(RowDataPacket & { id: number })[]>('SELECT id FROM expeditions WHERE id = ?', [expeditionId])
    expeditionId = e?.id ?? null
  }
  const first = !item.order_nomor
  await db.query(
    `UPDATE quotations SET tanggal_kirim = ?, dp_persen = ?, expedition_id = ?, ongkir = ?, catatan_order = ?, order_at = COALESCE(order_at, NOW()),
       order_nomor = COALESCE(order_nomor, CONCAT('SO-', DATE_FORMAT(NOW(), '%y%m'), '-', LPAD(id, 4, '0'))),
       proforma_nomor = COALESCE(proforma_nomor, CONCAT('PI-', DATE_FORMAT(NOW(), '%y%m'), '-', LPAD(id, 4, '0')))
     WHERE id = ?`,
    [tanggalKirim || null, dp, expeditionId, ongkir, str(body.catatan_order, 5000) || null, item.id],
  )
  if (first && item.prospect_id) {
    await logActivity(db, { prospectId: item.prospect_id, userId: user.id, jenis: 'catatan', hasil: `Surat order & proforma dibuat dari ${item.nomor}${tanggalKirim ? `, rencana kirim ${tanggalKirim}` : ''}` })
  }
  return NextResponse.json({ ok: true })
})
