import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canSupervise, logActivity } from '@/lib/marketing'
import {
  canAcceptDesign, DESIGN_STATUS, DESIGN_TEAM, divisionUsers, isDesigner, loadDesign, logRequest, notifyRequest, publishDesignToProduct, requireRequestMenu,
  type DesignStatus,
} from '@/lib/requests'

type Ctx = { params: Promise<{ id: string }> }

// Alur: diajukan -(Lead Digital Marketing terima)-> dikerjakan | batal (ditolak) -(staff Digital Marketing unggah desain, kirim review)-> review
//       -(customer)-> disetujui (masuk Data Produk) | revisi -(staff Digital Marketing unggah versi baru)-> review
const NEXT: Record<DesignStatus, DesignStatus[]> = {
  diajukan: ['dikerjakan', 'batal'],
  dikerjakan: ['review', 'batal'],
  review: ['disetujui', 'revisi', 'batal'],
  revisi: ['review', 'batal'],
  // Persetujuan bisa dibatalkan (kembali ke Review customer) oleh sales pengaju / Lead / admin
  disetujui: ['review'],
  batal: [],
}

// Batalkan efek persetujuan: salinan file desain final di Data Produk dihapus; produk ikut dihapus hanya bila dibuat
// oleh persetujuan ini, tidak punya file lain, dan belum dipakai di tempat lain. Konten digital: rencana konten kembali "Produksi".
async function undoApproval(item: RowDataPacket) {
  if (item.kategori === 'konten') {
    await db.query("UPDATE content_plans SET status = 'produksi' WHERE design_request_id = ? AND status = 'siap'", [item.id])
    await db.query('UPDATE design_requests SET final_file_id = NULL WHERE id = ?', [item.id])
    return null
  }
  const productId = item.product_id ? Number(item.product_id) : null
  if (!productId || !item.final_file_id) return null
  const [[final]] = await db.query<(RowDataPacket & { name: string; size: number })[]>('SELECT name, size FROM design_request_files WHERE id = ?', [item.final_file_id])
  if (final) {
    await db.query('DELETE FROM customer_product_files WHERE product_id = ? AND name = ? AND size = ? ORDER BY id DESC LIMIT 1', [productId, final.name, final.size])
  }
  const [[p]] = await db.query<(RowDataPacket & { keterangan: string | null; files: number; dipakai: number })[]>(
    `SELECT cp.keterangan, (SELECT COUNT(*) FROM customer_product_files f WHERE f.product_id = cp.id) AS files,
       (SELECT COUNT(*) FROM design_requests d WHERE d.product_id = cp.id AND d.id <> ?) + (SELECT COUNT(*) FROM sample_requests s WHERE s.product_id = cp.id)
       + (SELECT COUNT(*) FROM sample_request_items si WHERE si.product_id = cp.id) + (SELECT COUNT(*) FROM prospect_products pp WHERE pp.product_id = cp.id)
       + (SELECT COUNT(*) FROM quotation_items qi WHERE qi.product_id = cp.id) + (SELECT COUNT(*) FROM production_jobs j WHERE j.product_id = cp.id)
       + (SELECT COUNT(*) FROM formulations fo WHERE fo.product_id = cp.id) AS dipakai
     FROM customer_products cp WHERE cp.id = ?`,
    [item.id, productId],
  )
  const createdHere = !!p && String(p.keterangan ?? '').startsWith(`Dari request desain ${item.nomor}`)
  if (createdHere && Number(p.files) === 0 && Number(p.dipakai) === 0) {
    await db.query('UPDATE design_requests SET product_id = NULL, final_file_id = NULL WHERE id = ?', [item.id])
    await db.query('DELETE FROM customer_products WHERE id = ?', [productId])
    return 'produk dihapus dari Data Produk'
  }
  await db.query('UPDATE design_requests SET final_file_id = NULL WHERE id = ?', [item.id])
  return 'file desain final dilepas dari Data Produk'
}

