import { NextResponse } from 'next/server'
import { ApiError, handle, readJson, requireUser, str } from '@/lib/api'
import { driveAccount } from '@/lib/drive'
import { canManageGa, loadGaUrl, readGaSheet, requireGaManage, requireGaView, saveGaUrl, syncGa } from '@/lib/ga'
import { gaGuard } from '@/lib/ga-guard'

export const maxDuration = 60

// Pratinjau spreadsheet GA (tab yang dikenali & jumlah baris)
export const GET = handle(async () => {
  const user = await requireUser()
  requireGaView(user)
  const account = await driveAccount()
  const base = { url: await loadGaUrl(), account: account?.email ?? null, canSync: canManageGa(user) }
  try {
    const r = await gaGuard(readGaSheet)
    return NextResponse.json({
      ...base, tabs: r.tabs,
      dipakai: [r.hp?.title, r.langganan?.title, r.wifi?.title].filter(Boolean).join(', '),
      contoh: [`${r.hp?.parsed.items.length ?? 0} nomor HP`, `${r.langganan?.parsed.items.length ?? 0} langganan`, `${r.wifi?.parsed.items.length ?? 0} WiFi`],
    })
  } catch (error) {
    if (error instanceof ApiError) return NextResponse.json({ ...base, tabs: [], dipakai: null, contoh: [], error: error.message })
    throw error
  }
})

// Simpan link spreadsheet
export const PUT = handle(async (request: Request) => {
  const user = await requireUser()
  requireGaManage(user)
  await saveGaUrl(str((await readJson(request)).url, 1000), user.id)
  return NextResponse.json({ ok: true })
})

// Sinkron sekarang
export const POST = handle(async () => {
  const user = await requireUser()
  requireGaManage(user)
  return NextResponse.json(await gaGuard(syncGa))
})
