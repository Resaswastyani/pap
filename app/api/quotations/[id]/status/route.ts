import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { CLOSED_STATUS, logActivity, PIPELINE, type ProspectStatus } from '@/lib/marketing'
import { canApproveQuotation, canWriteQuotation, loadQuotation, QUOTATION_APPROVAL_REQUIRED, QUOTATION_STATUS, requireQuotation, type QuotationStatus } from '@/lib/quotations'

type Ctx = { params: Promise<{ id: string }> }

// draft -> dikirim -> diterima | ditolak ; draft/dikirim -> batal
// Bila QUOTATION_APPROVAL_REQUIRED: draft baru boleh dikirim setelah disetujui Kepala Marketing / GM (lihat ../approval); penyetuju boleh langsung mengirim.
const NEXT: Record<QuotationStatus, QuotationStatus[]> = { draft: ['dikirim', 'batal'], dikirim: ['diterima', 'ditolak', 'batal'], diterima: [], ditolak: [], batal: [] }

export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireQuotation(user)
  if (!canWriteQuotation(user)) fail(403, 'Status penawaran diubah oleh Marketing.')
  const item = await loadQuotation(int((await ctx.params).id) ?? 0, user)
  const body = await readJson(request)
  const to = str(body.status, 20) as QuotationStatus
  const from = item.status as QuotationStatus
  if (!(to in QUOTATION_STATUS) || !NEXT[from].includes(to)) fail(400, `Status tidak bisa diubah dari ${QUOTATION_STATUS[from]} ke ${QUOTATION_STATUS[to] ?? to}.`)
  const alasan = str(body.alasan, 500)
  if ((to === 'ditolak' || to === 'batal') && !alasan) fail(400, 'Isi alasan.')
  if (QUOTATION_APPROVAL_REQUIRED && to === 'dikirim' && item.approval !== 'disetujui') {
    if (!canApproveQuotation(user)) fail(403, 'Penawaran harus disetujui Kepala Marketing atau General Manager sebelum dikirim ke customer.')
    // Dikirim langsung oleh penyetuju = sekaligus disetujui
    await db.query("UPDATE quotations SET approval = 'disetujui', approved_by = ?, approved_at = NOW() WHERE id = ? AND status = 'draft'", [user.id, item.id])
  }
  await db.query(
    `UPDATE quotations SET status = ?, alasan = ?, sent_at = IF(? = 'dikirim', NOW(), sent_at), closed_at = IF(? IN ('diterima', 'ditolak'), NOW(), closed_at)
     WHERE id = ? AND status = ?`,
    [to, alasan || null, to, to, item.id, from],
  )
  // Prospek ikut bergerak di pipeline: penawaran dikirim -> "Penawaran", diterima -> "Order pertama"
  if (item.prospect_id) {
    const current = item.prospect_status as ProspectStatus
    const target: ProspectStatus | null = to === 'dikirim' ? 'penawaran' : to === 'diterima' ? 'order_pertama' : null
    const advance = target && !CLOSED_STATUS.includes(current) && PIPELINE.indexOf(current) < PIPELINE.indexOf(target)
    if (advance) await db.query('UPDATE prospects SET status = ? WHERE id = ?', [target, item.prospect_id])
    await logActivity(db, {
      prospectId: item.prospect_id, userId: user.id, jenis: 'catatan',
      hasil: `Quotation ${item.nomor} ${QUOTATION_STATUS[to].toLowerCase()} (total Rp ${Math.round(item.total).toLocaleString('id-ID')})${alasan ? `: ${alasan}` : ''}`,
      statusFrom: advance ? current : null, statusTo: advance ? target : null,
    })
  }
  return NextResponse.json({ ok: true })
})
