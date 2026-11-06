import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { canManageAccounting, requireAccounting } from '@/lib/accounting'
import { readNpwp, saveNpwp } from '@/lib/digunggung'

// NPWP penjual (TIN) untuk XML Coretax Retail: { npwp }
export const PUT = handle(async (request: Request) => {
  const user = await requireUser()
  requireAccounting(user, 'pajak')
  if (!canManageAccounting(user)) fail(403, 'NPWP diatur oleh divisi Accounting.')
  const npwp = readNpwp((await readJson(request)).npwp)
  await saveNpwp(npwp)
  return NextResponse.json({ npwp })
})
