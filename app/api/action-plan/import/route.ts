import { NextResponse } from 'next/server'
import { fail, handle, requireUser } from '@/lib/api'
import { importSheetData, parseSheetData, pushPrograms, requireActionPlan, requireManageAP, TAB } from '@/lib/action-plan'
import { readXlsx } from '@/lib/xlsx-lite'

const MAX_BYTES = 10 * 1024 * 1024

// Impor dari file Excel template (.xlsx / .xlsm): tab Program Kerja, Progress Report, Issue Log, KPI.
// Bila Google Sheet sudah ditautkan, semua program ditulis balik ke sheet setelah impor.
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireActionPlan(user)
  requireManageAP(user)
  const form = await request.formData().catch(() => fail(400, 'Data upload tidak valid.'))
  const file = form.get('file')
  if (!(file instanceof File) || !file.size) fail(400, 'Pilih file Excel terlebih dahulu.')
  const f = file as File
  if (/\.xls$/i.test(f.name)) fail(400, 'File Excel 97-2003 (.xls) belum didukung. Simpan sebagai .xlsx atau .xlsm.')
  if (f.size > MAX_BYTES) fail(400, 'Ukuran file maksimal 10 MB.')
  let sheets: { title: string; rows: string[][] }[] = []
  try {
    sheets = readXlsx(Buffer.from(await f.arrayBuffer()))
  } catch {
    fail(400, 'File tidak bisa dibaca sebagai Excel (.xlsx / .xlsm).')
  }
  const tab = (t: string) => sheets.find((s) => s.title.trim().toLowerCase() === t.toLowerCase())?.rows ?? []
  const parsed = parseSheetData({ programs: tab(TAB.program), progress: tab(TAB.progress), issues: tab(TAB.issue), kpis: tab(TAB.kpi) })
  if (!parsed.programs.length) fail(400, `Tab "${TAB.program}" tidak berisi program.`)
  const res = await importSheetData(parsed, user.id)
  const warning = await pushPrograms('all')
  return NextResponse.json({ ...res, warning })
})
