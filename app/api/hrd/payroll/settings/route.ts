import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { canManageHr, canViewPayroll } from '@/lib/hrd'
import { loadSettings, saveSettings } from '@/lib/payroll'

// Pengaturan payroll (rate BPJS, maksimum dasar BPJS, UMR, cut off, metode pajak)
export const GET = handle(async () => {
  const user = await requireUser()
  if (!canViewPayroll(user)) fail(403, 'Anda tidak punya akses ke Grade & gaji (menu Karyawan).')
  return NextResponse.json({ item: await loadSettings(), can: { manage: canManageHr(user) } })
})

export const PUT = handle(async (request: Request) => {
  const user = await requireUser()
  if (!canViewPayroll(user) || !canManageHr(user)) fail(403, 'Pengaturan payroll diatur HRD.')
  await saveSettings(await readJson(request), user.id)
  return NextResponse.json({ item: await loadSettings() })
})
