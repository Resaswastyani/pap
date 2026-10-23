import { NextResponse } from 'next/server'
import { fail, handle, requireUser } from '@/lib/api'
import { canManageLogistik, requireLogistik, syncExpeditionsFromSo } from '@/lib/logistik'

export const maxDuration = 60

// Bangun ekspedisi & riwayat tarif dari keterangan SO Accurate 12 bulan terakhir
export const POST = handle(async () => {
  const user = await requireUser()
  requireLogistik(user, 'ekspedisi')
  if (!canManageLogistik(user)) fail(403, 'Ekspedisi dikelola Inventory & Logistik / PPIC.')
  return NextResponse.json(await syncExpeditionsFromSo(12))
})
