import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser, str } from '@/lib/api'
import { canEditContent, requireContent } from '@/lib/content'
import { existingKeys, importContentPlans, loadSheetUrl, readContentSheet, saveSheetUrl } from '@/lib/content-sheet'
import { DriveError, driveAccount } from '@/lib/drive'

export const maxDuration = 60

// Pesan error Google dibuat jelas untuk pengguna
async function readSheet(url: string) {
  if (!(await driveAccount())) fail(400, 'Akun Google belum terhubung. Hubungkan dulu di Master Data > Logo & Desain.')
  try {
    return await readContentSheet(url)
  } catch (error) {
    if (error instanceof DriveError) fail(400, error.message)
    if (error instanceof Error && /Google|Akses/.test(error.message)) fail(400, error.message)
    throw error
  }
}

// Pratinjau isi Google Sheet konten planning: kolom yang dikenali + baris yang akan diimpor (baru / diperbarui)
export const GET = handle(async () => {
  const user = await requireUser()
  requireContent(user)
  const url = await loadSheetUrl()
  const account = await driveAccount()
  const { tabs, plans } = await readSheet(url)
  const known = await existingKeys(plans.map((p) => p.key))
  return NextResponse.json({
    url, account: account?.email ?? null, tabs, canEdit: canEditContent(user),
    plans: plans.map((p) => ({ ...p, baru: !known.has(p.key) })),
  })
})

// Simpan link Google Sheet
export const PUT = handle(async (request: Request) => {
  const user = await requireUser()
  requireContent(user)
  if (!canEditContent(user)) fail(403, 'Kalender konten dikelola Marketing Digital.')
  await saveSheetUrl(str((await readJson(request)).url, 1000), user.id)
  return NextResponse.json({ ok: true })
})

// Impor / sinkron semua baris dari Google Sheet ke Kalender Konten
export const POST = handle(async () => {
  const user = await requireUser()
  requireContent(user)
  if (!canEditContent(user)) fail(403, 'Kalender konten dikelola Marketing Digital.')
  const { plans } = await readSheet(await loadSheetUrl())
  if (!plans.length) fail(400, 'Tidak ada baris yang bisa diimpor. Pastikan sheet punya kolom tanggal dan judul / topik konten.')
  return NextResponse.json(await importContentPlans(plans, user.id))
})
