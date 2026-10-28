import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { loadPr, loadPrItems, notifyPr, PR_FLOW, readPrInput } from '@/lib/purchase-requests'
import { canDeletePurchaseRequest, canEditPurchaseRequest, canManageTeknik, canProcessPurchase, moveStock, PR_STATUS, requireTeknikMenu, todayWib, type PrStatus } from '@/lib/teknik'
import { softDelete } from '@/lib/recycle-bin'

type Ctx = { params: Promise<{ id: string }> }
const prId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Pengajuan pembelian tidak ditemukan.')

export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTeknikMenu(user, 'pengajuan-pembelian', 'Pengajuan Pembelian')
  const pr = await loadPr(await prId(ctx))
  return NextResponse.json({
    item: pr,
    items: await loadPrItems(pr.id),
    can: {
      process: canProcessPurchase(user), cancel: pr.requested_by === user.id || canManageTeknik(user) || canProcessPurchase(user),
      edit: canEditPurchaseRequest(user, pr), delete: canDeletePurchaseRequest(user, pr),
    },
  })
})

// Ubah status: { status, catatan, po_number } (po_number = nomor PO Accurate, diisi saat dipesan / diterima)
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
  const poNumber = str(body.po_number, 80) || null

  const [result] = await db.query<ResultSetHeader>(
    `UPDATE purchase_requests SET status = ?, catatan_purchasing = COALESCE(?, catatan_purchasing), po_number = COALESCE(?, po_number),
       processed_by = IF(? IN ('disetujui', 'ditolak', 'dipesan', 'diterima'), ?, processed_by),
       processed_at = IF(? IN ('disetujui', 'ditolak', 'dipesan', 'diterima'), NOW(), processed_at),
       received_at = IF(? = 'diterima', NOW(), received_at)
     WHERE id = ? AND status = ?`,
    [to, catatan, poNumber, to, user.id, to, to, pr.id, from],
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

// Ubah isi pengajuan (barang, keperluan, prioritas, tanggal) selama masih diajukan: pengaju atau Purchasing
export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTeknikMenu(user, 'pengajuan-pembelian', 'Pengajuan Pembelian')
  const pr = await loadPr(await prId(ctx))
  if (!canEditPurchaseRequest(user, pr)) fail(403, pr.status === 'diajukan' ? 'Pengajuan hanya bisa diubah oleh pengaju atau Purchasing.' : 'Pengajuan yang sudah diproses tidak bisa diubah.')
  const input = await readPrInput(await readJson(request))
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    const [res] = await conn.query<ResultSetHeader>(
      "UPDATE purchase_requests SET keperluan = ?, prioritas = ?, dibutuhkan = ?, repair_id = ? WHERE id = ? AND status = 'diajukan'",
      [input.keperluan, input.prioritas, input.dibutuhkan, input.repairId, pr.id],
    )
    if (!res.affectedRows) fail(409, 'Status pengajuan baru saja berubah. Muat ulang lalu coba lagi.')
  // Lampiran catatan & notifikasi yang menunjuk pengajuan ini ikut dibersihkan
  await db.query("DELETE FROM note_attachments WHERE owner_type = 'purchase_request' AND owner_id = ?", [pr.id])
  await db.query("DELETE FROM notifications WHERE target_page = 'Pengajuan Pembelian' AND target_id = ?", [pr.id])
    await conn.query('DELETE FROM purchase_request_items WHERE request_id = ?', [pr.id])
    await conn.query(
      'INSERT INTO purchase_request_items (request_id, item_id, nama, spesifikasi, jumlah, satuan, urut) VALUES ?',
      [input.items.map((it, i) => [pr.id, it.itemId, it.nama, it.spesifikasi, it.jumlah, it.satuan, i + 1])],
    )
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
  return NextResponse.json({ item: await loadPr(pr.id) })
})

// Hapus pengajuan yang belum dipesan (diajukan / ditolak / batal): pengaju atau Purchasing
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTeknikMenu(user, 'pengajuan-pembelian', 'Pengajuan Pembelian')
  const pr = await loadPr(await prId(ctx))
  if (!canDeletePurchaseRequest(user, pr)) {
    fail(403, ['diajukan', 'ditolak', 'batal'].includes(pr.status) ? 'Pengajuan hanya bisa dihapus oleh pengaju atau Purchasing.' : 'Pengajuan yang sudah disetujui / dipesan tidak bisa dihapus; batalkan saja.')
  }
  // Lampiran catatan ikut masuk Data Terhapus; notifikasi yang menunjuk pengajuan ini dibersihkan
  await softDelete({
    table: 'purchase_requests', id: pr.id, modul: 'Pengajuan Pembelian', user,
    guard: { sql: "status IN ('diajukan', 'ditolak', 'batal')", params: [], message: 'Status pengajuan baru saja berubah. Muat ulang lalu coba lagi.' },
    extra: [{ table: 'note_attachments', where: "owner_type = 'purchase_request' AND owner_id = ?", params: [pr.id] }],
  })
  await db.query("DELETE FROM notifications WHERE target_page = 'Pengajuan Pembelian' AND target_id = ?", [pr.id])
  return NextResponse.json({ ok: true })
})
