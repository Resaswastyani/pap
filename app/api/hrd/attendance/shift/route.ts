import { NextResponse } from 'next/server'
import { fail, handle, requireUser } from '@/lib/api'
import { applyShiftSchedule } from '@/lib/attendance'
import { canManageHr } from '@/lib/hrd'

// Sesuaikan absensi tersimpan dengan Jadwal Shift (hari libur per karyawan, label shift)
export const POST = handle(async () => {
  const user = await requireUser()
  if (!user.menus.includes('absensi' as never) || !canManageHr(user)) fail(403, 'Penyesuaian absensi dilakukan oleh HRD.')
  return NextResponse.json(await applyShiftSchedule())
})
