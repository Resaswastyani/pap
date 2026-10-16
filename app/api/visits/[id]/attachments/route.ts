import { NextResponse } from 'next/server'
import { fail, handle, int, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canSupervise, loadVisit, loadVisitAttachments, logActivity, readLink, requireMarketing, validVisitFile } from '@/lib/marketing'

type Ctx = { params: Promise<{ id: string }> }

const visitOf = async (ctx: Ctx, user: Awaited<ReturnType<typeof requireUser>>) => loadVisit(int((await ctx.params).id) ?? fail(404, 'Jadwal visit tidak ditemukan.'), user)

export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireMarketing(user, 'visit')
  const visit = await visitOf(ctx, user)
  return NextResponse.json({ items: await loadVisitAttachments(visit.id) })
})

// Tambah lampiran laporan: multipart "file", atau "url" (+ "name") untuk link.
// Oleh sales yang visit, pembuat jadwal, Lead, atau admin; bisa juga setelah check-in.
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireMarketing(user, 'visit')
  const visit = await visitOf(ctx, user)
  if (![visit.sales_id, visit.created_by].includes(user.id) && !canSupervise(user)) fail(403, 'Hanya sales yang visit yang dapat menambah lampiran.')
  if (visit.status === 'batal') fail(400, 'Visit ini sudah dibatalkan.')
  const form = await request.formData().catch(() => fail(400, 'Data upload tidak valid.'))
  const fileValue = form.get('file')
  if (fileValue instanceof File && fileValue.size) {
    const file = validVisitFile(fileValue)
    await db.query("INSERT INTO visit_attachments (visit_id, kind, name, mime, size, data, uploaded_by) VALUES (?, 'file', ?, ?, ?, ?, ?)", [
      visit.id, file.name.slice(0, 255), file.type, file.size, Buffer.from(await file.arrayBuffer()), user.id,
    ])
  } else {
    const link = readLink(form.get('url'), form.get('name'))
    await db.query("INSERT INTO visit_attachments (visit_id, kind, name, url, uploaded_by) VALUES (?, 'link', ?, ?, ?)", [visit.id, link.name, link.url, user.id])
    // Link yang ditambahkan setelah laporan dikirim ikut tercatat di riwayat prospek
    if (visit.checkin_at && str(form.get('log'), 5) === '1') {
      await logActivity(db, { prospectId: visit.prospect_id, customerId: visit.customer_id, visitId: visit.id, userId: user.id, jenis: 'catatan', hasil: `Lampiran visit: ${link.name} — ${link.url}` })
    }
  }
  return NextResponse.json({ items: await loadVisitAttachments(visit.id) }, { status: 201 })
})
