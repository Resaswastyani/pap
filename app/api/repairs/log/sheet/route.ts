import { NextResponse } from 'next/server'
import { ApiError, fail, handle, readJson, requireUser, str } from '@/lib/api'
import { canSyncDamageLog, importDamageEntries, loadDamageSheetUrl, readDamageSheet, requireDamageLog, saveDamageSheetUrl } from '@/lib/damage-log'
import { DriveError, driveAccount } from '@/lib/drive'

export const maxDuration = 60

// Pesan error Google dibuat jelas untuk pengguna
async function readSheet(url: string) {
  if (!(await driveAccount())) fail(400, 'Akun Google belum terhubung. Hubungkan dulu di Master Data > Logo & Desain.')
  try {
    return await readDamageSheet(url)
  } catch (error) {
    if (error instanceof DriveError) fail(400, error.message)
    // Token Google tersimpan terenkripsi dengan AUTH_SECRET server lain (mis. dev lokal vs production)
    if (error instanceof Error && /unable to authenticate data/i.test(error.message)) fail(400, 'Token akun Google tidak bisa dibaca di server ini. Hubungkan ulang akun Google di Master Data > Logo & Desain.')
    if (error instanceof Error && /Google|Akses|XLSX/.test(error.message)) fail(400, error.message)
    throw error
  }
}

// Pratinjau isi spreadsheet Laporan Kerusakan Mesin: tab yang dikenali + jumlah baris
export const GET = handle(async () => {
  const user = await requireUser()
  requireDamageLog(user)
  const url = await loadDamageSheetUrl()
  const account = await driveAccount()
  const base = { url, account: account?.email ?? null, canSync: canSyncDamageLog(user) }
  let parsed: Awaited<ReturnType<typeof readSheet>>
  try {
    parsed = await readSheet(url)
  } catch (error) {
    // Gagal dibaca (belum dibagikan, link salah): link tetap dikirim agar bisa diganti
    if (error instanceof ApiError) return NextResponse.json({ ...base, tabs: [], baris: 0, laporan: 0, error: error.message })
    throw error
  }
  return NextResponse.json({
    ...base, tabs: parsed.tabs, baris: parsed.entries.length,
    laporan: new Set(parsed.entries.map((e) => e.no_laporan).filter(Boolean)).size,
    contoh: parsed.entries.slice(-5).reverse(),
  })
})

// Simpan link spreadsheet
export const PUT = handle(async (request: Request) => {
  const user = await requireUser()
  requireDamageLog(user)
  if (!canSyncDamageLog(user)) fail(403, 'Link spreadsheet dikelola Teknik, kepala Produksi/PPIC, dan GM.')
  await saveDamageSheetUrl(str((await readJson(request)).url, 1000), user.id)
  return NextResponse.json({ ok: true })
})

// Sinkron rekap kerusakan dari spreadsheet
export const POST = handle(async () => {
  const user = await requireUser()
  requireDamageLog(user)
  if (!canSyncDamageLog(user)) fail(403, 'Sinkron dijalankan Teknik, kepala Produksi/PPIC, dan GM.')
  const { entries } = await readSheet(await loadDamageSheetUrl())
  if (!entries.length) fail(400, 'Tidak ada data kerusakan yang dikenali. Pastikan sheet punya kolom NO, TANGGAL, MESIN, dan KERUSAKAN.')
  return NextResponse.json(await importDamageEntries(entries))
})
