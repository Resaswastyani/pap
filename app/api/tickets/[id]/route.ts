import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { logActivity } from '@/lib/activity'
import { db } from '@/lib/db'
import { softDelete } from '@/lib/recycle-bin'
import { addTicketMessage, canHandleTickets, loadTicket, notifyTicket, readTicketInput, requireTickets, ticketHandlers, TICKET_STATUS, type TicketStatus } from '@/lib/tickets'

type Ctx = { params: Promise<{ id: string }> }
async function load(ctx: Ctx) {
  const user = await requireUser()
  requireTickets(user)
  const id = int((await ctx.params).id) ?? fail(404, 'Tiket tidak ditemukan.')
  return { user, ticket: await loadTicket(id, user) }
}

// Detail tiket + percakapan
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const { user, ticket } = await load(ctx)
  const [messages] = await db.query<RowDataPacket[]>(
    `SELECT m.id, m.jenis, m.pesan, m.created_at, m.user_id, u.name AS nama, (r.is_admin = 1 OR d.code = 'staff_it') AS penangan
     FROM ticket_messages m LEFT JOIN users u ON u.id = m.user_id LEFT JOIN roles r ON r.id = u.role_id LEFT JOIN divisions d ON d.id = u.division_id
     WHERE m.ticket_id = ? ORDER BY m.created_at, m.id`, [ticket.id],
  )
  const handler = canHandleTickets(user)
  const own = ticket.dilaporkan_oleh === user.id
  return NextResponse.json({
    item: ticket,
    messages: messages.map((m) => ({ ...m, penangan: !!m.penangan })),
    handlers: handler ? await ticketHandlers() : [],
    can: { handle: handler, edit: handler || (own && ticket.status === 'baru'), delete: handler || (own && ticket.status === 'baru'), reply: handler || own, close: own && !['selesai', 'ditolak'].includes(ticket.status), reopen: own && ['selesai', 'ditolak'].includes(ticket.status) },
  })
})

// Ubah isi tiket, status, atau penangan:
// { judul, kategori, modul, prioritas, deskripsi } | { status, catatan } | { ditangani_oleh }
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const { user, ticket } = await load(ctx)
  const body = await readJson(request)
  const handler = canHandleTickets(user)
  const own = ticket.dilaporkan_oleh === user.id

  if ('status' in body) {
    const status = String(body.status) as TicketStatus
    if (!(status in TICKET_STATUS)) fail(400, 'Status tidak valid.')
    // Pelapor hanya boleh menandai selesai atau membuka kembali tiketnya
    if (!handler && !(own && (status === 'selesai' || (status === 'baru' && ['selesai', 'ditolak'].includes(ticket.status))))) fail(403, 'Status tiket diubah oleh Staff IT.')
    if (status === ticket.status) return NextResponse.json({ ok: true })
    const catatan = String(body.catatan ?? '').trim().slice(0, 2000)
    await db.query(
      'UPDATE tickets SET status = ?, selesai_at = IF(? IN (\'selesai\', \'ditolak\'), NOW(), NULL), ditangani_oleh = COALESCE(ditangani_oleh, ?) WHERE id = ?',
      [status, status, handler && status === 'diproses' ? user.id : null, ticket.id],
    )
    const label = status === 'baru' && !handler ? 'Dibuka kembali' : TICKET_STATUS[status]
    await addTicketMessage(ticket.id, user.id, `Status: ${label}${catatan ? ` — ${catatan}` : ''}`, 'status')
    await logActivity(request, user, { module: 'Tiket Kendala', action: 'update', entity: null, description: `Tiket ${ticket.nomor}: status ${label}` })
    // Pelapor diberi tahu bila status diubah penangan; penangan diberi tahu bila pelapor menutup / membuka lagi
    if (handler && !own) await notifyTicket([ticket.dilaporkan_oleh ?? 0], ticket, `Tiket Anda: ${label}`, catatan || null, `status:${status}:${Date.now()}`)
    else await notifyTicket(ticket.ditangani_oleh ? [ticket.ditangani_oleh] : (await ticketHandlers()).map((h) => h.id).filter((h) => h !== user.id), ticket, `Tiket ${label.toLowerCase()} oleh pelapor`, catatan || null, `status:${status}:${Date.now()}`)
    return NextResponse.json({ ok: true })
  }

  if ('ditangani_oleh' in body) {
    if (!handler) fail(403, 'Penanganan tiket diatur oleh Staff IT.')
    const target = int(body.ditangani_oleh) || null
    if (target && !(await ticketHandlers()).some((h) => h.id === target)) fail(400, 'Penangan harus Super Admin / Staff IT.')
    await db.query('UPDATE tickets SET ditangani_oleh = ? WHERE id = ?', [target, ticket.id])
    const nama = target ? (await ticketHandlers()).find((h) => h.id === target)?.name : null
    await addTicketMessage(ticket.id, user.id, target ? `Ditangani oleh ${nama}` : 'Penangan dikosongkan', 'status')
    if (target && target !== user.id) await notifyTicket([target], ticket, 'Tiket diserahkan ke Anda', null, `assign:${target}:${Date.now()}`)
    return NextResponse.json({ ok: true })
  }

  if (!handler && !(own && ticket.status === 'baru')) fail(403, 'Tiket hanya bisa diubah selama masih berstatus Baru.')
  const v = readTicketInput(body)
  await db.query('UPDATE tickets SET judul = ?, kategori = ?, modul = ?, prioritas = ?, deskripsi = ? WHERE id = ?', [v.judul, v.kategori, v.modul, v.prioritas, v.deskripsi, ticket.id])
  await logActivity(request, user, { module: 'Tiket Kendala', action: 'update', entity: null, description: `Ubah tiket ${ticket.nomor}` })
  return NextResponse.json({ ok: true })
})

// Hapus tiket (masuk Data Terhapus): penangan, atau pelapor selama masih "Baru"
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const { user, ticket } = await load(ctx)
  if (!canHandleTickets(user) && !(ticket.dilaporkan_oleh === user.id && ticket.status === 'baru')) fail(403, 'Tiket yang sudah diproses tidak bisa dihapus pelapor.')
  await softDelete({ table: 'tickets', id: ticket.id, modul: 'Tiket Kendala', label: `${ticket.nomor} · ${ticket.judul}`, user, extra: [{ table: 'note_attachments', where: "owner_type = 'ticket' AND owner_id = ?", params: [ticket.id] }] })
  return NextResponse.json({ ok: true })
})
