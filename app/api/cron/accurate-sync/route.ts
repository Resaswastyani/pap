import { NextResponse } from 'next/server'
import { accurateEnabled } from '@/lib/accurate'
import { syncAll } from '@/lib/accurate-sync'
import { refreshCandidateStatus } from '@/lib/logistik'

export const maxDuration = 60

// Dipanggil penjadwal (cron-job.org) setiap 15 menit: sinkron customer, faktur, sales order, produk, dan stok dari Accurate.
// Wajib CRON_SECRET: header "Authorization: Bearer <CRON_SECRET>" atau ?key=<CRON_SECRET>
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || new URL(request.url).searchParams.get('key')
  if (!secret || given !== secret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!accurateEnabled()) return NextResponse.json({ ok: false, error: 'Integrasi Accurate belum dikonfigurasi.' })
  try {
    // cron-job.org memutus request setelah ±30 detik; sisa data dilanjutkan pada putaran berikutnya
    const results = await syncAll(20_000)
    // Status SO yang masih perlu dikirim dicek ulang (SO yang sudah difakturkan tidak selalu ikut sinkron inkremental)
    const pengiriman = await refreshCandidateStatus(6_000).catch((e) => ({ error: (e as Error).message }))
    return NextResponse.json({ ok: true, results, pengiriman })
  } catch (error) {
    console.error('[cron/accurate-sync]', error)
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 })
  }
}
