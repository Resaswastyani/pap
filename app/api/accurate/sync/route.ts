import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { accurateEnabled } from '@/lib/accurate'
import { PRODUCTION_SYNC_ENTITIES, PURCHASING_SYNC_ENTITIES, SYNC_ENTITIES, syncAll, syncStatus, type SyncEntity } from '@/lib/accurate-sync'
import { canManageCustomer } from '@/lib/customers'
import { canViewProduction } from '@/lib/production'
import { canViewPurchasing } from '@/lib/purchasing'

export const maxDuration = 60

// Status sinkronisasi (ditampilkan di halaman Customer & Stok)
export const GET = handle(async () => {
  await requireUser()
  return NextResponse.json({ enabled: accurateEnabled(), status: await syncStatus() })
})

// Tombol "Sinkron sekarang": { entities?: ['customer', 'sales-invoice', 'item'] }
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  if (!accurateEnabled()) fail(400, 'Integrasi Accurate belum dikonfigurasi.')
  const body = await readJson(request).catch(() => ({}) as Record<string, unknown>)
  const only = Array.isArray(body.entities) ? (body.entities.filter((e) => SYNC_ENTITIES.includes(e as SyncEntity)) as SyncEntity[]) : undefined
  // Stok boleh disinkron oleh semua pengguna menu Stok; data customer hanya oleh pengelola customer/admin
  const stockOnly = !!only?.length && only.every((e) => e === 'item' || e === 'stock')
  // Rencana produksi & penyelesaian barang jadi boleh disinkron oleh pengguna menu produksi; BOM oleh pengguna menu Formulasi
  const productionOnly = !!only?.length && only.every((e) => PRODUCTION_SYNC_ENTITIES.includes(e))
  const bomOnly = !!only?.length && only.every((e) => e === 'bill-of-material' || e === 'bill-of-material-detail')
  // Data pembelian (supplier, PO, faktur) oleh pengguna menu Purchasing
  const purchasingOnly = !!only?.length && only.every((e) => PURCHASING_SYNC_ENTITIES.includes(e))
  const allowed = canManageCustomer(user) || user.role.isAdmin || (stockOnly && user.menus.includes('stok'))
    || (productionOnly && canViewProduction(user)) || (bomOnly && user.menus.includes('formulasi'))
    || (purchasingOnly && canViewPurchasing(user))
  if (!allowed) fail(403, 'Anda tidak punya akses untuk menjalankan sinkronisasi.')
  const results = await syncAll(45_000, only?.length ? only : undefined)
  return NextResponse.json({ results, status: await syncStatus() })
})
