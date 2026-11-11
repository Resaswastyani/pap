// Sesi training yang dikelola di SIMPAP (tambah / ubah / hapus), dengan peserta & kehadiran.
// Sesi dari spreadsheet jadwal (tab BATCH) bisa diimpor sekali menjadi sesi SIMPAP; setelah itu diubah di sini.
import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'

type Row = RowDataPacket & Record<string, unknown>
export const SESSION_STATUS = { terjadwal: 'Terjadwal', selesai: 'Selesai', batal: 'Batal' } as const
export const KEHADIRAN = { terdaftar: 'Terdaftar', hadir: 'Hadir', tidak_hadir: 'Tidak hadir' } as const
export type SessionParticipant = { nama: string; employee_id: number | null; kehadiran: keyof typeof KEHADIRAN }

const jam = (v: unknown, label: string) => {
  const s = str(v, 5)
  if (!s) return null
  return /^([01]\d|2[0-3])[:.][0-5]\d$/.test(s) ? s.replace('.', ':') : fail(400, `${label} tidak valid (format 13:00).`)
}

export function readSession(body: Record<string, unknown>) {
  const judul = str(body.judul, 200) || fail(400, 'Judul / materi training wajib diisi.')
  const tanggal = str(body.tanggal, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) fail(400, 'Tanggal training wajib diisi.')
  const status = String(body.status) in SESSION_STATUS ? String(body.status) : 'terjadwal'
  const peserta: SessionParticipant[] = (Array.isArray(body.peserta) ? body.peserta : []).slice(0, 300).map((p: Record<string, unknown>) => ({
    nama: str(p?.nama, 150), employee_id: Number(p?.employee_id) > 0 ? Number(p.employee_id) : null,
    kehadiran: (String(p?.kehadiran) in KEHADIRAN ? String(p.kehadiran) : 'terdaftar') as SessionParticipant['kehadiran'],
  })).filter((p: SessionParticipant) => p.nama)
  return {
    judul: judul!, tanggal, status, batch: str(body.batch, 60) || null, jam_mulai: jam(body.jam_mulai, 'Jam mulai'), jam_selesai: jam(body.jam_selesai, 'Jam selesai'),
    tempat: str(body.tempat, 150) || null, pemateri: str(body.pemateri, 200) || null, catatan: str(body.catatan, 1000) || null, peserta,
  }
}
export type SessionInput = ReturnType<typeof readSession>

export async function saveParticipants(conn: PoolConnection | typeof db, sessionId: number, peserta: SessionParticipant[]) {
  await conn.query('DELETE FROM training_session_participants WHERE session_id = ?', [sessionId])
  if (peserta.length) {
    await conn.query('INSERT INTO training_session_participants (session_id, nama, employee_id, kehadiran) VALUES ?', [peserta.map((p) => [sessionId, p.nama, p.employee_id, p.kehadiran])])
  }
}

export async function listSessions() {
  const [rows] = await db.query<Row[]>(
    `SELECT s.*, DATE_FORMAT(s.tanggal, '%Y-%m-%d') AS tanggal, u.name AS dibuat_oleh FROM training_sessions s LEFT JOIN users u ON u.id = s.created_by
     ORDER BY s.tanggal DESC, s.jam_mulai DESC, s.id DESC LIMIT 500`,
  )
  const [peserta] = rows.length
    ? await db.query<Row[]>('SELECT session_id, nama, employee_id, kehadiran FROM training_session_participants WHERE session_id IN (?) ORDER BY id', [rows.map((r) => r.id)])
    : [[] as Row[]]
  return rows.map((r) => ({
    id: Number(r.id), judul: String(r.judul), batch: (r.batch as string) ?? null, tanggal: String(r.tanggal), jam_mulai: (r.jam_mulai as string) ?? null, jam_selesai: (r.jam_selesai as string) ?? null,
    tempat: (r.tempat as string) ?? null, pemateri: (r.pemateri as string) ?? null, catatan: (r.catatan as string) ?? null, status: r.status as keyof typeof SESSION_STATUS,
    dibuat_oleh: (r.dibuat_oleh as string) ?? null,
    peserta: peserta.filter((p) => Number(p.session_id) === Number(r.id)).map((p) => ({ nama: String(p.nama), employee_id: p.employee_id === null ? null : Number(p.employee_id), kehadiran: p.kehadiran as SessionParticipant['kehadiran'] })),
  }))
}
