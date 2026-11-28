import { randomBytes } from 'node:crypto'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { loadPr, loadPrItems, notifyPr, PR_FLOW, readPrInput } from '@/lib/purchase-requests'
import { canApproveAsAccounting, canApproveAsGm, canApprovePurchase, canCheckPurchase, canDeletePurchaseRequest, canEditPurchaseRequest, canManageTeknik, canProcessPurchase, moveStock, PR_STATUS, requireTeknikMenu, todayWib, type PrStatus } from '@/lib/teknik'
import { softDelete } from '@/lib/recycle-bin'
import { mySignature, readSignatureImage } from '@/lib/quotation-signature'

type Ctx = { params: Promise<{ id: string }> }
const prId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Pengajuan pembelian tidak ditemukan.')

export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTeknikMenu(user, 'pengajuan-pembelian', 'Pengajuan Pembelian')
  const pr = await loadPr(await prId(ctx))
  const check = pr.status === 'diajukan' && canCheckPurchase(user) && !pr.checked_name
  const approveGm = pr.status === 'diajukan' && canApproveAsGm(user) && !!pr.checked_name && !pr.gm_approved_name
  const approveAccounting = pr.status === 'diajukan' && canApproveAsAccounting(user) && !!pr.gm_approved_name && !pr.acc_approved_name
  return NextResponse.json({
    item: pr,
    items: await loadPrItems(pr.id),
    // Tanda tangan tersimpan milik user (dipakai ulang saat menyetujui)
    mine: approveGm || approveAccounting ? await mySignature(user.id) : null,
    can: {
      process: canProcessPurchase(user), cancel: pr.requested_by === user.id || canManageTeknik(user) || canProcessPurchase(user),
      edit: canEditPurchaseRequest(user, pr), delete: canDeletePurchaseRequest(user, pr),
      // Berurutan selama masih diajukan: diperiksa Purchasing -> disetujui GM -> disetujui Accounting
      check, approveGm, approveAccounting,
      reject: pr.status === 'diajukan' ? canProcessPurchase(user) || canApprovePurchase(user) : canProcessPurchase(user),
    },
  })
})

