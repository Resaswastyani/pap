// Jobdesk per jabatan (awal dari dokumen "IGP - HRD - Jobdesk & SOP") yang dipasang ke tiap karyawan.
// Semua yang punya menu Karyawan bisa melihat; HRD / GM / admin yang menambah, mengubah, dan memasang.
import type { RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'

type Row = RowDataPacket & Record<string, unknown>

const lines = (v: unknown) => (typeof v === 'string' ? v.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [])
const text = (v: unknown, max: number) => str(v, max).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join('\n') || null

export function readJobdesk(body: Record<string, unknown>) {
  const jabatan = str(body.jabatan, 150)
  if (!jabatan) fail(400, 'Nama jabatan wajib diisi.')
  return {
    jabatan, atasan_langsung: str(body.atasan_langsung, 150) || null, atasan_tak_langsung: str(body.atasan_tak_langsung, 150) || null, bawahan: str(body.bawahan, 255) || null,
    fungsi: text(body.fungsi, 5000), tugas: text(body.tugas, 20000), koordinasi: text(body.koordinasi, 5000),
  }
}

export const serializeJobdesk = (r: Row) => ({
  id: Number(r.id), jabatan: String(r.jabatan), atasan_langsung: (r.atasan_langsung as string) ?? null, atasan_tak_langsung: (r.atasan_tak_langsung as string) ?? null,
  bawahan: (r.bawahan as string) ?? null, fungsi: lines(r.fungsi), tugas: lines(r.tugas), koordinasi: lines(r.koordinasi), sumber: (r.sumber as string) ?? null,
})

export async function jobdeskOfNip(nip: string) {
  const [[r]] = await db.query<Row[]>('SELECT j.* FROM employee_jobdesks x JOIN job_descriptions j ON j.id = x.job_description_id WHERE x.nip = ?', [nip])
  return r ? serializeJobdesk(r) : null
}

// Semua jobdesk + karyawan aktif (dengan jobdesk yang terpasang)
export async function listJobdesks() {
  const [rows] = await db.query<Row[]>('SELECT * FROM job_descriptions ORDER BY jabatan')
  const [emps] = await db.query<Row[]>(
    `SELECT e.id, e.nip, e.nama, e.jabatan, e.divisi, x.job_description_id FROM employees e LEFT JOIN employee_jobdesks x ON x.nip = e.nip
     WHERE e.tgl_berhenti IS NULL AND COALESCE(e.status_karyawan, '') NOT LIKE '%resign%' ORDER BY e.nama`,
  )
  const employees = emps.map((e) => ({
    id: Number(e.id), nip: String(e.nip), nama: String(e.nama), jabatan: (e.jabatan as string) ?? null, divisi: (e.divisi as string) ?? null,
    job_description_id: e.job_description_id === null ? null : Number(e.job_description_id),
  }))
  return { items: rows.map(serializeJobdesk), employees }
}

// Pasang / lepas jobdesk karyawan
export async function assignJobdesk(body: Record<string, unknown>, userId: number) {
  const nip = str(body.nip, 30) || fail(400, 'Karyawan tidak valid.')
  const [[e]] = await db.query<Row[]>('SELECT nama FROM employees WHERE nip = ?', [nip])
  if (!e) fail(404, 'Karyawan tidak ditemukan.')
  if (body.job_description_id === null || body.job_description_id === '' || body.job_description_id === undefined) {
    await db.query('DELETE FROM employee_jobdesks WHERE nip = ?', [nip])
    return
  }
  const id = Number(body.job_description_id)
  const [[j]] = await db.query<Row[]>('SELECT id FROM job_descriptions WHERE id = ?', [Number.isInteger(id) ? id : 0])
  if (!j) fail(404, 'Jobdesk tidak ditemukan.')
  await db.query(
    'INSERT INTO employee_jobdesks (nip, job_description_id, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE job_description_id = VALUES(job_description_id), updated_by = VALUES(updated_by)',
    [nip, id, userId],
  )
}
