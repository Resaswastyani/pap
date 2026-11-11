import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { handle, readJson, requireUser, str } from '@/lib/api'
import { logActivity } from '@/lib/activity'
import { db } from '@/lib/db'
import { canHandleTickets, nextTicketNumber, notifyTicket, readTicketInput, requireTickets, ticketHandlers, ticketSelect, TICKET_STATUS, type TicketRow } from '@/lib/tickets'

// Daftar tiket: penangan melihat semua, pengguna lain tiket miliknya. ?status=&q=&lingkup=semua|saya|belum
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireTickets(user)
  const handler = canHandleTickets(user)
  const p = new URL(request.url).searchParams
  const where: string[] = []
  const args: unknown[] = []
  if (!handler) where.push('t.dilaporkan_oleh = ?'), args.push(user.id)
  const status = p.get('status')
  if (status === 'aktif') where.push("t.status IN ('baru', 'diproses', 'menunggu_user')")
  else if (status && status in TICKET_STATUS) where.push('t.status = ?'), args.push(status)
  const lingkup = p.get('lingkup')
  if (handler && lingkup === 'saya') where.push('t.ditangani_oleh = ?'), args.push(user.id)
  if (handler && lingkup === 'belum') where.push('t.ditangani_oleh IS NULL')
  const jenis = p.get('jenis')
  if (jenis === 'sistem' || jenis === 'umum') where.push('t.jenis = ?'), args.push(jenis)
  const q = str(p.get('q'), 100)
  if (q) where.push('(t.nomor LIKE ? OR t.judul LIKE ? OR t.modul LIKE ? OR t.lokasi LIKE ? OR ur.name LIKE ?)'), args.push(...Array(5).fill(`%${q}%`))
  const [items] = await db.query<(TicketRow & { pesan: number })[]>(
    `${ticketSelect.replace('SELECT t.*,', 'SELECT t.*, (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id AND m.jenis = \'komentar\') AS pesan,')}
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY FIELD(t.status, 'baru', 'diproses', 'menunggu_user', 'selesai', 'ditolak'), FIELD(t.prioritas, 'darurat', 'tinggi', 'normal', 'rendah'), t.created_at DESC LIMIT 500`,
    args,
  )
  const [[s]] = await db.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(status = 'baru'), 0) AS baru, COALESCE(SUM(status = 'diproses'), 0) AS diproses, COALESCE(SUM(status = 'menunggu_user'), 0) AS menunggu_user,
       COALESCE(SUM(status = 'selesai' AND selesai_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')), 0) AS selesai_bulan_ini, COUNT(*) AS total
     FROM tickets ${handler ? '' : 'WHERE dilaporkan_oleh = ?'}`,
    handler ? [] : [user.id],
  )
  return NextResponse.json({
    items: items.map((t) => ({ ...t, pesan: Number(t.pesan) })),
    stats: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Number(v)])),
    handlers: handler ? await ticketHandlers() : [],
    can: { handle: handler },
  })
})

// Ajukan tiket baru
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireTickets(user)
  const v = readTicketInput(await readJson(request))
  let id = 0
  let nomor = ''
  for (let attempt = 0; attempt < 3 && !id; attempt++) {
    nomor = await nextTicketNumber()
    try {
      const [res] = await db.query<ResultSetHeader>(
        'INSERT INTO tickets (nomor, judul, jenis, kategori, modul, lokasi, prioritas, deskripsi, dilaporkan_oleh) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [nomor, v.judul, v.jenis, v.kategori, v.modul, v.lokasi, v.prioritas, v.deskripsi, user.id],
      )
      id = res.insertId
    } catch (error) {
      if ((error as { code?: string }).code !== 'ER_DUP_ENTRY') throw error
    }
  }
  await logActivity(request, user, { module: 'Tiket Kendala', action: 'create', entity: null, description: `Tiket ${nomor}: ${v.judul}` })
  // Semua penangan diberi tahu (kecuali pelapor sendiri)
  const handlers = (await ticketHandlers()).map((h) => h.id).filter((h) => h !== user.id)
  await notifyTicket(handlers, { id, nomor, judul: v.judul }, `Tiket ${v.jenis === 'umum' ? 'kendala IT' : 'kendala SIMPAP'} baru dari ${user.name}`, v.prioritas === 'darurat' ? 'prioritas DARURAT' : v.modul ?? v.lokasi, 'baru')
  return NextResponse.json({ id, nomor }, { status: 201 })
})
