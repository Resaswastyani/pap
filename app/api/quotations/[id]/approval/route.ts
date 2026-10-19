import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { notify } from '@/lib/notifications'
import { pushToUsers } from '@/lib/push'
import { canApproveQuotation, loadQuotation, QUOTATION_APPROVAL_REQUIRED, quotationApprovers, requireQuotation } from '@/lib/quotations'

type Ctx = { params: Promise<{ id: string }> }

// Persetujuan internal penawaran draft: { action: 'ajukan' | 'setujui' | 'tolak', catatan }
//   ajukan  : pembuat penawaran -> menunggu (Kepala Marketing & GM diberi tahu)
//   setujui : Kepala Marketing / GM -> disetujui (pembuat diberi tahu, penawaran boleh dikirim)
//   tolak   : Kepala Marketing / GM -> ditolak dengan alasan (pembuat memperbaiki lalu mengajukan ulang)
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireQuotation(user)
  if (!QUOTATION_APPROVAL_REQUIRED) fail(400, 'Persetujuan penawaran sedang tidak dipakai; penawaran bisa langsung dikirim.')
  const item = await loadQuotation(int((await ctx.params).id) ?? fail(404, 'Quotation tidak ditemukan.'), user)
  if (item.status !== 'draft') fail(400, 'Persetujuan hanya untuk penawaran berstatus Draft.')
  const body = await readJson(request)
  const action = str(body.action, 10)
  const catatan = str(body.catatan, 500) || null
  const total = `Rp ${Math.round(item.total).toLocaleString('id-ID')}`

  if (action === 'ajukan') {
    if (item.created_by !== user.id && !user.role.isAdmin) fail(403, 'Hanya pembuat penawaran yang dapat mengajukan persetujuan.')
    if (item.approval === 'menunggu') fail(400, 'Penawaran sudah diajukan dan sedang menunggu persetujuan.')
    if (item.approval === 'disetujui') fail(400, 'Penawaran sudah disetujui.')
    await db.query("UPDATE quotations SET approval = 'menunggu', approval_note = NULL, approved_by = NULL, approved_at = NULL WHERE id = ? AND status = 'draft'", [item.id])
    const approvers = (await quotationApprovers()).filter((id) => id !== user.id)
    await pushToUsers(await notify(approvers, {
      type: 'quotation',
      title: `Quotation ${item.nomor} menunggu persetujuan`,
      body: [item.kepada, total, `dari ${user.name}`, catatan].filter(Boolean).join(' · '),
      quotationId: item.id,
      refKey: `quotation:${item.id}:ajukan:${Date.now()}`,
    }))
    return NextResponse.json({ ok: true })
  }

  if (action !== 'setujui' && action !== 'tolak') fail(400, 'Aksi persetujuan tidak valid.')
  if (!canApproveQuotation(user)) fail(403, 'Penawaran hanya bisa disetujui Kepala Marketing atau General Manager.')
  if (item.approval === 'disetujui') fail(400, 'Penawaran sudah disetujui.')
  if (action === 'tolak') {
    if (item.approval !== 'menunggu') fail(400, 'Hanya penawaran yang sedang diajukan yang dapat ditolak.')
    if (!catatan) fail(400, 'Tulis alasan penolakan agar sales bisa memperbaiki penawaran.')
  }
  await db.query(
    'UPDATE quotations SET approval = ?, approval_note = ?, approved_by = ?, approved_at = NOW() WHERE id = ? AND status = ?',
    [action === 'setujui' ? 'disetujui' : 'ditolak', catatan, user.id, item.id, 'draft'],
  )
  if (item.created_by !== user.id) {
    await pushToUsers(await notify([item.created_by], {
      type: 'quotation',
      title: `Quotation ${item.nomor} ${action === 'setujui' ? 'disetujui, siap dikirim' : 'ditolak'}`,
      body: [item.kepada, total, `oleh ${user.name}`, catatan].filter(Boolean).join(' · '),
      quotationId: item.id,
      refKey: `quotation:${item.id}:${action}:${Date.now()}`,
    }))
  }
  return NextResponse.json({ ok: true })
})
