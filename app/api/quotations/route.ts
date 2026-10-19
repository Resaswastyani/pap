import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { logActivity } from '@/lib/marketing'
import { canApproveQuotation, canWriteQuotation, QUOTATION_APPROVAL_REQUIRED, QUOTATION_SELECT, QUOTATION_STATUS, quotationScope, readQuotationInput, requireQuotation, saveQuotationItems, seesAllQuotations, serializeQuotation } from '@/lib/quotations'
import { setNomor } from '@/lib/requests'

export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireQuotation(user)
  const url = new URL(request.url)
  const scope = quotationScope(user)
  const where = [scope.sql]
  const params: (string | number)[] = [...scope.params]
  const q = str(url.searchParams.get('q'), 100)
  if (q) {
    where.push('(q.nomor LIKE ? OR q.kepada LIKE ? OR q.kontak LIKE ?)')
    params.push(`%${q}%`, `%${q}%`, `%${q}%`)
  }
  const prospect = int(url.searchParams.get('prospect'))
  if (prospect) {
    where.push('q.prospect_id = ?')
    params.push(prospect)
  }
  const [summary] = await db.query<(RowDataPacket & { status: string; n: number; total: string })[]>(
    `SELECT q.status, COUNT(*) AS n, SUM(q.total) AS total FROM quotations q WHERE ${where.join(' AND ')} GROUP BY q.status`,
    params,
  )
  const [[pending]] = await db.query<(RowDataPacket & { n: number })[]>(
    `SELECT COUNT(*) AS n FROM quotations q WHERE ${where.join(' AND ')} AND q.status = 'draft' AND q.approval = 'menunggu'`,
    params,
  )
  const status = url.searchParams.get('status')
  if (status === 'persetujuan') {
    where.push("q.status = 'draft' AND q.approval = 'menunggu'")
  } else if (status && status in QUOTATION_STATUS) {
    where.push('q.status = ?')
    params.push(status)
  }
  const [items] = await db.query<RowDataPacket[]>(`${QUOTATION_SELECT} WHERE ${where.join(' AND ')} ORDER BY q.tanggal DESC, q.id DESC LIMIT 300`, params)
  return NextResponse.json({
    items: items.map(serializeQuotation),
    summary: Object.fromEntries(summary.map((r) => [r.status, { n: Number(r.n), total: Number(r.total ?? 0) }])),
    pendingApproval: Number(pending.n),
    canWrite: canWriteQuotation(user),
    canApprove: canApproveQuotation(user),
    approvalRequired: QUOTATION_APPROVAL_REQUIRED,
    seesAll: seesAllQuotations(user),
  })
})

export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireQuotation(user)
  if (!canWriteQuotation(user)) fail(403, 'Quotation dibuat oleh Marketing.')
  const { header, items } = await readQuotationInput(await readJson(request), user)
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO quotations (prospect_id, customer_id, kepada, kontak, telepon, alamat, tanggal, berlaku_hari, pakai_ppn, ppn_persen, subtotal, ppn, total, syarat, catatan, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [header.prospect_id, header.customer_id, header.kepada, header.kontak, header.telepon, header.alamat, header.tanggal, header.berlaku_hari, header.pakai_ppn,
      header.ppn_persen, header.subtotal, header.ppn, header.total, header.syarat, header.catatan, user.id],
  )
  const id = result.insertId
  await saveQuotationItems(id, items)
  const nomor = await setNomor('quotations', 'QT', id)
  if (header.prospect_id) await logActivity(db, { prospectId: header.prospect_id, userId: user.id, jenis: 'catatan', hasil: `Quotation ${nomor} dibuat (draft)` })
  return NextResponse.json({ id, nomor }, { status: 201 })
})
