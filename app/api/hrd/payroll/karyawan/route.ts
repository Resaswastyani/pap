import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { canManageHr, canViewPayroll, nameKey } from '@/lib/hrd'
import { createPayroll, listPayrolls, PRIVATE_PAYROLL, seedPayrolls } from '@/lib/payroll'
import { db } from '@/lib/db'
import type { RowDataPacket } from 'mysql2'

// Pengaturan gaji per karyawan; daftar karyawan aktif yang belum punya pengaturan untuk form tambah
export const GET = handle(async () => {
  const user = await requireUser()
  if (!canViewPayroll(user)) fail(403, 'Anda tidak punya akses ke Grade & gaji (menu Karyawan).')
  const manage = canManageHr(user)
  let items = await listPayrolls()
  // Pertama kali dibuka HRD: isi otomatis dari Data Karyawan & spreadsheet kebijakan gaji
  if (!items.length && manage && (await seedPayrolls(user.id))) items = await listPayrolls()
  const [tanpa] = manage
    ? await db.query<(RowDataPacket & { nip: string; nama: string; jabatan: string | null })[]>(
      `SELECT e.nip, e.nama, e.jabatan FROM employees e LEFT JOIN employee_payrolls p ON p.nip = e.nip
       WHERE p.id IS NULL AND e.tgl_berhenti IS NULL ORDER BY e.nama`)
    : [[]]
  // Grade dari tab Grade operator (spreadsheet Data Grade), dicocokkan lewat nama
  const [grades] = await db.query<(RowDataPacket & { nama_key: string; grade: string | null })[]>('SELECT nama_key, grade FROM employee_grades WHERE grade IS NOT NULL')
  const gradeOf = new Map(grades.map((g) => [g.nama_key, g.grade]))
  const withGrade = items.map((p) => ({ ...p, grade: gradeOf.get(nameKey(p.nama)) ?? null }))
  return NextResponse.json({
    items: manage ? withGrade : withGrade.map((p) => Object.fromEntries(Object.entries(p).filter(([k]) => !PRIVATE_PAYROLL.includes(k)))),
    tanpa_pengaturan: tanpa,
    can: { manage },
  })
})

// { nip, ...isian } = tambah satu karyawan; { action: 'seed' } = lengkapi semua karyawan aktif dari Data Karyawan & spreadsheet
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  if (!canViewPayroll(user) || !canManageHr(user)) fail(403, 'Pengaturan gaji dikelola HRD.')
  const body = await readJson(request)
  if (body.action === 'seed') return NextResponse.json({ ditambah: await seedPayrolls(user.id) })
  await createPayroll(body, user.id)
  return NextResponse.json({ ok: true })
})
