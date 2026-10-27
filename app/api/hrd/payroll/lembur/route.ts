import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageHr, canViewPayroll } from '@/lib/hrd'
import { loadSettings, periodRange } from '@/lib/payroll'
import { readOvertime } from '@/lib/payroll-overtime'

// Lembur variabel input manual per periode cut off: ?periode=YYYY-MM
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  if (!canViewPayroll(user)) fail(403, 'Anda tidak punya akses ke Grade & gaji (menu Karyawan).')
  const periode = new URL(request.url).searchParams.get('periode') ?? ''
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periode)) fail(400, 'Periode tidak valid.')
  const range = periodRange(periode, (await loadSettings()).cutoff_tanggal)
  const [items] = await db.query<RowDataPacket[]>(
    `SELECT o.id, o.nip, COALESCE(e.nama, o.nip) AS nama, e.jabatan, DATE_FORMAT(o.tanggal, '%Y-%m-%d') AS tanggal, o.jam, o.hari, o.mode, o.keterangan,
       u.name AS created_name, o.updated_at
     FROM overtime_entries o LEFT JOIN employees e ON e.nip = o.nip LEFT JOIN users u ON u.id = o.created_by
     WHERE o.tanggal BETWEEN ? AND ? ORDER BY o.tanggal DESC, nama`,
    [range.dari, range.sampai],
  )
  const [employees] = await db.query<RowDataPacket[]>(
    `SELECT e.nip, e.nama, e.jabatan FROM employees e JOIN employee_payrolls p ON p.nip = e.nip WHERE e.tgl_berhenti IS NULL OR e.tgl_berhenti >= ? ORDER BY e.nama`,
    [range.dari],
  )
  return NextResponse.json({ periode, ...range, items: items.map((i) => ({ ...i, jam: Number(i.jam) })), employees, can: { manage: canManageHr(user) } })
})

// Tambah lembur variabel manual: { nip, tanggal, jam, hari: kerja|libur, mode: tambah|ganti, keterangan }
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  if (!canViewPayroll(user) || !canManageHr(user)) fail(403, 'Lembur manual diisi oleh HRD.')
  const v = await readOvertime(await readJson(request))
  const [res] = await db.query<ResultSetHeader>(
    'INSERT INTO overtime_entries (nip, tanggal, jam, hari, mode, keterangan, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [v.nip, v.tanggal, v.jam, v.hari, v.mode, v.keterangan, user.id],
  )
  return NextResponse.json({ id: res.insertId })
})
