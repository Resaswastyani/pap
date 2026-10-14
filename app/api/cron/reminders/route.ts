import { NextResponse } from 'next/server'
import { createDueReminders } from '@/lib/notifications'

// Dipanggil penjadwal (mis. cron-job.org) SETIAP MENIT agar reminder 15 menit sebelum meeting
// sampai ke HP walau aplikasi sedang ditutup. Wajib menyertakan CRON_SECRET:
//   header "Authorization: Bearer <CRON_SECRET>"  atau  ?key=<CRON_SECRET>
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || new URL(request.url).searchParams.get('key')
  if (!secret || given !== secret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const created = await createDueReminders()
    return NextResponse.json({ ok: true, reminders: created.length })
  } catch (error) {
    console.error('[cron/reminders]', error)
    return NextResponse.json({ error: 'Gagal membuat reminder.' }, { status: 500 })
  }
}
