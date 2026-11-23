import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import {
  assertWajib, canMarketing, canOperasional, canPpic, loadChecklist, notifyChecklist, OC_STATUS, operasionalUsers, ppicUsers, readHeader, readIsian, requireOrderCustom, type OrderChecklist,
} from '@/lib/order-custom'
import { softDelete } from '@/lib/recycle-bin'
import { isManagement, type UserProfile } from '@/lib/users'

type Ctx = { params: Promise<{ id: string }> }
const checklistId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Checklist order custom tidak ditemukan.')

// Yang boleh mengubah isian: Marketing saat draft, PPIC saat verifikasi, Operasional saat penerimaan
const canEdit = (u: UserProfile, c: OrderChecklist) =>
  (c.status === 'draft' && canMarketing(u)) || (c.status === 'ppic' && canPpic(u)) || (c.status === 'operasional' && canOperasional(u))
const canDelete = (u: UserProfile, c: OrderChecklist) => u.role.isAdmin || isManagement(u) || (c.created_by === u.id && c.status === 'draft')

export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireOrderCustom(user)
  const c = await loadChecklist(await checklistId(ctx))
  return NextResponse.json({
    item: c,
    can: {
      edit: canEdit(user, c), header: c.status === 'draft' && canMarketing(user),
      serahkan: c.status === 'draft' && canMarketing(user),
      ppic: c.status === 'ppic' && canPpic(user),
      operasional: c.status === 'operasional' && canOperasional(user),
      kembalikan: (c.status === 'ppic' && canPpic(user)) || (c.status === 'operasional' && canOperasional(user)),
      buka: c.status === 'selesai' && (user.role.isAdmin || isManagement(user) || canOperasional(user)),
      attach: c.status !== 'selesai' && (canMarketing(user) || canPpic(user) || canOperasional(user)),
      delete: canDelete(user, c),
    },
  })
})

// Simpan isian (dan kop bila masih draft Marketing)
export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireOrderCustom(user)
  const c = await loadChecklist(await checklistId(ctx))
  if (!canEdit(user, c)) fail(403, c.status === 'selesai' ? 'Checklist sudah selesai.' : `Checklist sedang di tahap ${OC_STATUS[c.status]}.`)
  const body = await readJson(request)
  const isian = JSON.stringify(readIsian(body.isian))
  if (c.status === 'draft') await db.query('UPDATE order_custom_checklists SET ?, isian = ?, updated_by = ? WHERE id = ?', [await readHeader(body), isian, user.id, c.id])
  else await db.query('UPDATE order_custom_checklists SET isian = ?, catatan = ?, updated_by = ? WHERE id = ?', [isian, str(body.catatan, 5000) || null, user.id, c.id])
  await logActivity(request, user, { module: 'Order Custom', action: 'update', entity: { type: 'order_custom', id: c.id, label: c.nomor }, description: `Mengubah checklist order custom ${c.nomor}` })
  return NextResponse.json({ ok: true })
})

