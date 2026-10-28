import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { withNoteAttachments } from '@/lib/attachments'
import { db } from '@/lib/db'
import {
  canEditProspect, canSupervise, loadProspect, loadProspectProducts, readProspectProducts, saveProspectProducts, logActivity, parseDateTime, PROSPECT_STATUS, readProspectInput, requireMarketing,
  requireMarketingUser, serializeVisit, VISIT_SELECT, type ProspectStatus,
} from '@/lib/marketing'
import { notify } from '@/lib/notifications'
import { pushToUsers } from '@/lib/push'
import { softDelete } from '@/lib/recycle-bin'

type Ctx = { params: Promise<{ id: string }> }

// Detail prospek + timeline aktivitas + jadwal visit
export const GET = handle(async (_request: Request, { params }: Ctx) => {
  const user = await requireUser()
  requireMarketing(user, 'prospek')
  const prospect = await loadProspect(Number((await params).id), user)
  const [activities] = await db.query<RowDataPacket[]>(
    `SELECT a.id, a.jenis, a.hasil, a.status_from, a.status_to, a.visit_id, a.created_at, u.name AS user_name
     FROM marketing_activities a JOIN users u ON u.id = a.user_id WHERE a.prospect_id = ? ORDER BY a.id DESC LIMIT 200`,
    [prospect.id],
  )
  const notes = await withNoteAttachments('activity', activities as (RowDataPacket & { id: number })[])
  const [visits] = await db.query<RowDataPacket[]>(`${VISIT_SELECT} WHERE v.prospect_id = ? ORDER BY v.jadwal DESC`, [prospect.id])
  return NextResponse.json({ item: { ...prospect, products: await loadProspectProducts(prospect.id) }, activities: notes, visits: visits.map(serializeVisit), canEdit: canEditProspect(user, prospect as never), canSupervise: canSupervise(user) })
})

// Ubah data prospek, sales/maintenance, status, atau jadwal follow-up (field yang dikirim saja)
export const PATCH = handle(async (request: Request, { params }: Ctx) => {
  const user = await requireUser()
  requireMarketing(user, 'prospek')
  const prospect = await loadProspect(Number((await params).id), user)
  if (!canEditProspect(user, prospect as never)) fail(403, 'Anda hanya dapat mengubah prospek milik Anda.')
  const body = await readJson(request)
  const sets: string[] = []
  const values: unknown[] = []
  const notes: string[] = []
  const toNotify: { userId: number; title: string; type: 'prospek_baru' }[] = []

  if (body.nama_usaha !== undefined) {
    const input = readProspectInput(body)
    const products = readProspectProducts(body)
    if (products) {
      input.kebutuhan = products.map((p) => p.label).join('; ').slice(0, 500) || null
      await saveProspectProducts(prospect.id, products)
    }
    for (const [key, value] of Object.entries(input)) {
      sets.push(`${key} = ?`)
      values.push(value)
    }
  }

  if (body.assigned_to !== undefined) {
    if (!canSupervise(user) && int(body.assigned_to) !== user.id) fail(403, 'Hanya Lead / Marketing Digital yang dapat membagikan prospek ke sales lain.')
    const sales = await requireMarketingUser(body.assigned_to, 'Sales')
    if ((sales?.id ?? null) !== prospect.assigned_to) {
      sets.push('assigned_to = ?')
      values.push(sales?.id ?? null)
      notes.push(sales ? `Diserahkan ke sales ${sales.name}` : 'Sales dikosongkan')
      if (sales && sales.id !== user.id) toNotify.push({ userId: sales.id, type: 'prospek_baru', title: `Prospek baru untuk Anda: ${prospect.nama_usaha}` })
    }
  }

  let status = prospect.status as ProspectStatus
  if (body.status !== undefined) {
    const next = str(body.status, 30) as ProspectStatus
    if (!(next in PROSPECT_STATUS)) fail(400, 'Status prospek tidak valid.')
    if (next !== status) {
      if (next === 'gagal' && !str(body.alasan_gagal, 500)) fail(400, 'Isi alasan prospek gagal.')
      sets.push('status = ?', 'alasan_gagal = ?')
      values.push(next, next === 'gagal' ? str(body.alasan_gagal, 500) : null)
      await logActivity(db, { prospectId: prospect.id, userId: user.id, jenis: 'status', hasil: next === 'gagal' ? `Alasan: ${str(body.alasan_gagal, 500)}` : null, statusFrom: status, statusTo: next })
      status = next
    }
  }

  // Handover ke Marketing Maintenance (setelah order pertama)
  if (body.maintenance_to !== undefined) {
    const maint = await requireMarketingUser(body.maintenance_to, 'Marketing Maintenance')
    if ((maint?.id ?? null) !== prospect.maintenance_to) {
      sets.push('maintenance_to = ?')
      values.push(maint?.id ?? null)
      if (maint) {
        await logActivity(db, { prospectId: prospect.id, userId: user.id, jenis: 'handover', hasil: `Diserahkan ke Marketing Maintenance: ${maint.name}${str(body.catatan_handover, 1000) ? `. ${str(body.catatan_handover, 1000)}` : ''}` })
        if (maint.id !== user.id) toNotify.push({ userId: maint.id, type: 'prospek_baru', title: `Handover customer baru: ${prospect.nama_usaha}` })
      }
    }
  }

  if (body.next_followup_at !== undefined) {
    sets.push('next_followup_at = ?')
    values.push(parseDateTime(body.next_followup_at, 'Jadwal follow-up'))
  }

  if (sets.length) await db.query(`UPDATE prospects SET ${sets.join(', ')} WHERE id = ?`, [...values, prospect.id])
  for (const note of notes) await logActivity(db, { prospectId: prospect.id, userId: user.id, jenis: 'catatan', hasil: note })
  const created: number[] = []
  for (const n of toNotify) {
    created.push(...(await notify([n.userId], {
      type: n.type,
      title: n.title,
      body: [prospect.kontak_nama, prospect.kota, prospect.kebutuhan].filter(Boolean).join(' · ') || `Dari ${user.name}`,
      prospectId: prospect.id,
      refKey: `prospek:${prospect.id}:${n.userId}:${status}`,
    })))
  }
  await pushToUsers(created)
  return NextResponse.json({ ok: true })
})

export const DELETE = handle(async (_request: Request, { params }: Ctx) => {
  const user = await requireUser()
  requireMarketing(user, 'prospek')
  const prospect = await loadProspect(Number((await params).id), user)
  if (!canSupervise(user) && prospect.created_by !== user.id) fail(403, 'Hanya pembuat prospek atau Lead yang dapat menghapus.')
  // Lampiran catatan aktivitas (polimorfik, bukan FK) ikut masuk Data Terhapus
  await softDelete({
    table: 'prospects', id: prospect.id, modul: 'Prospek', user,
    extra: [{ table: 'note_attachments', where: "owner_type = 'activity' AND owner_id IN (SELECT id FROM marketing_activities WHERE prospect_id = ?)", params: [prospect.id] }],
  })
  return NextResponse.json({ ok: true })
})
