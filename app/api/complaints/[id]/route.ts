import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import {
  addUpdate, canManageComplaints, canProcess, CC_SOLUSI, CC_STATUS, complaintUpdates, loadComplaint, notifyComplaint, readComplaintInput, readHandlingInput, requireComplaints, type CcStatus,
} from '@/lib/complaints'
import { db } from '@/lib/db'
import { softDelete } from '@/lib/recycle-bin'

type Ctx = { params: Promise<{ id: string }> }
const complaintId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Kendala customer tidak ditemukan.')

// Detail + riwayat tracking
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireComplaints(user)
  const c = await loadComplaint(await complaintId(ctx))
  return NextResponse.json({
    item: c, updates: await complaintUpdates(c.id),
    can: { process: canProcess(user, c), manage: canManageComplaints(user), delete: canManageComplaints(user) || (c.dilaporkan_oleh === user.id && c.status === 'baru') },
  })
})

// Ubah data keluhan (customer, produk, kategori, prioritas, PIC, target)
export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireComplaints(user)
  const old = await loadComplaint(await complaintId(ctx))
  if (!canProcess(user, old)) fail(403, 'Hanya pelapor, PIC, Kepala divisi, atau GM yang bisa mengubah keluhan ini.')
  const v = await readComplaintInput(await readJson(request))
  await db.query('UPDATE customer_complaints SET ? WHERE id = ?', [v, old.id])
  const changes: string[] = []
  if (old.pic_id !== v.pic_id) changes.push('PIC diganti')
  if (old.prioritas !== v.prioritas) changes.push(`prioritas ${old.prioritas} → ${v.prioritas}`)
  if (old.target_selesai !== v.target_selesai) changes.push(`target ${old.target_selesai ?? '-'} → ${v.target_selesai ?? '-'}`)
  await addUpdate(old.id, user.id, 'sistem', `Data keluhan diperbarui${changes.length ? `: ${changes.join(', ')}` : ''}.`)
  const c = await loadComplaint(old.id)
  if (c.pic_id && c.pic_id !== old.pic_id && c.pic_id !== user.id) await notifyComplaint([c.pic_id], c, 'Anda ditunjuk sebagai PIC kendala customer', `target ${c.target_selesai ?? '-'}`, `pic${c.pic_id}`)
  await logActivity(request, user, { module: 'Kendala Customer', action: 'update', entity: { type: 'customer_complaint', id: c.id, label: c.nomor }, description: `Mengubah kendala customer ${c.nomor}${changes.length ? ` (${changes.join(', ')})` : ''}` })
  return NextResponse.json({ ok: true })
})

