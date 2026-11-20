import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canSupervise } from '@/lib/marketing'
import { softDelete } from '@/lib/recycle-bin'
import { canAcceptDesign, canDeleteDesign, canEditDesign, canRequest, isDesigner, loadDesign, loadLogs, logRequest, readDesignBrief, requireRequestMenu } from '@/lib/requests'

type Ctx = { params: Promise<{ id: string }> }

export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireRequestMenu(user, 'desain')
  const item = await loadDesign(int((await ctx.params).id) ?? fail(404, 'Request desain tidak ditemukan.'), user)
  const [files] = await db.query<RowDataPacket[]>(
    `SELECT f.id, f.kind, f.versi, f.name, f.mime, f.url, f.size, f.created_at, u.name AS uploaded_by_name FROM design_request_files f
     JOIN users u ON u.id = f.uploaded_by WHERE f.design_id = ? ORDER BY f.kind, f.versi DESC, f.id DESC`,
    [item.id],
  )
  return NextResponse.json({
    item,
    files,
    logs: await loadLogs('design_id', item.id),
    roles: {
      canRequest: canRequest(user),
      designer: isDesigner(user),
      canAccept: canAcceptDesign(user),
      isRequester: item.requested_by === user.id || user.role.isAdmin || canSupervise(user),
      // Setelah diterima, semua staff Digital Marketing bisa mengunggah & mengirim desain
      isDesignerOf: isDesigner(user),
      canDelete: canDeleteDesign(user, item as never),
      canEdit: await canEditDesign(user, item as never),
    },
  })
})

// Ubah isi request: { judul, brief, deadline, ukuran, jenis_konten } (status & file tetap lewat alur masing-masing)
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireRequestMenu(user, 'desain')
  const item = await loadDesign(int((await ctx.params).id) ?? fail(404, 'Request desain tidak ditemukan.'), user)
  if (!(await canEditDesign(user, item as never))) {
    fail(403, ['disetujui', 'batal'].includes(String(item.status)) ? 'Request desain yang sudah disetujui / batal tidak bisa diubah.' : 'Request desain diubah oleh sales pengaju, Lead Marketing Development / Maintenance, atau admin.')
  }
  const body = await readJson(request)
  const brief = readDesignBrief(body)
  const konten = item.kategori === 'konten'
  const jenisKonten = konten && ['gambar', 'video', 'carousel', 'lainnya'].includes(String(body.jenis_konten)) ? String(body.jenis_konten) : item.jenis_konten ?? null
  const ukuran = konten ? str(body.ukuran, 150) || null : item.ukuran ?? null
  const changed = [
    brief.judul !== item.judul && 'judul', brief.brief !== item.brief && 'brief', (brief.deadline ?? null) !== (item.deadline ? String(item.deadline).slice(0, 10) : null) && 'deadline',
    konten && ukuran !== (item.ukuran ?? null) && 'ukuran', konten && jenisKonten !== (item.jenis_konten ?? null) && 'jenis konten',
  ].filter(Boolean)
  if (!changed.length) return NextResponse.json({ ok: true, changed: [] })
  await db.query('UPDATE design_requests SET judul = ?, brief = ?, deadline = ?, ukuran = ?, jenis_konten = ? WHERE id = ?', [brief.judul, brief.brief, brief.deadline, ukuran, jenisKonten, item.id])
  await logRequest({ designId: item.id, userId: user.id, catatan: `Request diubah oleh ${user.name}: ${changed.join(', ')}` })
  return NextResponse.json({ ok: true, changed })
})

// Hapus request desain beserta file & riwayatnya (dipindah ke Data Terhapus, bisa dipulihkan admin)
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireRequestMenu(user, 'desain')
  const item = await loadDesign(int((await ctx.params).id) ?? fail(404, 'Request desain tidak ditemukan.'), user)
  if (!canDeleteDesign(user, item as never)) {
    fail(403, item.status === 'disetujui' ? 'Desain yang sudah disetujui (masuk Data Produk) hanya dapat dihapus admin.' : 'Hanya sales pengaju, Lead, atau admin yang dapat menghapus request desain.')
  }
  await softDelete({
    table: 'design_requests', id: item.id, modul: 'Request Desain', label: `${item.nomor} · ${item.judul}`, user,
    // Lampiran catatan riwayat status (polimorfik, bukan FK)
    extra: [{ table: 'note_attachments', where: "owner_type = 'request_log' AND owner_id IN (SELECT id FROM request_logs WHERE design_id = ?)", params: [item.id] }],
  })
  return NextResponse.json({ ok: true })
})
