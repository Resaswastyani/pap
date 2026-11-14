import { NextResponse } from 'next/server'
import { accurateEnabled } from '@/lib/accurate'
import { syncAll } from '@/lib/accurate-sync'
import { fail, handle, requireUser } from '@/lib/api'
import { refreshCandidateStatus, requireLogistik } from '@/lib/logistik'

export const maxDuration = 60

// Tombol "Sinkron Accurate" di Pengiriman: ambil SO & faktur terbaru, lalu cek ulang status setiap SO yang masih perlu dikirim.
// SO yang sudah difakturkan (Terproses) atau ditutup otomatis keluar dari daftar. Hanya membaca dari Accurate.
export const POST = handle(async () => {
  const user = await requireUser()
  requireLogistik(user, 'pengiriman')
  if (!accurateEnabled()) fail(400, 'Integrasi Accurate belum dikonfigurasi.')
  const sync = await syncAll(15_000, ['sales-order', 'sales-invoice', 'sales-order-items'])
  const errors = sync.filter((r) => r.error).map((r) => `${r.entity}: ${r.error}`)
  return NextResponse.json({ ...(await refreshCandidateStatus(30_000)), errors })
})
