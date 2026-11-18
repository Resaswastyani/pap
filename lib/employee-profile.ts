import type { RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'

type Row = RowDataPacket & Record<string, unknown>

// ---- Detail karyawan: rekap absensi, izin/cuti, riwayat training, hasil tes ----

export const TEST_JENIS = { papikostik: 'Papikostik', iq: 'Tes IQ', mata: 'Tes mata' } as const
export type TestJenis = keyof typeof TEST_JENIS

const ymd = (v: unknown) => (v instanceof Date ? new Date(v.getTime() + 7 * 3600e3).toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null)

// Rekap kehadiran setahun dari data mesin absensi + pengajuan izin/cuti yang disetujui di SIMPAP
export async function employeeAttendance(nip: string, tahun: number) {
  const [rows] = await db.query<Row[]>(
    `SELECT status, COUNT(*) AS hari, SUM(terlambat_menit) AS telat, SUM(pulang_cepat_menit) AS cepat, SUM(lembur_menit) AS lembur
     FROM attendance_days WHERE nip = ? AND tanggal BETWEEN ? AND ? GROUP BY status`,
    [nip, `${tahun}-01-01`, `${tahun}-12-31`],
  )
  const [[range]] = await db.query<Row[]>('SELECT MIN(tanggal) AS dari, MAX(tanggal) AS sampai FROM attendance_days WHERE nip = ? AND tanggal BETWEEN ? AND ?', [nip, `${tahun}-01-01`, `${tahun}-12-31`])
  const [leaves] = await db.query<Row[]>(
    `SELECT jenis, COUNT(*) AS kali, SUM(hari) AS hari FROM leave_requests
     WHERE nip = ? AND status = 'disetujui' AND tanggal_mulai BETWEEN ? AND ? GROUP BY jenis`,
    [nip, `${tahun}-01-01`, `${tahun}-12-31`],
  )
  const [years] = await db.query<Row[]>('SELECT DISTINCT YEAR(tanggal) AS y FROM attendance_days WHERE nip = ? ORDER BY y DESC', [nip])
  const status = Object.fromEntries(rows.map((r) => [String(r.status), Number(r.hari)]))
  const sum = (k: string) => rows.reduce((n, r) => n + Number(r[k] ?? 0), 0)
  return {
    tahun,
    tahun_ada: years.map((y) => Number(y.y)),
    dari: ymd(range?.dari), sampai: ymd(range?.sampai),
    status,
    hari_tercatat: rows.reduce((n, r) => n + Number(r.hari), 0),
    terlambat_menit: sum('telat'), pulang_cepat_menit: sum('cepat'), lembur_menit: sum('lembur'),
    pengajuan: leaves.map((l) => ({ jenis: String(l.jenis), kali: Number(l.kali), hari: Number(l.hari) })),
  }
}

// Modul training (peserta) + sesi jadwal training yang diikuti
export async function employeeTrainings(employeeId: number) {
  const [modules] = await db.query<Row[]>(
    `SELECT m.judul, m.kategori, p.status, p.tanggal, p.nilai FROM training_participants p JOIN training_modules m ON m.id = p.module_id
     WHERE p.employee_id = ? ORDER BY COALESCE(p.tanggal, p.updated_at) DESC`,
    [employeeId],
  )
  const [sessions] = await db.query<Row[]>(
    `SELECT s.judul, s.batch, s.tanggal, s.pemateri, s.status AS status_sesi, sp.kehadiran FROM training_session_participants sp JOIN training_sessions s ON s.id = sp.session_id
     WHERE sp.employee_id = ? ORDER BY s.tanggal DESC`,
    [employeeId],
  )
  return [
    ...modules.map((m) => ({ sumber: 'modul' as const, judul: String(m.judul), keterangan: m.kategori as string | null, tanggal: ymd(m.tanggal), status: String(m.status), nilai: m.nilai === null ? null : Number(m.nilai) })),
    ...sessions.map((s) => ({ sumber: 'jadwal' as const, judul: `${s.judul}${s.batch ? ` · ${s.batch}` : ''}`, keterangan: (s.pemateri as string | null) ? `Pemateri ${s.pemateri}` : null, tanggal: ymd(s.tanggal), status: s.status_sesi === 'batal' ? 'batal' : String(s.kehadiran), nilai: null })),
  ].sort((a, b) => (b.tanggal ?? '').localeCompare(a.tanggal ?? ''))
}

export async function employeeTests(employeeId: number) {
  const [rows] = await db.query<Row[]>(
    `SELECT t.id, t.jenis, t.tanggal, t.hasil, t.skor, t.catatan, t.lampiran_url, u.name AS oleh, t.updated_at
     FROM employee_tests t LEFT JOIN users u ON u.id = t.created_by WHERE t.employee_id = ? ORDER BY FIELD(t.jenis, 'papikostik', 'iq', 'mata'), t.tanggal DESC, t.id DESC`,
    [employeeId],
  )
  return rows.map((r) => ({ ...r, tanggal: ymd(r.tanggal), skor: r.skor === null ? null : Number(r.skor) }))
}

export function readTestInput(body: Record<string, unknown>) {
  const jenis = String(body.jenis ?? '') as TestJenis
  if (!(jenis in TEST_JENIS)) fail(400, 'Pilih jenis tes.')
  const hasil = str(body.hasil, 255) || fail(400, 'Hasil tes wajib diisi.')
  const tanggal = str(body.tanggal, 10)
  if (tanggal && !/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) fail(400, 'Tanggal tes tidak valid.')
  const skorText = str(body.skor, 10).replace(',', '.')
  const skor = skorText ? Number(skorText) : null
  if (skor !== null && (!Number.isFinite(skor) || skor < 0 || skor > 9999)) fail(400, 'Skor tidak valid.')
  const url = str(body.lampiran_url, 500)
  if (url && !/^https?:\/\//i.test(url)) fail(400, 'Link hasil tes harus diawali http:// atau https://')
  return { jenis, tanggal: tanggal || null, hasil, skor, catatan: str(body.catatan, 1000) || null, lampiran_url: url || null }
}
