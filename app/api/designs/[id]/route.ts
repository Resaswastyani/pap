import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canSupervise } from '@/lib/marketing'
import { softDelete } from '@/lib/recycle-bin'
import { canAcceptDesign, canDeleteDesign, canRequest, isDesigner, loadDesign, loadLogs, requireRequestMenu } from '@/lib/requests'

type Ctx = { params: Promise<{ id: string }> }

export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireRequestMenu(user, 'desain')
  const item = await loadDesign(int((await ctx.params).id) ?? fail(404, 'Request desain tidak ditemukan.'), user)
  const [files] = await db.query<RowDataPacket[]>(
    `SELECT f.id, f.kind, f.versi, f.name, f.mime, f.size, f.created_at, u.name AS uploaded_by_name FROM design_request_files f
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
    },
  })
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
