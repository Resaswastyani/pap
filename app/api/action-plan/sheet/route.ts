import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { requireActionPlan, requireManageAP, setSheetUrl, sheetUrl, syncFromSheet, syncedAt } from '@/lib/action-plan'
import { driveFileId } from '@/lib/drive'
import { driveFileInfo, SheetWriteError } from '@/lib/sheet-write'

// Link Google Sheet Action Plan & sinkron (Admin / Super Admin)
export const GET = handle(async () => {
  const user = await requireUser()
  requireActionPlan(user)
  requireManageAP(user)
  return NextResponse.json({ url: await sheetUrl(), syncedAt: await syncedAt() })
})

export const PUT = handle(async (request: Request) => {
  const user = await requireUser()
  requireActionPlan(user)
  requireManageAP(user)
  const body = await readJson(request)
  const url = typeof body.url === 'string' ? body.url.trim() : ''
  // Link Drive apa pun: Google Sheet atau file Excel (.xlsx); dicek bisa dibuka akun Google yang terhubung
  if (url && !driveFileId(url)) fail(400, 'Link Google Drive tidak valid. Salin link dari tombol Bagikan di Google Drive / Google Sheet.')
  if (url) await driveFileInfo(url).catch((e) => fail(400, e instanceof SheetWriteError ? e.message : (e as Error).message))
  await setSheetUrl(url, user.id)
  return NextResponse.json({ ok: true })
})

// Tarik semua tab dari sheet ke SIMPAP, lalu tulis balik ID baru, Timeline, dan KPI
export const POST = handle(async () => {
  const user = await requireUser()
  requireActionPlan(user)
  requireManageAP(user)
  return NextResponse.json(await syncFromSheet(user.id))
})
