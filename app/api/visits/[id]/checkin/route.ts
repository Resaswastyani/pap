import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { CLOSED_STATUS, loadVisit, logActivity, parseDateTime, PIPELINE, PROSPECT_STATUS, requireMarketing, VISIT_PHOTO_MAX_BYTES, readLink, type ProspectStatus } from '@/lib/marketing'

type Ctx = { params: Promise<{ id: string }> }

// Check-in di lokasi + laporan hasil visit: koordinat GPS dari browser, foto dari kamera (data URL JPEG),
// hasil kunjungan, dan follow-up berikutnya. Hanya sales yang dijadwalkan (atau admin).
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireMarketing(user, 'visit')
  const visit = await loadVisit(int((await ctx.params).id) ?? 0, user)
  if (!visit.sales_ids.includes(user.id) && !user.role.isAdmin) fail(403, 'Hanya sales yang dijadwalkan yang dapat check-in.')
  if (visit.status !== 'terjadwal') fail(400, 'Visit ini sudah dilaporkan.')
  const body = await readJson(request)

  const status = body.status === 'tidak_bertemu' ? 'tidak_bertemu' : 'selesai'
  // Laporan bisa berupa catatan, link, dan/atau file (file diunggah setelah check-in; fileCount = jumlah yang akan diunggah)
  const hasil = str(body.hasil, 5000)
  const links = (Array.isArray(body.links) ? body.links : []).slice(0, 10).map((l: { url?: unknown; name?: unknown }) => readLink(l?.url, l?.name))
  const fileCount = Math.max(0, int(body.file_count) ?? 0)
  if (!hasil && !links.length && !fileCount) fail(400, 'Isi laporan hasil kunjungan: catatan, link, atau file.')
  const lat = Number(body.lat)
  const lng = Number(body.lng)
  const hasLocation = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)
  if (visit.jenis === 'visit' && !hasLocation) fail(400, 'Lokasi GPS wajib untuk visit lokasi. Izinkan akses lokasi di browser.')
  const accuracy = hasLocation && Number.isFinite(Number(body.accuracy)) ? Math.min(100000, Math.round(Number(body.accuracy))) : null

  let foto: Buffer | null = null
  let fotoMime: string | null = null
  const dataUrl = typeof body.foto === 'string' ? body.foto : ''
  if (dataUrl) {
    const m = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/)
    if (!m) fail(400, 'Format foto tidak valid.')
    foto = Buffer.from(m![2], 'base64')
    fotoMime = m![1]
    if (foto.length > VISIT_PHOTO_MAX_BYTES) fail(400, 'Ukuran foto terlalu besar (maks 2 MB).')
  }
  if (visit.jenis === 'visit' && !foto) fail(400, 'Foto bukti kunjungan wajib untuk visit lokasi.')
  const nextFollowup = parseDateTime(body.next_followup_at, 'Jadwal follow-up')

  await db.query(
    `UPDATE visits SET status = ?, checkin_at = NOW(), checkin_lat = ?, checkin_lng = ?, checkin_accuracy = ?, foto = ?, foto_mime = ?, hasil = ?, next_followup_at = ?
     WHERE id = ? AND status = 'terjadwal'`,
    [status, hasLocation ? lat : null, hasLocation ? lng : null, accuracy, foto, fotoMime, hasil || null, nextFollowup, visit.id],
  )
  for (const link of links) {
    await db.query("INSERT INTO visit_attachments (visit_id, kind, name, url, uploaded_by) VALUES (?, 'link', ?, ?, ?)", [visit.id, link.name, link.url, user.id])
  }

  // Prospek: status naik ke "Sudah visit" (atau status pilihan sales), follow-up berikutnya ikut tersimpan
  let statusFrom: string | null = null
  let statusTo: string | null = null
  if (visit.prospect_id) {
    const current = visit.prospect_status as ProspectStatus
    let next = current
    const chosen = str(body.prospect_status, 30) as ProspectStatus
    if (chosen && chosen in PROSPECT_STATUS && chosen !== 'gagal') next = chosen
    else if (status === 'selesai' && !CLOSED_STATUS.includes(current) && PIPELINE.indexOf(current) < PIPELINE.indexOf('visit')) next = 'visit'
    if (next !== current) {
      statusFrom = current
      statusTo = next
    }
    await db.query('UPDATE prospects SET status = ?, next_followup_at = COALESCE(?, next_followup_at) WHERE id = ?', [next, nextFollowup, visit.prospect_id])
  }
  await logActivity(db, {
    prospectId: visit.prospect_id, customerId: visit.customer_id, visitId: visit.id, userId: user.id, jenis: 'visit',
    hasil: [
      `${status === 'tidak_bertemu' ? 'Visit — tidak bertemu' : 'Visit selesai'}: ${hasil || 'laporan berupa lampiran'}`,
      ...links.map((l) => `Link: ${l.name} — ${l.url}`),
      fileCount ? `${fileCount} file lampiran` : '',
    ].filter(Boolean).join('\n'),
    statusFrom, statusTo,
  })
  return NextResponse.json({ ok: true })
})
