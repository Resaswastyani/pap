import { NextResponse } from 'next/server'
import type { RowDataPacket } from 'mysql2'
import { fail, handle, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageHr, canViewPayroll } from '@/lib/hrd'

type Row = RowDataPacket & Record<string, unknown>
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

// Grade operator + kebijakan gaji dari spreadsheet Grade & Gaji, dicocokkan ke Data Karyawan lewat nama
export const GET = handle(async () => {
  const user = await requireUser()
  if (!canViewPayroll(user)) fail(403, 'Anda tidak punya akses ke menu Grade.')
  const manage = canManageHr(user)
  const [grades] = await db.query<Row[]>(
    `SELECT g.id, g.no, g.nama, g.skor, g.rata_rata, g.grade, e.id AS employee_id, e.nip, e.jabatan, e.status_karyawan
     FROM employee_grades g LEFT JOIN employees e ON e.id = (SELECT id FROM employees x WHERE x.nama_key = g.nama_key ORDER BY x.tgl_berhenti IS NOT NULL, x.id DESC LIMIT 1)
     ORDER BY g.no, g.id`,
  )
  const [salaries] = await db.query<Row[]>(
    `SELECT s.*, e.id AS employee_id, e.nip, e.jabatan, e.status_karyawan
     FROM employee_salaries s LEFT JOIN employees e ON e.id = (SELECT id FROM employees x WHERE x.nama_key = s.nama_key ORDER BY x.tgl_berhenti IS NOT NULL, x.id DESC LIMIT 1)
     ORDER BY s.no, s.id`,
  )
  const [[meta]] = await db.query<Row[]>("SELECT value FROM app_settings WHERE `key` = 'hrd.grade_meta'")
  const MONEY = ['upah_harian', 'nominal_grade', 'upah_harian_total', 'upah_bulanan', 'kenaikan_harian', 'kenaikan_bulanan', 'kenaikan_persen', 'tunjangan', 'total_terima',
    'bpjs_laka', 'bpjs_kematian', 'bpjs_kesehatan', 'thr', 'total_bpjs_thr', 'tanpa_thr', 'tarif_jam', 'lembur_jam', 'lembur_libur_jam']
  return NextResponse.json({
    meta: meta ? JSON.parse(String(meta.value)) : null,
    grades: grades.map((g) => ({ ...g, skor: typeof g.skor === 'string' ? JSON.parse(g.skor) : g.skor, rata_rata: n(g.rata_rata) })),
    salaries: salaries.map((s) => {
      const row: Record<string, unknown> = { ...s }
      for (const k of MONEY) row[k] = n(s[k])
      // Nomor rekening hanya untuk HRD / GM / admin
      if (!manage) {
        delete row.no_rek_cimb
        delete row.no_rek_lain
      }
      return row
    }),
    can: { manage },
  })
})