export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireRequestMenu(user, 'desain')
  const item = await loadDesign(int((await ctx.params).id) ?? fail(404, 'Request desain tidak ditemukan.'), user)
  const body = await readJson(request)
  const from = item.status as DesignStatus
  const to = str(body.status, 20) as DesignStatus
  if (!(to in DESIGN_STATUS) || !NEXT[from].includes(to)) fail(400, `Status tidak bisa diubah dari "${DESIGN_STATUS[from]}" ke "${DESIGN_STATUS[to] ?? to}".`)
  const catatan = str(body.catatan, 5000) || null
  const requester = item.requested_by === user.id || user.role.isAdmin || canSupervise(user)
  // Semua staff Digital Marketing boleh mengerjakan request yang sudah diterima
  const designer = isDesigner(user)

  const sets: string[] = ['status = ?']
  const values: unknown[] = [to]
  let note = catatan
  let finalFileId: number | null = null
  let undone: string | null = null
  if (from === 'disetujui' && to === 'review') {
    // Batalkan persetujuan: kembali menunggu tanggapan customer
    if (!requester) fail(403, 'Persetujuan hanya bisa dibatalkan oleh sales pengaju, Lead, atau admin.')
    if (!catatan) fail(400, 'Tulis alasan membatalkan persetujuan.')
    undone = await undoApproval(item as RowDataPacket)
    note = `Persetujuan dibatalkan, kembali ke Review customer${undone ? ` (${undone})` : ''}. ${catatan}`
  } else if (to === 'dikerjakan') {
    // Diterima Lead Digital Marketing; setelah itu staff Digital Marketing bisa mengunggah & mengirim desain
    if (!canAcceptDesign(user)) fail(403, 'Hanya Lead Digital Marketing yang dapat menerima request desain.')
    note = `Diterima ${user.name}, dikerjakan tim Digital Marketing${catatan ? `. ${catatan}` : ''}`
  } else if (to === 'review') {
    if (!designer) fail(403, 'Desain dikirim untuk review oleh tim Digital Marketing.')
    // Pengirim tercatat sebagai desainer request ini
    sets.push('designer_id = ?')
    values.push(user.id)
    const [[file]] = await db.query<(RowDataPacket & { n: number })[]>(
      "SELECT COUNT(*) AS n FROM design_request_files WHERE design_id = ? AND kind = 'desain' AND versi = ?",
      [item.id, Number(item.revisi_ke) + 1],
    )
    // Hasil desain boleh berupa file yang diunggah atau lampiran link/file pada catatan (diunggah setelah status berubah)
    if (!Number(file.n) && !(int(body.lampiran) ?? 0)) fail(400, `Unggah file desain versi ${Number(item.revisi_ke) + 1} atau tambahkan link hasil desain terlebih dahulu.`)
    note = `Desain versi ${Number(item.revisi_ke) + 1} dikirim untuk review${catatan ? `. ${catatan}` : ''}`
  } else if (to === 'disetujui') {
    if (!requester) fail(403, 'Persetujuan customer dicatat oleh sales yang mengajukan.')
    const [[file]] = await db.query<(RowDataPacket & { id: number; name: string })[]>(
      `SELECT id, name FROM design_request_files WHERE design_id = ? AND kind = 'desain' AND (? IS NULL OR id = ?) ORDER BY versi DESC, id DESC LIMIT 1`,
      [item.id, int(body.file_id), int(body.file_id)],
    )
    // Tanpa file desain (hasil dikirim lewat link): tetap bisa disetujui, hanya tidak masuk Data Produk/Bank Konten
    if (!file && int(body.file_id)) fail(400, 'Pilih file desain final.')
    finalFileId = file?.id ?? null
    sets.push('feedback = ?')
    values.push(catatan)
    note = file ? `Desain final: ${file.name}${catatan ? `. ${catatan}` : ''}` : `Desain disetujui (hasil lewat link)${catatan ? `. ${catatan}` : ''}`
  } else if (to === 'revisi') {
    if (!requester) fail(403, 'Permintaan revisi dicatat oleh sales yang mengajukan.')
    if (!catatan) fail(400, 'Tulis revisi yang diminta customer.')
    sets.push('feedback = ?', 'revisi_ke = revisi_ke + 1')
    values.push(catatan)
  } else if (to === 'batal') {
    // Menunggu diterima: ditolak Lead Digital Marketing, atau dibatalkan sales pengajunya sendiri
    if (from === 'diajukan' ? !(canAcceptDesign(user) || item.requested_by === user.id) : !requester && !designer && !canAcceptDesign(user)) fail(403, from === 'diajukan' ? 'Hanya Lead Digital Marketing yang dapat menolak request desain.' : 'Hanya sales pengaju atau tim Digital Marketing yang dapat membatalkan.')
    if (!catatan) fail(400, 'Tulis alasan pembatalan.')
  }

  await db.query(`UPDATE design_requests SET ${sets.join(', ')} WHERE id = ? AND status = ?`, [...values, item.id, from])
  let productId: number | null = null
  if (finalFileId && item.kategori === 'konten') {
    // Konten digital: simpan file final, rencana konten yang tertaut menjadi "Siap tayang" (masuk bank konten)
    await db.query('UPDATE design_requests SET final_file_id = ? WHERE id = ?', [finalFileId, item.id])
    await db.query("UPDATE content_plans SET status = 'siap' WHERE design_request_id = ? AND status IN ('ide', 'produksi')", [item.id])
  } else if (finalFileId) {
    productId = await publishDesignToProduct(item as RowDataPacket, finalFileId, user.id)
  }
  const logId = await logRequest({ designId: item.id, userId: user.id, from, to, catatan: note })
  if (item.prospect_id && ['review', 'disetujui', 'revisi'].includes(to)) {
    await logActivity(db, { prospectId: item.prospect_id, userId: user.id, jenis: 'catatan', hasil: `Desain ${item.nomor}: ${DESIGN_STATUS[to]}${note ? ` — ${note}` : ''}` })
  }

  // Diterima / revisi: seluruh tim Digital Marketing; selesai / batal: desainer pengirim (bila sudah ada)
  const team = await divisionUsers(DESIGN_TEAM)
  const desainers = item.designer_id ? [item.designer_id] : team
  const recipients: Record<DesignStatus, number[]> = {
    diajukan: team,
    dikerjakan: [item.requested_by, ...team],
    review: [item.requested_by],
    revisi: [...desainers, ...team],
    disetujui: desainers,
    // Ditolak saat menunggu diterima: hanya pengaju (belum diterima Lead Digital Marketing)
    batal: from === 'diajukan' ? [item.requested_by] : [item.requested_by, ...desainers],
  }
  await notifyRequest(recipients[to], user.id, {
    type: 'desain_update',
    title: `Desain ${item.nomor}: ${DESIGN_STATUS[to]}`,
    body: [item.judul, item.target_name, note].filter(Boolean).join(' · '),
    designId: item.id,
    refKey: `desain:${item.id}:${to}:${Date.now()}`,
  })
  return NextResponse.json({ ok: true, productId, logId })
})
