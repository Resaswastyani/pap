import { NextResponse } from 'next/server'
import { syncDamageSheet } from '@/lib/damage-log'
import { syncMaintenanceSheet } from '@/lib/maintenance-sheet'
import { syncHrSheets } from '@/lib/hrd'
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
    const result = await syncDrive(20_000)
    // Rekap kerusakan mesin dari spreadsheet Laporan Kerusakan Mesin (satu file, cepat)
    const kerusakan = await syncDamageSheet().catch((error) => ({ error: (error as Error).message }))
    // Lembar perawatan mesin (satu file)
    const perawatan = await syncMaintenanceSheet().catch((error) => ({ error: (error as Error).message }))
    // Data Karyawan & Grade dan Kenaikan Gaji (HRD)
    const hrd = await syncHrSheets().catch((error) => ({ error: (error as Error).message }))
    return NextResponse.json({ ok: true, ...result, kerusakan, perawatan, hrd })
  } catch (error) {
    console.error('[cron/drive-sync]', error)
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 })
  }
}
