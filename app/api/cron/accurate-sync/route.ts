import { NextResponse } from 'next/server'
import { accurateEnabled } from '@/lib/accurate'
import { syncAll } from '@/lib/accurate-sync'

export const maxDuration = 60

// Dipanggil penjadwal (cron-job.org) setiap 15 menit: sinkron customer, faktur, dan stok dari Accurate.
// Wajib CRON_SECRET: header "Authorization: Bearer <CRON_SECRET>" atau ?key=<CRON_SECRET>
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || new URL(request.url).searchParams.get('key')
  if (!secret || given !== secret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!accurateEnabled()) return NextResponse.json({ ok: false, error: 'Integrasi Accurate belum dikonfigurasi.' })
  try {
    return NextResponse.json({ ok: true, results: await syncAll(45_000) })
  } catch (error) {
    console.error('[cron/accurate-sync]', error)
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 })
  }
}
