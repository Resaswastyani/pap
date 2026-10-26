import { NextResponse } from 'next/server'
import { syncSlot } from '@/lib/auth'

// Sesi per tab: tab baru mengambil sesi browser saat ini, tab yang aktif menjadi sesi untuk link cetak/unduh
export async function POST() {
  await syncSlot()
  return NextResponse.json({ ok: true })
}