// Alur & paraf: serahkan (Marketing -> PPIC), verifikasi (PPIC -> Operasional), terima (Operasional -> selesai),
// kembalikan { alasan } (PPIC / Operasional -> draft Marketing, paraf dihapus), buka (selesai -> Operasional)
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireOrderCustom(user)
  const c = await loadChecklist(await checklistId(ctx))
  const body = await readJson(request)
  let to: keyof typeof OC_STATUS
  if (body.action === 'serahkan') {
    if (c.status !== 'draft' || !canMarketing(user)) fail(403, 'Diserahkan oleh Marketing dari tahap draft.')
    assertWajib(c.isian)
    to = 'ppic'
    await db.query("UPDATE order_custom_checklists SET status = 'ppic', marketing_oleh = ?, marketing_at = NOW(), alasan_kembali = NULL, updated_by = ? WHERE id = ?", [user.id, user.id, c.id])
    await notifyChecklist(await ppicUsers(), c, 'Checklist order custom menunggu verifikasi PPIC', 'ppic', user.id)
  } else if (body.action === 'verifikasi') {
    if (c.status !== 'ppic' || !canPpic(user)) fail(403, 'Diverifikasi oleh Divisi PPIC.')
    to = 'operasional'
    await db.query("UPDATE order_custom_checklists SET status = 'operasional', ppic_oleh = ?, ppic_at = NOW(), updated_by = ? WHERE id = ?", [user.id, user.id, c.id])
    await notifyChecklist(await operasionalUsers(), c, 'Checklist order custom diteruskan PPIC ke Operasional', 'operasional', user.id)
    await notifyChecklist([c.marketing_oleh ?? c.created_by], c, 'Checklist order custom diverifikasi PPIC', 'ppic-ok', user.id, true)
  } else if (body.action === 'terima') {
    if (c.status !== 'operasional' || !canOperasional(user)) fail(403, 'Diterima oleh Divisi Operasional.')
    to = 'selesai'
    await db.query("UPDATE order_custom_checklists SET status = 'selesai', operasional_oleh = ?, operasional_at = NOW(), updated_by = ? WHERE id = ?", [user.id, user.id, c.id])
    await notifyChecklist([c.marketing_oleh ?? c.created_by], c, 'Checklist order custom diterima Operasional (lengkap)', 'selesai-m', user.id, true)
    await notifyChecklist([c.ppic_oleh], c, 'Checklist order custom diterima Operasional (lengkap)', 'selesai-p', user.id)
  } else if (body.action === 'kembalikan') {
    if (!((c.status === 'ppic' && canPpic(user)) || (c.status === 'operasional' && canOperasional(user)))) fail(403, 'Dikembalikan oleh PPIC / Operasional pada tahapnya.')
    const alasan = str(body.alasan, 2000) || fail(400, 'Tulis data apa yang kurang / perlu diperbaiki.')
    to = 'draft'
    await db.query(
      "UPDATE order_custom_checklists SET status = 'draft', alasan_kembali = ?, marketing_oleh = NULL, marketing_at = NULL, ppic_oleh = NULL, ppic_at = NULL, updated_by = ? WHERE id = ?",
      [alasan, user.id, c.id],
    )
    await notifyChecklist([c.marketing_oleh ?? c.created_by], c, `Checklist order custom dikembalikan: ${String(alasan).slice(0, 80)}`, `kembali-${Date.now()}`, user.id, true)
  } else if (body.action === 'buka') {
    if (c.status !== 'selesai' || !(user.role.isAdmin || isManagement(user) || canOperasional(user))) fail(403, 'Dibuka lagi oleh Operasional / GM.')
    to = 'operasional'
    await db.query("UPDATE order_custom_checklists SET status = 'operasional', operasional_oleh = NULL, operasional_at = NULL, updated_by = ? WHERE id = ?", [user.id, c.id])
  } else return fail(400, 'Aksi tidak dikenal.')
  await logActivity(request, user, { module: 'Order Custom', action: 'update', entity: { type: 'order_custom', id: c.id, label: c.nomor }, description: `Checklist ${c.nomor}: ${OC_STATUS[c.status]} → ${OC_STATUS[to]}` })
  return NextResponse.json({ ok: true })
})

export const DELETE = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireOrderCustom(user)
  const c = await loadChecklist(await checklistId(ctx))
  if (!canDelete(user, c)) fail(403, 'Checklist yang sudah diserahkan hanya bisa dihapus GM / admin.')
  await softDelete({
    table: 'order_custom_checklists', id: c.id, modul: 'Checklist Order Custom', label: `${c.nomor} · ${c.nama_produk} · ${c.nama_customer}`, user,
    extra: [{ table: 'note_attachments', where: "owner_type = 'order_custom' AND owner_id = ?", params: [c.id] }],
  })
  await logActivity(request, user, { module: 'Order Custom', action: 'delete', entity: { type: 'order_custom', id: c.id, label: c.nomor }, description: `Menghapus checklist order custom ${c.nomor}` })
  return NextResponse.json({ ok: true })
})
