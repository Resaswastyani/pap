import { NextResponse } from 'next/server'
import type { RowDataPacket } from 'mysql2'
import { fail, handle, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageHr, canViewEmployees, canViewPayroll } from '@/lib/hrd'

type Row = RowDataPacket & Record<string, unknown>

// Daftar karyawan dari spreadsheet Data Karyawan (+ grade & gaji bila boleh melihat penggajian)
export const GET = handle(async () => {
  const user = await requireUser()
  if (!canViewEmployees(user)) fail(403, 'Anda tidak punya akses ke menu Karyawan.')
  const payroll = canViewPayroll(user)
  const [rows] = await db.query<Row[]>(
    `SELECT e.id, e.nip, e.nama, e.email, e.handphone, e.jenis_kelamin, e.tgl_masuk, e.departemen, e.divisi, e.jabatan, e.level_posisi,
       e.status_karyawan, e.tgl_akhir_percobaan, e.tgl_berhenti, e.nama_atasan, e.masa_kerja, e.hari_kerja
       ${payroll ? ', g.grade AS grade_operator, g.rata_rata AS nilai_grade, s.grade AS grade_gaji, s.upah_harian, s.total_terima' : ''}
     FROM employees e
     ${payroll ? `LEFT JOIN employee_grades g ON g.nama_key = e.nama_key
       LEFT JOIN employee_salaries s ON s.nama_key = e.nama_key` : ''}
     ORDER BY e.tgl_berhenti IS NOT NULL, e.nama`,
  )
  const [[synced]] = await db.query<Row[]>("SELECT value FROM app_settings WHERE `key` = 'hrd.karyawan_synced_at'")
  return NextResponse.json({
    items: rows.map((r) => ({ ...r, nilai_grade: r.nilai_grade === undefined || r.nilai_grade === null ? null : Number(r.nilai_grade), upah_harian: r.upah_harian == null ? null : Number(r.upah_harian), total_terima: r.total_terima == null ? null : Number(r.total_terima) })),
    synced_at: synced?.value ?? null,
    can: { manage: canManageHr(user), payroll },
  })
})
