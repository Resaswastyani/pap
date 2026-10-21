import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageTeknik, canProcessPurchase, requireTeknikMenu } from '@/lib/teknik'
import { serializeVendor, syncVendors, VENDOR_SELECT, vendorsStale, vendorSyncInfo } from '@/lib/vendors'

// Supplier dari Accurate: ?filter=teknik (default) | semua &q=. Disinkron otomatis bila sudah lebih dari sehari.
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireTeknikMenu(user, 'pengajuan-pembelian', 'Pengajuan Pembelian')
  const params = new URL(request.url).searchParams
  let warning: string | null = null
  if (vendorsStale((await vendorSyncInfo()).at)) {
    try {
      await syncVendors()
    } catch (error) {
      warning = `Sinkron supplier dari Accurate gagal: ${(error as Error).message}`
    }
  }
  const [rows] = await db.query<RowDataPacket[]>(`${VENDOR_SELECT} ORDER BY v.name`)
  const all = rows.map(serializeVendor)
  const q = str(params.get('q'), 100).toLowerCase()
  const onlyTeknik = params.get('filter') !== 'semua'
  const items = all.filter((v) => (!onlyTeknik || v.teknik_efektif) && (!q || `${v.name} ${v.vendor_no ?? ''} ${v.category ?? ''} ${v.city ?? ''}`.toLowerCase().includes(q)))
  return NextResponse.json({
    items,
    counts: { teknik: all.filter((v) => v.teknik_efektif).length, semua: all.length },
    sync: await vendorSyncInfo(),
    warning,
    can: { manage: canManageTeknik(user) || canProcessPurchase(user) },
  })
})

// Sinkron sekarang (Teknik / Purchasing)
export const POST = handle(async () => {
  const user = await requireUser()
  requireTeknikMenu(user, 'pengajuan-pembelian', 'Pengajuan Pembelian')
  if (!canManageTeknik(user) && !canProcessPurchase(user)) fail(403, 'Sinkron supplier dilakukan oleh Teknik / Purchasing.')
  return NextResponse.json({ sync: await syncVendors() })
})
