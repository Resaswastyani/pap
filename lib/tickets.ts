// Tiket Kendala Sistem SIMPAP. Penangan (Super Admin / admin / divisi Staff IT) melihat & mengubah semua tiket;
// pengguna lain hanya tiket yang ia ajukan (ubah / hapus selama masih "Baru", balas pesan, tandai selesai / buka lagi).
import type { RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'
import { notify } from '@/lib/notifications'
import { pushToUsers } from '@/lib/push'
import type { UserProfile } from '@/lib/users'

export const TICKET_JENIS = { sistem: 'Sistem SIMPAP', umum: 'IT umum' } as const
// Kategori per jenis: sistem = kendala aplikasi SIMPAP; umum = laptop / komputer, jaringan, printer, email, software lain
export const TICKET_KATEGORI = {
  error: 'Error / bug', akses: 'Akses & akun', data: 'Data salah / hilang', permintaan: 'Permintaan fitur',
  perangkat: 'Laptop / komputer rusak', jaringan: 'Jaringan / internet / WiFi', printer: 'Printer / scanner', email: 'Email & akun Google', software: 'Software / aplikasi lain', lainnya: 'Lainnya',
} as const
export const KATEGORI_JENIS: Record<keyof typeof TICKET_JENIS, (keyof typeof TICKET_KATEGORI)[]> = {
  sistem: ['error', 'akses', 'data', 'permintaan', 'lainnya'],
  umum: ['perangkat', 'jaringan', 'printer', 'email', 'software', 'lainnya'],
}
export const TICKET_PRIORITAS = { rendah: 'Rendah', normal: 'Normal', tinggi: 'Tinggi', darurat: 'Darurat' } as const
export const TICKET_STATUS = { baru: 'Baru', diproses: 'Diproses', menunggu_user: 'Menunggu pelapor', selesai: 'Selesai', ditolak: 'Ditolak' } as const
export type TicketStatus = keyof typeof TICKET_STATUS

export const canHandleTickets = (user: UserProfile) => user.role.isAdmin || user.division.code === 'staff_it'
export function requireTickets(user: UserProfile) {
  if (!user.menus.includes('tiket' as never)) fail(403, 'Anda tidak punya akses ke menu Tiket Kendala.')
}

export type TicketRow = RowDataPacket & {
  id: number; nomor: string; judul: string; jenis: keyof typeof TICKET_JENIS; kategori: keyof typeof TICKET_KATEGORI; modul: string | null; lokasi: string | null; prioritas: keyof typeof TICKET_PRIORITAS; deskripsi: string
  status: TicketStatus; dilaporkan_oleh: number | null; ditangani_oleh: number | null; selesai_at: string | null; created_at: string; updated_at: string
  pelapor: string | null; pelapor_divisi: string | null; penangan: string | null
}
const SELECT = `SELECT t.*, ur.name AS pelapor, d.name AS pelapor_divisi, uh.name AS penangan
  FROM tickets t LEFT JOIN users ur ON ur.id = t.dilaporkan_oleh LEFT JOIN divisions d ON d.id = ur.division_id LEFT JOIN users uh ON uh.id = t.ditangani_oleh`

// Tiket yang boleh dilihat user (penangan: semua; lainnya: tiket miliknya)
export async function loadTicket(id: number, user: UserProfile) {
  const [[t]] = await db.query<TicketRow[]>(`${SELECT} WHERE t.id = ?`, [id])
  if (!t || (!canHandleTickets(user) && t.dilaporkan_oleh !== user.id)) fail(404, 'Tiket tidak ditemukan.')
  return t!
}
export const ticketSelect = SELECT

export function readTicketInput(body: Record<string, unknown>) {
  const judul = str(body.judul, 200) || fail(400, 'Judul kendala wajib diisi.')
  const deskripsi = str(body.deskripsi, 10000) || fail(400, 'Jelaskan kendalanya.')
  const jenis = body.jenis === 'umum' ? 'umum' : 'sistem'
  const raw = String(body.kategori) as keyof typeof TICKET_KATEGORI
  const kategori = KATEGORI_JENIS[jenis].includes(raw) ? raw : KATEGORI_JENIS[jenis][0]
  const prioritas = String(body.prioritas) in TICKET_PRIORITAS ? String(body.prioritas) : 'normal'
  return { judul: judul!, deskripsi: deskripsi!, jenis, kategori, prioritas, modul: jenis === 'sistem' ? str(body.modul, 80) || null : null, lokasi: jenis === 'umum' ? str(body.lokasi, 150) || null : null }
}

export async function nextTicketNumber() {
  const year = new Date(Date.now() + 7 * 3600e3).getUTCFullYear()
  const prefix = `TKT-${year}-`
  const [[r]] = await db.query<RowDataPacket[]>('SELECT MAX(CAST(SUBSTRING(nomor, ?) AS UNSIGNED)) AS n FROM tickets WHERE nomor LIKE ?', [prefix.length + 1, `${prefix}%`])
  return `${prefix}${String(Number(r?.n ?? 0) + 1).padStart(4, '0')}`
}

// Penangan tiket aktif (untuk notifikasi & pilihan "ditangani oleh")
export async function ticketHandlers() {
  const [rows] = await db.query<(RowDataPacket & { id: number; name: string })[]>(
    `SELECT u.id, u.name FROM users u JOIN roles r ON r.id = u.role_id JOIN divisions d ON d.id = u.division_id
     WHERE u.is_active = 1 AND (r.is_admin = 1 OR d.code = 'staff_it') ORDER BY u.name`,
  )
  return rows.map((r) => ({ id: Number(r.id), name: String(r.name) }))
}

// Notifikasi tiket (dibuka ke menu Tiket Kendala pada tiket itu)
export async function notifyTicket(userIds: number[], ticket: { id: number; nomor: string; judul: string }, title: string, body: string | null, key: string) {
  const users = userIds.filter(Boolean)
  if (!users.length) return
  await pushToUsers(await notify(users, { type: 'tiket', title, body: `${ticket.nomor} · ${ticket.judul}${body ? ` — ${body}` : ''}`, page: 'Tiket Kendala', pageId: ticket.id, refKey: `tiket:${ticket.id}:${key}` }))
}

export async function addTicketMessage(ticketId: number, userId: number, pesan: string, jenis: 'komentar' | 'status' = 'komentar') {
  await db.query('INSERT INTO ticket_messages (ticket_id, user_id, jenis, pesan) VALUES (?, ?, ?, ?)', [ticketId, userId, jenis, pesan.slice(0, 10000)])
}
