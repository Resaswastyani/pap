import { NextResponse } from 'next/server'
import { ApiError, fail, handle, readJson, requireUser, str } from '@/lib/api'
import { DriveError, driveAccount } from '@/lib/drive'
import { canSyncShift, importShiftSchedules, loadShiftSheetUrl, readShiftSheet, requireShift, saveShiftSheetUrl } from '@/lib/shift-schedule'

export const maxDuration = 60

// Pesan error Google dibuat jelas untuk pengguna
async function readSheet(url: string) {
  if (!(await driveAccount())) fail(400, 'Akun Google belum terhubung. Hubungkan dulu di Master Data > Logo & Desain.')
  try {
    return await readShiftSheet(url)
  } catch (error) {
    if (error instanceof DriveError) fail(400, error.message)
    if (error instanceof Error && /Google|Akses|XLSX/.test(error.message)) fail(400, error.message)
    throw error
  }
}

// Pratinjau isi spreadsheet jadwal: tab yang dikenali + jadwal per bulan
export const GET = handle(async () => {
  const user = await requireUser()
  requireShift(user)
  const url = await loadShiftSheetUrl()
  const account = await driveAccount()
  const base = { url, account: account?.email ?? null, canSync: canSyncShift(user) }
  // Gagal dibaca (belum dibagikan, link salah): link tetap dikirim agar bisa diganti
  let parsed: Awaited<ReturnType<typeof readSheet>>
  try {
    parsed = await readSheet(url)
  } catch (error) {
    if (error instanceof ApiError) return NextResponse.json({ ...base, tabs: [], schedules: [], error: error.message })
    throw error
  }
  return NextResponse.json({
    ...base, tabs: parsed.tabs,
    schedules: parsed.schedules.map((s) => ({ periode: s.periode, judul: s.judul, tab: s.tab, karyawan: s.rows.length })),
  })
})

// Simpan link spreadsheet
export const PUT = handle(async (request: Request) => {
  const user = await requireUser()
  requireShift(user)
  if (!canSyncShift(user)) fail(403, 'Jadwal shift dikelola PPIC, HRD, dan kepala Produksi.')
  await saveShiftSheetUrl(str((await readJson(request)).url, 1000), user.id)
  return NextResponse.json({ ok: true })
})

// Sinkron semua bulan di spreadsheet ke Jadwal Shift
export const POST = handle(async () => {
  const user = await requireUser()
  requireShift(user)
  if (!canSyncShift(user)) fail(403, 'Jadwal shift dikelola PPIC, HRD, dan kepala Produksi.')
  const { schedules } = await readSheet(await loadShiftSheetUrl())
  if (!schedules.length) fail(400, 'Tidak ada jadwal yang dikenali. Pastikan sheet punya kolom Nama dan kolom tanggal 1 sampai 31.')
  return NextResponse.json(await importShiftSchedules(schedules, user.id))
})
