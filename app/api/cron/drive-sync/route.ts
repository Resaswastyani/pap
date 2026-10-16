import { NextResponse } from 'next/server'
import { driveEnabled, syncDrive } from '@/lib/drive'

export const maxDuration = 60

// Dipanggil penjadwal (cron-job.org) mis. setiap 30 menit: menelusuri folder desain Google Drive bertahap.
// Wajib CRON_SECRET: header "Authorization: Bearer <CRON_SECRET>" atau ?key=<CRON_SECRET>
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || new URL(request.url).searchParams.get('key')
  if (!secret || given !== secret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await driveEnabled())) return NextResponse.json({ ok: false, error: 'Google Drive belum dikonfigurasi.' })
  try {
    return NextResponse.json({ ok: true, ...(await syncDrive(25_000)) })
  } catch (error) {
    console.error('[cron/drive-sync]', error)
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 })
  }
}
