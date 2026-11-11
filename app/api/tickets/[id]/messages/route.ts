import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { addTicketMessage, canHandleTickets, loadTicket, notifyTicket, requireTickets, ticketHandlers } from '@/lib/tickets'

type Ctx = { params: Promise<{ id: string }> }

// Balas percakapan tiket: { pesan }
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTickets(user)
  const id = int((await ctx.params).id) ?? fail(404, 'Tiket tidak ditemukan.')
  const ticket = await loadTicket(id, user)
  const pesan = str((await readJson(request)).pesan, 10000) || fail(400, 'Tulis pesan dulu.')
  const handler = canHandleTickets(user)
  await addTicketMessage(ticket.id, user.id, pesan!)
  // Balasan penangan pertama: tiket otomatis "Diproses" dan dipegang penangan itu
  if (handler && ticket.status === 'baru') await db.query("UPDATE tickets SET status = 'diproses', ditangani_oleh = COALESCE(ditangani_oleh, ?) WHERE id = ?", [user.id, ticket.id])
  else await db.query('UPDATE tickets SET updated_at = NOW() WHERE id = ?', [ticket.id])
  const preview = pesan!.slice(0, 140)
  if (handler && ticket.dilaporkan_oleh !== user.id) await notifyTicket([ticket.dilaporkan_oleh ?? 0], ticket, `Balasan Staff IT: ${user.name}`, preview, `msg:${Date.now()}`)
  else await notifyTicket(ticket.ditangani_oleh ? [ticket.ditangani_oleh] : (await ticketHandlers()).map((h) => h.id).filter((h) => h !== user.id), ticket, `Balasan pelapor: ${user.name}`, preview, `msg:${Date.now()}`)
  return NextResponse.json({ ok: true }, { status: 201 })
})