// Ubah status: { status, catatan, po_number } (po_number = nomor PO Accurate, diisi saat dipesan / diterima)
// Periksa: { check: true } oleh Purchasing (meneruskan ke GM). Setujui: { approve: true } oleh GM (setelah diperiksa), lalu Accounting
// (setelah GM); setelah keduanya setuju status otomatis menjadi disetujui.
// Purchasing: dipesan, diterima. Tolak: Purchasing, GM, atau Accounting. Pengaju / Teknik: batal (sebelum diterima).
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
    if (!body.status && !body.approve && !body.check) return NextResponse.json({ item: await loadPr(pr.id) })
  }
  if (body.check) {
    if (!canCheckPurchase(user)) fail(403, 'Pengajuan diperiksa oleh divisi Purchasing.')
    if (pr.status !== 'diajukan') fail(400, `Pengajuan berstatus ${PR_STATUS[pr.status as PrStatus]} tidak perlu diperiksa lagi.`)
    const [res] = await db.query<ResultSetHeader>(
      `UPDATE purchase_requests SET checked_by = ?, checked_at = NOW(), catatan_purchasing = COALESCE(?, catatan_purchasing)
       WHERE id = ? AND status = 'diajukan' AND checked_by IS NULL`,
      [user.id, str(body.catatan, 5000) || null, pr.id],
    )
    if (!res.affectedRows) fail(409, 'Pengajuan ini sudah diperiksa atau statusnya baru saja berubah. Muat ulang lalu coba lagi.')
    await notifyPr(pr.id, user, false, 'purchasing')
    return NextResponse.json({ item: await loadPr(pr.id) })
  }
  if (body.approve) {
    const asGm = canApproveAsGm(user)
    const asAcc = canApproveAsAccounting(user)
    if (!asGm && !asAcc) fail(403, 'Pengajuan pembelian disetujui oleh GM dan Accounting.')
    if (pr.status !== 'diajukan') fail(400, `Pengajuan berstatus ${PR_STATUS[pr.status as PrStatus]} tidak perlu disetujui lagi.`)
    const col = asGm ? 'gm' : 'acc'
    if (asGm && !pr.checked_name) fail(400, 'Pengajuan ini belum diperiksa Purchasing. GM menyetujui setelah diperiksa Purchasing.')
    if (!asGm && !pr.gm_approved_name) fail(400, 'Pengajuan ini belum disetujui GM. Accounting menyetujui setelah GM.')
    const catatan = str(body.catatan, 5000) || null
    // Tanda tangan wajib: { ttd: { nama, jabatan, image, setuju, simpan } }
    const ttd = (body.ttd && typeof body.ttd === 'object' ? body.ttd : {}) as Record<string, unknown>
    if (ttd.setuju !== true) fail(400, 'Tanda tangani persetujuan dan centang pernyataannya.')
    const image = readSignatureImage(ttd.image)
    const nama = str(ttd.nama, 150) || user.name
    const jabatan = str(ttd.jabatan, 150) || null
    const [res] = await db.query<ResultSetHeader>(
      `UPDATE purchase_requests SET ${col}_approved_by = ?, ${col}_approved_at = NOW(), catatan_purchasing = COALESCE(?, catatan_purchasing),
         ${col}_ttd_nama = ?, ${col}_ttd_jabatan = ?, ${col}_ttd_image = ?, ${col}_ttd_token = ?
       WHERE id = ? AND status = 'diajukan' AND ${col}_approved_by IS NULL${asGm ? ' AND checked_by IS NOT NULL' : ' AND gm_approved_by IS NOT NULL'}`,
      [user.id, catatan, nama, jabatan, image, randomBytes(16).toString('hex'), pr.id],
    )
    if (!res.affectedRows) fail(409, `Pengajuan ini sudah disetujui ${asGm ? 'GM' : 'Accounting'} atau statusnya baru saja berubah. Muat ulang lalu coba lagi.`)
    if (ttd.simpan === true) {
      await db.query('INSERT INTO user_signatures (user_id, image, jabatan) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE image = VALUES(image), jabatan = VALUES(jabatan)', [user.id, image, jabatan])
    }
    // Kedua persetujuan lengkap -> disetujui (siap dipesan Purchasing)
    await db.query(
      `UPDATE purchase_requests SET status = 'disetujui', processed_by = ?, processed_at = NOW()
       WHERE id = ? AND status = 'diajukan' AND gm_approved_by IS NOT NULL AND acc_approved_by IS NOT NULL`,
      [user.id, pr.id],
    )
    await notifyPr(pr.id, user, false, asGm ? 'gm' : 'accounting')
    return NextResponse.json({ item: await loadPr(pr.id) })
  }
  const to = str(body.status, 20) as PrStatus
  if (!(to in PR_STATUS)) fail(400, 'Status tidak valid.')
  const from = pr.status as PrStatus
  if (to === 'disetujui') fail(400, 'Pengajuan disetujui lewat tombol Setujui oleh GM dan Accounting.')
  if (!PR_FLOW[from].includes(to)) fail(400, `Pengajuan berstatus ${PR_STATUS[from]} tidak bisa diubah menjadi ${PR_STATUS[to]}.`)
  const catatan = str(body.catatan, 5000) || null
  if (to === 'batal') {
    if (!(pr.requested_by === user.id || canManageTeknik(user) || canProcessPurchase(user))) fail(403, 'Hanya pengaju yang dapat membatalkan.')
  } else if (to === 'ditolak' && from === 'diajukan') {
    if (!(canProcessPurchase(user) || canApprovePurchase(user))) fail(403, 'Pengajuan ditolak oleh Purchasing, GM, atau Accounting.')
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
      // Isi berubah: pemeriksaan & persetujuan diulang (diubah Purchasing = sekaligus diperiksa ulang olehnya)
      `UPDATE purchase_requests SET keperluan = ?, prioritas = ?, dibutuhkan = ?, repair_id = ?,
         checked_by = ?, checked_at = IF(? IS NULL, NULL, NOW()),
         gm_approved_by = NULL, gm_approved_at = NULL, acc_approved_by = NULL, acc_approved_at = NULL,
         gm_ttd_nama = NULL, gm_ttd_jabatan = NULL, gm_ttd_image = NULL, gm_ttd_token = NULL,
         acc_ttd_nama = NULL, acc_ttd_jabatan = NULL, acc_ttd_image = NULL, acc_ttd_token = NULL
       WHERE id = ? AND status = 'diajukan'`,
      [input.keperluan, input.prioritas, input.dibutuhkan, input.repairId, ...Array(2).fill(canCheckPurchase(user) ? user.id : null), pr.id],
    )
    if (!res.affectedRows) fail(409, 'Status pengajuan baru saja berubah. Muat ulang lalu coba lagi.')
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
