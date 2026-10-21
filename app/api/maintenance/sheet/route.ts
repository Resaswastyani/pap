import { NextResponse } from 'next/server'
import { ApiError, fail, handle, readJson, requireUser, str } from '@/lib/api'
import { DriveError, driveAccount } from '@/lib/drive'
import { canSyncMaintenanceSheet, importMaintenanceSheet, loadMaintenanceSheetUrl, readMaintenanceSheet, requireMaintenanceSheet, saveMaintenanceSheetUrl } from '@/lib/maintenance-sheet'

export const maxDuration = 60

// Pesan error Google dibuat jelas untuk pengguna
async function readSheet(url: string) {
  if (!(await driveAccount())) fail(400, 'Akun Google belum terhubung. Hubungkan dulu di Master Data > Logo & Desain.')
  try {
    return await readMaintenanceSheet(url)
  } catch (error) {
    if (error instanceof DriveError) fail(400, error.message)
    // Token Google tersimpan terenkripsi dengan AUTH_SECRET server lain (mis. dev lokal vs production)
    if (error instanceof Error && /unable to authenticate data/i.test(error.message)) fail(400, 'Token akun Google tidak bisa dibaca di server ini. Hubungkan ulang akun Google di Master Data > Logo & Desain.')
    if (error instanceof Error && /Google|Akses|XLSX/.test(error.message)) fail(400, error.message)
    throw error
  }
}

// Pratinjau spreadsheet Lembar Perawatan Mesin: tab mesin yang dikenali + jumlah part & langkah
export const GET = handle(async () => {
  const user = await requireUser()
  requireMaintenanceSheet(user)
  const url = await loadMaintenanceSheetUrl()
  const account = await driveAccount()
  const base = { url, account: account?.email ?? null, canSync: canSyncMaintenanceSheet(user) }
  try {
    const { tabs } = await readSheet(url)
    return NextResponse.json({ ...base, tabs })
  } catch (error) {
    // Gagal dibaca (belum dibagikan, link salah): link tetap dikirim agar bisa diganti
    if (error instanceof ApiError) return NextResponse.json({ ...base, tabs: [], error: error.message })
    throw error
  }
})

export const PUT = handle(async (request: Request) => {
  const user = await requireUser()
  requireMaintenanceSheet(user)
  if (!canSyncMaintenanceSheet(user)) fail(403, 'Link spreadsheet dikelola divisi Teknik dan GM.')
  await saveMaintenanceSheetUrl(str((await readJson(request)).url, 1000), user.id)
  return NextResponse.json({ ok: true })
})

export const POST = handle(async () => {
  const user = await requireUser()
  requireMaintenanceSheet(user)
  if (!canSyncMaintenanceSheet(user)) fail(403, 'Sinkron dijalankan divisi Teknik dan GM.')
  const { machines } = await readSheet(await loadMaintenanceSheetUrl())
  if (!machines.length) fail(400, 'Tidak ada lembar perawatan yang dikenali. Pastikan tiap tab punya kolom NAMA PART dan MAINTENANCE.')
  return NextResponse.json(await importMaintenanceSheet(machines))
})
