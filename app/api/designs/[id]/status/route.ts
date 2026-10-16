import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canSupervise, logActivity } from '@/lib/marketing'
import {
  DESIGN_STATUS, divisionUsers, isDesigner, loadDesign, logRequest, notifyRequest, publishDesignToProduct, requireRequestMenu,
  type DesignStatus,
} from '@/lib/requests'

type Ctx = { params: Promise<{ id: string }> }

// Alur: diajukan -(desainer ambil)-> dikerjakan -(unggah desain, kirim review)-> review
//       -(customer)-> disetujui (masuk Data Produk) | revisi -(desainer unggah versi baru)-> review
const NEXT: Record<DesignStatus, DesignStatus[]> = {
  diajukan: ['dikerjakan', 'batal'],
  dikerjakan: ['review', 'batal'],
  review: ['disetujui', 'revisi', 'batal'],
  revisi: ['review', 'batal'],
  disetujui: [],
  batal: [],
}

export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireRequestMenu(user, 'desain')
  const item = await loadDesign(int((await ctx.params).id) ?? fail(404, 'Request desain tidak ditemukan.'), user)
  const body = await readJson(request)
  const from = item.status as DesignStatus
  const to = str(body.status, 20) as DesignStatus
  if (!(to in DESIGN_STATUS) || !NEXT[from].includes(to)) fail(400, `Status tidak bisa diubah dari "${DESIGN_STATUS[from]}" ke "${DESIGN_STATUS[to] ?? to}".`)
  const catatan = str(body.catatan, 5000) || null
  const requester = item.requested_by === user.id || user.role.isAdmin || canSupervise(user)
  const designer = item.designer_id === user.id || user.role.isAdmin

  const sets: string[] = ['status = ?']
  const values: unknown[] = [to]
  let note = catatan
  let finalFileId: number | null = null
  if (to === 'dikerjakan') {
    if (!isDesigner(user)) fail(403, 'Hanya Tim Desain yang dapat mengambil request desain.')
    sets.push('designer_id = ?')
    values.push(user.id)
    note = `Dikerjakan oleh ${user.name}${catatan ? `. ${catatan}` : ''}`
  } else if (to === 'review') {
    if (!designer) fail(403, 'Hanya desainer yang mengerjakan yang dapat mengirim desain untuk review.')
    const [[file]] = await db.query<(RowDataPacket & { n: number })[]>(
      "SELECT COUNT(*) AS n FROM design_request_files WHERE design_id = ? AND kind = 'desain' AND versi = ?",
      [item.id, Number(item.revisi_ke) + 1],
    )
    if (!Number(file.n)) fail(400, `Unggah file desain versi ${Number(item.revisi_ke) + 1} terlebih dahulu.`)
    note = `Desain versi ${Number(item.revisi_ke) + 1} dikirim untuk review${catatan ? `. ${catatan}` : ''}`
  } else if (to === 'disetujui') {
    if (!requester) fail(403, 'Persetujuan customer dicatat oleh sales yang mengajukan.')
    const [[file]] = await db.query<(RowDataPacket & { id: number; name: string })[]>(
      `SELECT id, name FROM design_request_files WHERE design_id = ? AND kind = 'desain' AND (? IS NULL OR id = ?) ORDER BY versi DESC, id DESC LIMIT 1`,
      [item.id, int(body.file_id), int(body.file_id)],
    )
    finalFileId = file?.id ?? fail(400, 'Pilih file desain final.')
    sets.push('feedback = ?')
    values.push(catatan)
    note = `Desain final: ${file.name}${catatan ? `. ${catatan}` : ''}`
  } else if (to === 'revisi') {
    if (!requester) fail(403, 'Permintaan revisi dicatat oleh sales yang mengajukan.')
    if (!catatan) fail(400, 'Tulis revisi yang diminta customer.')
    sets.push('feedback = ?', 'revisi_ke = revisi_ke + 1')
    values.push(catatan)
  } else if (to === 'batal') {
    if (!requester && !designer) fail(403, 'Hanya sales pengaju atau desainer yang dapat membatalkan.')
    if (!catatan) fail(400, 'Tulis alasan pembatalan.')
  }

  await db.query(`UPDATE design_requests SET ${sets.join(', ')} WHERE id = ? AND status = ?`, [...values, item.id, from])
  let productId: number | null = null
  if (finalFileId) productId = await publishDesignToProduct(item as RowDataPacket, finalFileId, user.id)
  await logRequest({ designId: item.id, userId: user.id, from, to, catatan: note })
  if (item.prospect_id && ['review', 'disetujui', 'revisi'].includes(to)) {
    await logActivity(db, { prospectId: item.prospect_id, userId: user.id, jenis: 'catatan', hasil: `Desain ${item.nomor}: ${DESIGN_STATUS[to]}${note ? ` — ${note}` : ''}` })
  }

  const desainers = item.designer_id ? [item.designer_id] : await divisionUsers(['tim_desain'])
  const recipients: Record<DesignStatus, number[]> = {
    diajukan: desainers,
    dikerjakan: [item.requested_by],
    review: [item.requested_by],
    revisi: desainers,
    disetujui: desainers,
    batal: [item.requested_by, ...desainers],
  }
  await notifyRequest(recipients[to], user.id, {
    type: 'desain_update',
    title: `Desain ${item.nomor}: ${DESIGN_STATUS[to]}`,
    body: [item.judul, item.target_name, note].filter(Boolean).join(' · '),
    designId: item.id,
    refKey: `desain:${item.id}:${to}:${Date.now()}`,
  })
  return NextResponse.json({ ok: true, productId })
})
