import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { loadTestSheetUrls, saveTestSheetUrls, syncEmployeeTests } from '@/lib/employee-tests-sync'
import { canManageHr } from '@/lib/hrd'

export const maxDuration = 120

// Link spreadsheet jawaban Google Form tes Papikostik & IQ (HRD / GM / admin)
export const GET = handle(async () => {
  const user = await requireUser()
  if (!canManageHr(user)) fail(403, 'Hasil tes karyawan hanya untuk HRD.')
  return NextResponse.json(await loadTestSheetUrls())
})

export const PUT = handle(async (request: Request) => {
  const user = await requireUser()
  if (!canManageHr(user)) fail(403, 'Hasil tes karyawan dikelola oleh HRD.')
  await saveTestSheetUrls(await readJson(request), user.id)
  return NextResponse.json({ ok: true })
})

// Sinkron: baca jawaban form, hitung skor, cocokkan ke karyawan
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  if (!canManageHr(user)) fail(403, 'Hasil tes karyawan dikelola oleh HRD.')
  const results = await syncEmployeeTests()
  await logActivity(request, user, { module: 'Karyawan', action: 'update', entity: null, description: `Sinkron hasil tes: ${results.map((r) => `${r.jenis} ${r.cocok}/${r.jawaban} cocok`).join(', ')}` })
  return NextResponse.json({ results })
})
