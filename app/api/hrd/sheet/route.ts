import { NextResponse } from 'next/server'
import { ApiError, fail, handle, readJson, requireUser, str } from '@/lib/api'
import { DriveError, driveAccount } from '@/lib/drive'
import {
  canManageHr, canViewEmployees, canViewPayroll, GRADE_SETTING, importEmployees, importGrades, KARYAWAN_SETTING, loadSheetUrl, readEmployeeSheet, readGradeSheet, saveSheetUrl,
} from '@/lib/hrd'
import type { UserProfile } from '@/lib/users'

export const maxDuration = 60

// ?jenis=karyawan (Data Karyawan) | grade (Grade & Gaji)
function jenisOf(request: Request, user: UserProfile) {
  const jenis = new URL(request.url).searchParams.get('jenis') === 'grade' ? 'grade' : 'karyawan'
  if (jenis === 'grade' ? !canViewPayroll(user) : !canViewEmployees(user)) fail(403, 'Anda tidak punya akses ke menu ini.')
  return { jenis, key: jenis === 'grade' ? GRADE_SETTING : KARYAWAN_SETTING } as const
}

// Pesan error Google dibuat jelas untuk pengguna
async function guard<T>(fn: () => Promise<T>) {
  if (!(await driveAccount())) fail(400, 'Akun Google belum terhubung. Hubungkan dulu di Master Data > Logo & Desain.')
  try {
    return await fn()
  } catch (error) {
    if (error instanceof DriveError) fail(400, error.message)
    if (error instanceof Error && /unable to authenticate data/i.test(error.message)) fail(400, 'Token akun Google tidak bisa dibaca di server ini. Hubungkan ulang akun Google di Master Data > Logo & Desain.')
    if (error instanceof Error && /Google|Akses|XLSX/.test(error.message)) fail(400, error.message)
    throw error
  }
}

// Pratinjau isi spreadsheet
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  const { jenis, key } = jenisOf(request, user)
  const account = await driveAccount()
  const base = { jenis, url: await loadSheetUrl(key), account: account?.email ?? null, canSync: canManageHr(user) }
  try {
    if (jenis === 'karyawan') {
      const r = await guard(readEmployeeSheet)
      return NextResponse.json({ ...base, tabs: r.tabs, dipakai: r.tab, jumlah: r.employees.length, contoh: r.employees.slice(0, 5).map((e) => `${e.nama} · ${e.jabatan ?? '—'}`) })
    }
    const r = await guard(readGradeSheet)
    return NextResponse.json({
      ...base, tabs: r.tabs, dipakai: [r.grade?.tab, r.salary?.tab].filter(Boolean).join(' & '), jumlah: (r.grade?.rows.length ?? 0) + (r.salary?.rows.length ?? 0),
      contoh: [`${r.grade?.rows.length ?? 0} baris grade operator (penilai: ${r.grade?.penilai.join(', ') || '—'})`, `${r.salary?.rows.length ?? 0} baris kebijakan gaji`],
    })
  } catch (error) {
    if (error instanceof ApiError) return NextResponse.json({ ...base, tabs: [], dipakai: null, jumlah: 0, contoh: [], error: error.message })
    throw error
  }
})

// Simpan link spreadsheet
export const PUT = handle(async (request: Request) => {
  const user = await requireUser()
  const { key } = jenisOf(request, user)
  if (!canManageHr(user)) fail(403, 'Link spreadsheet dikelola HRD dan GM.')
  await saveSheetUrl(key, str((await readJson(request)).url, 1000), user.id)
  return NextResponse.json({ ok: true })
})

// Sinkron dari spreadsheet
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  const { jenis } = jenisOf(request, user)
  if (!canManageHr(user)) fail(403, 'Sinkron dijalankan HRD dan GM.')
  if (jenis === 'karyawan') return NextResponse.json(await importEmployees((await guard(readEmployeeSheet)).employees))
  return NextResponse.json(await importGrades(await guard(readGradeSheet)))
})
