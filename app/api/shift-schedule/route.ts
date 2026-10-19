import { NextResponse } from 'next/server'
import { handle, requireUser } from '@/lib/api'
import { canSyncShift, getShiftSchedule, requireShift } from '@/lib/shift-schedule'

// Jadwal shift satu bulan (?periode=2026-10), default bulan ini / jadwal terbaru
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireShift(user)
  const periode = new URL(request.url).searchParams.get('periode')
  return NextResponse.json({ ...(await getShiftSchedule(periode)), canSync: canSyncShift(user) })
})
