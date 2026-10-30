import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser, str } from '@/lib/api'
import { canManageTraining, requireTraining, TRAINING_STALE_HOURS } from '@/lib/training'
import { loadSchedule, loadScheduleSync, loadScheduleUrl, recordScheduleError, saveScheduleUrl, syncSchedule } from '@/lib/training-schedule'

export const maxDuration = 60

const isStale = (at: string | null) => !at || Date.now() - new Date(`${String(at).replace(' ', 'T')}+07:00`).getTime() > TRAINING_STALE_HOURS * 3600e3

// Jadwal training (cermin spreadsheet). Rekap kehadiran per karyawan hanya untuk HRD; karyawan lain melihat jadwal sesi.
export const GET = handle(async () => {
  const user = await requireUser()
  requireTraining(user)
  const manage = canManageTraining(user)
  const url = await loadScheduleUrl()
  let warning: string | null = null
  if (url && isStale((await loadScheduleSync()).at)) {
    try {
      await syncSchedule()
    } catch (error) {
      warning = `Sinkron otomatis gagal: ${(error as Error).message}`
      await recordScheduleError(warning)
    }
  }
  const data = await loadSchedule()
  return NextResponse.json({
    schedule: data ? { ...data, rekap: manage ? data.rekap : [] } : null,
    url: manage ? url : null,
    sync: await loadScheduleSync(),
    warning,
    can: { manage },
  })
})

// Sinkron sekarang
export const PUT = handle(async () => {
  const user = await requireUser()
  requireTraining(user)
  if (!canManageTraining(user)) fail(403, 'Sinkron jadwal training dilakukan HRD.')
  await syncSchedule()
  return NextResponse.json({ sync: await loadScheduleSync() })
})

// Ganti link spreadsheet lalu sinkron: { url }
export const PATCH = handle(async (request: Request) => {
  const user = await requireUser()
  requireTraining(user)
  if (!canManageTraining(user)) fail(403, 'Spreadsheet jadwal diatur HRD.')
  const url = str((await readJson(request)).url, 1000)
  await saveScheduleUrl(url, user.id)
  if (url) await syncSchedule()
  return NextResponse.json({ url, sync: await loadScheduleSync() })
})
