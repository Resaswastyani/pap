import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { loadPr, loadPrItems, notifyPr, PR_FLOW } from '@/lib/purchase-requests'
import { canManageTeknik, canProcessPurchase, moveStock, PR_STATUS, requireTeknikMenu, todayWib, type PrStatus } from '@/lib/teknik'

type Ctx = { params: Promise<{ id: string }> }
const prId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Pengajuan pembelian tidak ditemukan.')

export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTeknikMenu(user, 'pengajuan-pembelian', 'Pengajuan Pembelian')
  const pr = await loadPr(await prId(ctx))
  return NextResponse.json({
    item: pr,
    items: await loadPrItems(pr.id),
    can: { process: canProcessPurchase(user), cancel: pr.requested_by === user.id || canManageTeknik(user) || canProcessPurchase(user) },
  })
})

// Ubah status: { status, catatan }
// Purchasing / GM: disetujui, ditolak, dipesan, diterima. Pengaju / Teknik: batal (sebelum diterima).
// Diterima: barang yang terhubung ke data sparepart otomatis masuk stok.
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTeknikMenu(user, 'pengajuan-pembelian', 'Pengajuan Pembelian')
  const pr = await loadPr(await prId(ctx))
  const body = await readJson(request)
  // Pilih / ganti supplier (Purchasing), bisa sendiri atau bersama perubahan status: { vendor_id }
  if ('vendor_id' in body) {
    if (!canProcessPurchase(user)) fail(403, 'Supplier dipilih oleh divisi Purchasing.')
    if (['diterima', 'ditolak', 'batal'].includes(pr.status)) fail(400, 'Pengajuan ini sudah selesai.')
    const vendorId = body.vendor_id ? int(body.vendor_id) : null
    if (vendorId) {
      const [[v]] = await db.query<RowDataPacket[]>('SELECT accurate_id FROM accurate_vendors WHERE accurate_id = ?', [vendorId])
      if (!v) fail(400, 'Supplier tidak ditemukan. Sinkron ulang data supplier dari Accurate.')
    }
    await db.query('UPDATE purchase_requests SET vendor_accurate_id = ? WHERE id = ?', [vendorId, pr.id])
    if (!body.status) return NextResponse.json({ item: await loadPr(pr.id) })
  }
  const to = str(body.status, 20) as PrStatus
  if (!(to in PR_STATUS)) fail(400, 'Status tidak valid.')
  const from = pr.status as PrStatus
  if (!PR_FLOW[from].includes(to)) fail(400, `Pengajuan berstatus ${PR_STATUS[from]} tidak bisa diubah menjadi ${PR_STATUS[to]}.`)
  const catatan = str(body.catatan, 5000) || null
  if (to === 'batal') {
    if (!(pr.requested_by === user.id || canManageTeknik(user) || canProcessPurchase(user))) fail(403, 'Hanya pengaju yang dapat membatalkan.')
  } else if (!canProcessPurchase(user)) {
    fail(403, 'Pengajuan diproses oleh divisi Purchasing.')
  }
  if (to === 'ditolak' && !catatan) fail(400, 'Tuliskan alasan penolakan.')

  const [result] = await db.query<ResultSetHeader>(
    `UPDATE purchase_requests SET status = ?, catatan_purchasing = COALESCE(?, catatan_purchasing),
       processed_by = IF(? IN ('disetujui', 'ditolak', 'dipesan', 'diterima'), ?, processed_by),
       processed_at = IF(? IN ('disetujui', 'ditolak', 'dipesan', 'diterima'), NOW(), processed_at),
       received_at = IF(? = 'diterima', NOW(), received_at)
     WHERE id = ? AND status = ?`,
    [to, catatan, to, user.id, to, to, pr.id, from],
  )
  if (!result.affectedRows) fail(409, 'Status pengajuan baru saja berubah. Muat ulang lalu coba lagi.')
  if (to === 'diterima') {
    for (const it of await loadPrItems(pr.id)) {
      if (it.item_id) await moveStock({ itemId: it.item_id, jenis: 'masuk', jumlah: it.jumlah, tanggal: todayWib(), keterangan: `Diterima dari pengajuan ${pr.nomor}`, purchaseRequestId: pr.id, userId: user.id })
    }
  }
  await notifyPr(pr.id, user, false)
  return NextResponse.json({ item: await loadPr(pr.id) })
})
