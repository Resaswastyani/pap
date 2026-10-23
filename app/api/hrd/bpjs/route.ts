import { NextResponse } from 'next/server'
import { fail, handle, requireUser } from '@/lib/api'
import { bpjsReport, requireBpjs } from '@/lib/bpjs-report'
import { canManageHr } from '@/lib/hrd'

export const maxDuration = 60

// Laporan BPJS: ?periode=YYYY-MM (periode cut off gaji)
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireBpjs(user)
  const periode = new URL(request.url).searchParams.get('periode') ?? ''
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periode)) fail(400, 'Periode tidak valid.')
  return NextResponse.json(await bpjsReport(periode, canManageHr(user)))
})
