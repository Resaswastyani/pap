import { NextResponse } from 'next/server'
import { fail, handle, requireUser } from '@/lib/api'
import { driveEnabled, syncDrive } from '@/lib/drive'
import { canManageMaster } from '@/lib/master'

export const maxDuration = 60

// Admin: "Sinkron Google Drive sekarang". Sisa folder dilanjutkan dengan klik lagi atau oleh cron.
export const POST = handle(async () => {
  const user = await requireUser()
  if (!canManageMaster(user)) fail(403, 'Hanya Admin / Super Admin yang dapat menyinkronkan Google Drive.')
  if (!(await driveEnabled())) fail(400, 'Google Drive belum terhubung. Klik "Hubungkan akun Google" terlebih dahulu.')
  return NextResponse.json(await syncDrive(25_000))
})
