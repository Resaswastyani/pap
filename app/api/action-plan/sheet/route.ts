import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { requireActionPlan, requireManageAP, setSheetUrl, sheetUrl, syncFromSheet, syncedAt } from '@/lib/action-plan'
import { spreadsheetId } from '@/lib/drive'

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
  if (url && /\/file\/d\//.test(url)) fail(400, 'Link ini masih file Excel di Drive. Buka file > File > Simpan sebagai Google Spreadsheet, lalu salin link spreadsheet barunya.')
  if (url && !spreadsheetId(url)) fail(400, 'Link Google Sheet tidak valid. Salin link dari tombol Bagikan di Google Sheet.')
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
