import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canEditHppParams, loadSettings } from '@/lib/hpp'
import { canApproveQuotation, canWriteQuotation, loadQuotation, loadQuotationItems, readQuotationInput, requireQuotation, saveQuotationItems } from '@/lib/quotations'

type Ctx = { params: Promise<{ id: string }> }
const quotationId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Quotation tidak ditemukan.')

export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireQuotation(user)
  const item = await loadQuotation(await quotationId(ctx), user)
  return NextResponse.json({
    item,
    items: await loadQuotationItems(item.id),
    doc: await loadSettings('doc.'),
    canEdit: item.status === 'draft' && (item.created_by === user.id || user.role.isAdmin || canEditHppParams(user)),
    canWrite: canWriteQuotation(user),
    canApprove: canApproveQuotation(user),
    isOwner: item.created_by === user.id,
  })
})

// Ubah penawaran yang masih draft (seluruh isi diganti)
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireQuotation(user)
  const item = await loadQuotation(await quotationId(ctx), user)
  if (item.status !== 'draft') fail(400, 'Hanya penawaran berstatus Draft yang dapat diubah. Buat revisi baru bila perlu.')
  if (item.created_by !== user.id && !user.role.isAdmin && !canEditHppParams(user)) fail(403, 'Hanya pembuat penawaran yang dapat mengubah.')
  const { header, items } = await readQuotationInput(await readJson(request), user)
  await db.query(
    `UPDATE quotations SET prospect_id = ?, customer_id = ?, kepada = ?, kontak = ?, telepon = ?, alamat = ?, tanggal = ?, berlaku_hari = ?, pakai_ppn = ?,
       ppn_persen = ?, subtotal = ?, ppn = ?, total = ?, syarat = ?, catatan = ? WHERE id = ?`,
    [header.prospect_id, header.customer_id, header.kepada, header.kontak, header.telepon, header.alamat, header.tanggal, header.berlaku_hari, header.pakai_ppn,
      header.ppn_persen, header.subtotal, header.ppn, header.total, header.syarat, header.catatan, item.id],
  )
  await saveQuotationItems(item.id, items)
  // Isi penawaran yang sudah disetujui berubah: harus disetujui ulang (kecuali yang mengubah penyetuju sendiri)
  if (item.approval === 'disetujui' && !canApproveQuotation(user)) {
    await db.query('UPDATE quotations SET approval = NULL, approval_note = NULL, approved_by = NULL, approved_at = NULL WHERE id = ?', [item.id])
  }
  return NextResponse.json({ ok: true })
})

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireQuotation(user)
  const item = await loadQuotation(await quotationId(ctx), user)
  if (item.status !== 'draft') fail(400, 'Penawaran yang sudah dikirim tidak dapat dihapus; gunakan Batal.')
  if (item.created_by !== user.id && !user.role.isAdmin) fail(403, 'Hanya pembuat penawaran yang dapat menghapus.')
  await db.query('DELETE FROM quotations WHERE id = ?', [item.id])
  return NextResponse.json({ ok: true })
})
