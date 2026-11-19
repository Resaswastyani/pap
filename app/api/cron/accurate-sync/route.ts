import { NextResponse } from 'next/server'
import { withCronLog } from '@/lib/cron-log'
import { accurateEnabled } from '@/lib/accurate'
import { syncAll } from '@/lib/accurate-sync'
import { refreshCandidateStatus } from '@/lib/logistik'
import { snapshotToday } from '@/lib/stock-history'

export const maxDuration = 60

// Dipanggil penjadwal (cron-job.org) setiap 15 menit: sinkron customer, faktur, sales order, produk, dan stok dari Accurate.
// Wajib CRON_SECRET: header "Authorization: Bearer <CRON_SECRET>" atau ?key=<CRON_SECRET>
export async function GET(request: Request) {
  return withCronLog('accurate-sync', request, () => run(request))
}

async function run(request: Request) {
  const secret = process.env.CRON_SECRET
  const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || new URL(request.url).searchParams.get('key')
  if (!secret || given !== secret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!accurateEnabled()) return NextResponse.json({ ok: false, error: 'Integrasi Accurate belum dikonfigurasi.' })
  try {
    // cron-job.org memutus request setelah ±30 detik; sisa data dilanjutkan pada putaran berikutnya
    const results = await syncAll(20_000)
    // Catatan stok hari ini (menu Stok: lihat per tanggal)
    await snapshotToday().catch((e) => console.error('[stok harian]', (e as Error).message))
    // Status SO yang masih perlu dikirim dicek ulang (SO yang sudah difakturkan tidak selalu ikut sinkron inkremental)
    const pengiriman = await refreshCandidateStatus(6_000).catch((e) => ({ error: (e as Error).message }))
    return NextResponse.json({ ok: true, results, pengiriman })
  } catch (error) {
    console.error('[cron/accurate-sync]', error)
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 })
  }
}
