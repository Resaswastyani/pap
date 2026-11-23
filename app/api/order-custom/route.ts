import type { ResultSetHeader } from 'mysql2'
import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canMarketing, canOperasional, canPpic, listChecklists, loadChecklist, nextChecklistNumber, readHeader, readIsian, requireOrderCustom } from '@/lib/order-custom'

// Daftar Checklist Order Custom: ?status&prospect_id&q
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireOrderCustom(user)
  const data = await listChecklists(new URL(request.url).searchParams)
  return NextResponse.json({ ...data, can: { create: canMarketing(user), ppic: canPpic(user), operasional: canOperasional(user) } })
})

// Buat checklist baru (Marketing)
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireOrderCustom(user)
  if (!canMarketing(user)) fail(403, 'Checklist order custom dibuat oleh Marketing.')
  const body = await readJson(request)
  const header = await readHeader(body)
  const nomor = await nextChecklistNumber()
  const [res] = await db.query<ResultSetHeader>('INSERT INTO order_custom_checklists SET ?', [{
    ...header, nomor, isian: JSON.stringify(await readIsian(body.isian)), created_by: user.id, updated_by: user.id,
  }])
  const c = await loadChecklist(res.insertId)
  await logActivity(request, user, { module: 'Order Custom', action: 'create', entity: { type: 'order_custom', id: c.id, label: c.nomor }, description: `Checklist order custom ${c.nomor} · ${c.nama_produk} · ${c.nama_customer}` })
  return NextResponse.json({ ok: true, id: c.id, nomor })
})