// Tracking penanganan:
//  { action: 'handling', akar_masalah, tindakan_perbaikan, tindakan_pencegahan, solusi, solusi_detail, nilai_kompensasi }
//  { action: 'status', status, pesan?, kepuasan?, catatan_penutupan? }
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireComplaints(user)
  const c = await loadComplaint(await complaintId(ctx))
  if (!canProcess(user, c)) fail(403, 'Hanya pelapor, PIC, Kepala divisi, atau GM yang bisa memproses keluhan ini.')
  const body = await readJson(request)

  if (body.action === 'handling') {
    const v = readHandlingInput(body)
    await db.query('UPDATE customer_complaints SET ? WHERE id = ?', [v, c.id])
    const parts = [
      v.akar_masalah !== c.akar_masalah ? 'akar masalah' : '', v.tindakan_perbaikan !== c.tindakan_perbaikan ? 'tindakan perbaikan' : '',
      v.tindakan_pencegahan !== c.tindakan_pencegahan ? 'tindakan pencegahan' : '', v.solusi !== c.solusi || v.solusi_detail !== c.solusi_detail ? 'solusi' : '',
      v.nilai_kompensasi !== c.nilai_kompensasi ? 'kompensasi' : '',
    ].filter(Boolean)
    if (parts.length) await addUpdate(c.id, user.id, 'tindakan', `Memperbarui ${parts.join(', ')}.${v.solusi ? ` Solusi: ${CC_SOLUSI[v.solusi as keyof typeof CC_SOLUSI]}${v.solusi_detail ? ` — ${v.solusi_detail}` : ''}.` : ''}`)
    await logActivity(request, user, { module: 'Kendala Customer', action: 'update', entity: { type: 'customer_complaint', id: c.id, label: c.nomor }, description: `Penanganan kendala ${c.nomor}: ${parts.join(', ') || 'tanpa perubahan'}` })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'status') {
    const to = String(body.status) as CcStatus
    if (!(to in CC_STATUS)) fail(400, 'Status tidak dikenal.')
    if (to === c.status) fail(400, 'Status tidak berubah.')
    const pesan = str(body.pesan, 5000)
    // Syarat agar tracking rapi: konfirmasi / selesai butuh akar masalah atau tindakan + solusi; ditolak butuh alasan
    if ((to === 'konfirmasi' || to === 'selesai') && !(c.akar_masalah || c.tindakan_perbaikan)) fail(400, 'Isi dulu akar masalah atau tindakan perbaikan di bagian Penanganan.')
    if ((to === 'konfirmasi' || to === 'selesai') && !c.solusi) fail(400, 'Pilih dulu solusi untuk customer di bagian Penanganan.')
    if (to === 'ditolak' && !pesan) fail(400, 'Tulis alasan keluhan ditolak.')
    const kepuasan = body.kepuasan === null || body.kepuasan === undefined || body.kepuasan === '' ? null : Number(body.kepuasan)
    if (kepuasan !== null && (!Number.isInteger(kepuasan) || kepuasan < 1 || kepuasan > 5)) fail(400, 'Nilai kepuasan 1-5.')
    const closing = to === 'selesai' || to === 'ditolak'
    await db.query(
      `UPDATE customer_complaints SET status = ?, selesai_at = ${closing ? 'NOW()' : 'NULL'}${to === 'selesai' ? ', kepuasan = ?, catatan_penutupan = ?' : ''} WHERE id = ?`,
      to === 'selesai' ? [to, kepuasan, pesan || null, c.id] : [to, c.id],
    )
    const label = `${CC_STATUS[c.status]} → ${CC_STATUS[to]}`
    await addUpdate(c.id, user.id, 'status', `${label}${pesan ? `: ${pesan}` : ''}${to === 'selesai' && kepuasan ? ` (kepuasan customer ${kepuasan}/5)` : ''}`, c.status, to)
    await notifyComplaint([c.pic_id, c.dilaporkan_oleh].filter((x) => x !== user.id), c, `Status kendala: ${CC_STATUS[to]}`, `oleh ${user.name}`, `s${to}${Date.now()}`)
    await logActivity(request, user, { module: 'Kendala Customer', action: 'update', entity: { type: 'customer_complaint', id: c.id, label: c.nomor }, description: `Status kendala ${c.nomor}: ${label}` })
    return NextResponse.json({ ok: true })
  }
  return fail(400, 'Aksi tidak dikenal.')
})

// Hapus (masuk Data Terhapus bersama riwayatnya): GM / admin / lead, atau pelapor selama masih "Baru"
export const DELETE = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireComplaints(user)
  const c = await loadComplaint(await complaintId(ctx))
  if (!(canManageComplaints(user) || (c.dilaporkan_oleh === user.id && c.status === 'baru'))) fail(403, 'Keluhan yang sudah diproses hanya bisa dihapus Kepala divisi / GM.')
  await softDelete({ table: 'customer_complaints', id: c.id, modul: 'Kendala Customer', label: `${c.nomor} · ${c.customer_nama} · ${c.judul}`, user })
  await logActivity(request, user, { module: 'Kendala Customer', action: 'delete', entity: { type: 'customer_complaint', id: c.id, label: c.nomor }, description: `Menghapus kendala customer ${c.nomor}` })
  return NextResponse.json({ ok: true })
})
