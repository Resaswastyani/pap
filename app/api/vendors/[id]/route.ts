import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageTeknik, canProcessPurchase, requireTeknikMenu } from '@/lib/teknik'
import { serializeVendor, VENDOR_SELECT, vendorPurchases } from '@/lib/vendors'

type Ctx = { params: Promise<{ id: string }> }

async function loadVendor(ctx: Ctx) {
  const id = int((await ctx.params).id) ?? fail(404, 'Supplier tidak ditemukan.')
  const [[row]] = await db.query<RowDataPacket[]>(`${VENDOR_SELECT} WHERE v.accurate_id = ?`, [id])
  return row ? serializeVendor(row) : fail(404, 'Supplier tidak ditemukan.')
}

// Detail supplier + riwayat pembelian terakhir dari faktur pembelian Accurate (barang yang pernah dipasok)
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTeknikMenu(user, 'pengajuan-pembelian', 'Pengajuan Pembelian')
  const vendor = await loadVendor(ctx)
  let purchases: Awaited<ReturnType<typeof vendorPurchases>> = []
  let purchasesError: string | null = null
  try {
    purchases = await vendorPurchases(vendor.accurate_id)
  } catch (error) {
    purchasesError = `Riwayat pembelian dari Accurate tidak bisa dimuat: ${(error as Error).message}`
  }
  const [requests] = await db.query<RowDataPacket[]>(
    'SELECT id, nomor, status, created_at FROM purchase_requests WHERE vendor_accurate_id = ? ORDER BY id DESC LIMIT 20',
    [vendor.accurate_id],
  )
  return NextResponse.json({ item: vendor, purchases, purchasesError, requests })
})

// Tandai / batalkan "supplier teknik": { teknik: true | false | null } (null = kembali ke tebakan otomatis)
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTeknikMenu(user, 'pengajuan-pembelian', 'Pengajuan Pembelian')
  if (!canManageTeknik(user) && !canProcessPurchase(user)) fail(403, 'Penandaan supplier diatur oleh Teknik / Purchasing.')
  const vendor = await loadVendor(ctx)
  const body = await readJson(request)
  const value = body.teknik === true ? 1 : body.teknik === false ? 0 : null
  await db.query('UPDATE accurate_vendors SET teknik = ? WHERE accurate_id = ?', [value, vendor.accurate_id])
  return NextResponse.json({ item: await loadVendor(ctx) })
})
