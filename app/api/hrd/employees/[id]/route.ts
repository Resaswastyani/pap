import { NextResponse } from 'next/server'
import type { RowDataPacket } from 'mysql2'
import { logActivity } from '@/lib/activity'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { deleteEmployee, loadEmployeeRow, readEmployeeInput, updateEmployee } from '@/lib/employees'
import { canManageHr, canViewEmployees, canViewPayroll } from '@/lib/hrd'

type Row = RowDataPacket & Record<string, unknown>
type Ctx = { params: Promise<{ id: string }> }

// Data pribadi hanya untuk HRD / GM / admin
const PRIVATE = ['no_id', 'tipe_id', 'tgl_akhir_id', 'alamat_id', 'alamat_tinggal', 'kode_pos', 'no_bpjs_tk', 'no_bpjs_kes', 'npwp', 'bank', 'no_rek', 'rek_an', 'status_pajak', 'nama_ibu',
  'jumlah_anak', 'tgl_lahir', 'tempat_lahir', 'golongan_darah', 'kontak_darurat', 'hp_darurat']

// Detail karyawan: profil, atasan & bawahan, grade operator & gaji (bila boleh melihat penggajian)
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  if (!canViewEmployees(user)) fail(403, 'Anda tidak punya akses ke menu Karyawan.')
  const id = int((await ctx.params).id) ?? fail(404, 'Karyawan tidak ditemukan.')
  const [[e]] = await db.query<Row[]>('SELECT * FROM employees WHERE id = ?', [id])
  if (!e) fail(404, 'Karyawan tidak ditemukan.')
  const manage = canManageHr(user)
  const item = Object.fromEntries(Object.entries(e).filter(([k]) => manage || !PRIVATE.includes(k)))
  const [bawahan] = await db.query<Row[]>(
    'SELECT id, nama, jabatan, status_karyawan FROM employees WHERE nip_atasan = ? AND tgl_berhenti IS NULL ORDER BY nama LIMIT 100', [e.nip],
  )
  let grade = null
  let gaji = null
  if (canViewPayroll(user)) {
    const [[g]] = await db.query<Row[]>('SELECT nama, skor, rata_rata, grade FROM employee_grades WHERE nama_key = ? LIMIT 1', [e.nama_key])
    const [[s]] = await db.query<Row[]>('SELECT * FROM employee_salaries WHERE nama_key = ? LIMIT 1', [e.nama_key])
    grade = g ? { ...g, skor: typeof g.skor === 'string' ? JSON.parse(g.skor) : g.skor, rata_rata: g.rata_rata === null ? null : Number(g.rata_rata) } : null
    gaji = s ? Object.fromEntries(Object.entries(s).map(([k, v]) => [k, typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) && !['no_rek_cimb', 'no_rek_lain'].includes(k) ? Number(v) : v])) : null
    if (gaji && !manage) {
      delete gaji.no_rek_cimb
      delete gaji.no_rek_lain
    }
  }
  return NextResponse.json({ item, bawahan, grade, gaji, can: { manage, payroll: canViewPayroll(user) } })
})

const employeeId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Karyawan tidak ditemukan.')

// Ubah data karyawan (HRD / GM / admin); setelah diubah, data ini tidak lagi ditimpa sinkron spreadsheet
export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  if (!canManageHr(user)) fail(403, 'Data karyawan dikelola oleh HRD.')
  const id = await employeeId(ctx)
  await loadEmployeeRow(id)
  const input = await readEmployeeInput(await readJson(request))
  await updateEmployee(user, id, input)
  await logActivity(request, user, { module: 'Karyawan', action: 'update', entity: { type: 'karyawan', id, label: String(input.nama) }, description: `Mengubah data karyawan ${input.nama} (NIP ${input.nip})` })
  return NextResponse.json({ ok: true })
})

// Hapus karyawan (HRD / GM / admin); NIP-nya tidak diambil lagi saat sinkron spreadsheet
export const DELETE = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  if (!canManageHr(user)) fail(403, 'Data karyawan dikelola oleh HRD.')
  const id = await employeeId(ctx)
  const e = await deleteEmployee(user, id)
  await logActivity(request, user, { module: 'Karyawan', action: 'delete', entity: { type: 'karyawan', id, label: e.nama }, description: `Menghapus karyawan ${e.nama} (NIP ${e.nip})` })
  return NextResponse.json({ ok: true, ...e })
})
