// Supplier (vendor) dari Accurate untuk Pengajuan Pembelian: siapa yang memasok mesin, sparepart, dan jasa bengkel.
// Data vendor disinkron ke accurate_vendors; riwayat pembelian per vendor dibaca langsung dari faktur pembelian Accurate.
import type { RowDataPacket } from 'mysql2'
import { accurate, accurateEnabled, fromAccurateDate } from '@/lib/accurate'
import { fail } from '@/lib/api'
import { db } from '@/lib/db'

export const VENDOR_STALE_HOURS = 24
const SYNC_KEY = 'accurate.vendors_synced'

// Tebakan "supplier teknik" dari kategori & nama vendor di Accurate
const TEKNIK_CATEGORY = /tehnik|teknik|bengkel|cylinder|silinder|mesin|sparepart|spare part/i
const TEKNIK_NAME = /bengkel|tehnik|teknik|tenik|mesin|engineering|mekani|motor|elektr|listrik|bearing|pneuma|hidrol|hydraul|welding|\blas\b|bubut|sparepart|spare part|machin|tools?\b/i
export const guessTeknik = (category: string | null, name: string) => TEKNIK_CATEGORY.test(category ?? '') || TEKNIK_NAME.test(name)
export const VENDOR_SELECT = `SELECT v.accurate_id, v.vendor_no, v.name, v.category, v.mobile_phone, v.work_phone, v.email, v.city, v.address, v.suspended, v.teknik,
  v.synced_at,
  (SELECT COUNT(*) FROM purchase_requests pr WHERE pr.vendor_accurate_id = v.accurate_id) AS pengajuan
  FROM accurate_vendors v`

export const serializeVendor = (r: RowDataPacket) => ({
  ...(r as RowDataPacket & { accurate_id: number; name: string; vendor_no: string | null; category: string | null; city: string | null }),
  suspended: !!r.suspended,
  teknik: r.teknik === null ? null : !!r.teknik,
  // Nilai efektif: penandaan manual menang atas tebakan
  teknik_efektif: r.teknik === null ? guessTeknik(r.category, r.name) : !!r.teknik,
  pengajuan: Number(r.pengajuan ?? 0),
})

export async function vendorSyncInfo(): Promise<{ at: string | null; count: number }> {
  const [[row]] = await db.query<(RowDataPacket & { value: string | null })[]>('SELECT value FROM app_settings WHERE `key` = ?', [SYNC_KEY])
  try {
    return { at: null, count: 0, ...JSON.parse(row?.value ?? '{}') }
  } catch {
    return { at: null, count: 0 }
  }
}

type AccVendor = {
  id: number; vendorNo?: string; name: string; category?: { name?: string } | null; mobilePhone?: string | null; workPhone?: string | null
  email?: string | null; billCity?: string | null; billStreet?: string | null; suspended?: boolean
}

// Ambil semua vendor dari Accurate (penandaan manual tidak ditimpa)
export async function syncVendors() {
  if (!accurateEnabled()) fail(400, 'Integrasi Accurate belum dikonfigurasi.')
  const rows: AccVendor[] = []
  for (let page = 1; ; page++) {
    const res = await accurate<AccVendor[]>('/api/vendor/list.do', {
      params: { 'sp.page': page, 'sp.pageSize': 100, fields: 'id,vendorNo,name,category,mobilePhone,workPhone,email,billCity,billStreet,suspended' },
    })
    rows.push(...(res.d ?? []))
    if (!res.sp || page >= res.sp.pageCount) break
  }
  const [[{ now }]] = await db.query<(RowDataPacket & { now: string })[]>('SELECT NOW() AS now')
  if (rows.length) {
    await db.query(
      `INSERT INTO accurate_vendors (accurate_id, vendor_no, name, category, mobile_phone, work_phone, email, city, address, suspended, synced_at) VALUES ?
       ON DUPLICATE KEY UPDATE vendor_no = VALUES(vendor_no), name = VALUES(name), category = VALUES(category), mobile_phone = VALUES(mobile_phone),
         work_phone = VALUES(work_phone), email = VALUES(email), city = VALUES(city), address = VALUES(address), suspended = VALUES(suspended), synced_at = VALUES(synced_at)`,
      [rows.map((v) => [
        v.id, v.vendorNo?.slice(0, 50) ?? null, v.name.slice(0, 255), v.category?.name?.slice(0, 150) ?? null, v.mobilePhone?.slice(0, 80) || null,
        v.workPhone?.slice(0, 80) || null, v.email?.slice(0, 255) || null, v.billCity?.slice(0, 150) || null, v.billStreet?.slice(0, 500) || null, v.suspended ? 1 : 0, now,
      ])],
    )
    // Vendor yang sudah dihapus di Accurate: hapus bila belum dipakai pengajuan
    await db.query('DELETE FROM accurate_vendors WHERE synced_at < ? AND accurate_id NOT IN (SELECT vendor_accurate_id FROM purchase_requests WHERE vendor_accurate_id IS NOT NULL)', [now])
  }
  const info = { at: now, count: rows.length }
  await db.query('INSERT INTO app_settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)', [SYNC_KEY, JSON.stringify(info)])
  return info
}

export const vendorsStale = (at: string | null) => !at || Date.now() - new Date(`${at.replace(' ', 'T')}+07:00`).getTime() > VENDOR_STALE_HOURS * 3600e3

// Riwayat pembelian dari vendor (faktur pembelian Accurate terbaru beserta barangnya); di-cache 10 menit
type Purchase = { number: string; tanggal: string | null; total: number; items: { nama: string; jumlah: number; satuan: string | null; harga: number }[] }
const cache = new Map<number, { at: number; data: Purchase[] }>()
export async function vendorPurchases(vendorId: number, limit = 8) {
  const hit = cache.get(vendorId)
  if (hit && Date.now() - hit.at < 10 * 60e3) return hit.data
  const list = await accurate<{ id: number; number: string; transDate: string; totalAmount: number }[]>('/api/purchase-invoice/list.do', {
    params: { 'sp.pageSize': limit, 'sp.sort': 'transDate|desc', fields: 'id,number,transDate,totalAmount', 'filter.vendorId.op': 'EQUAL', 'filter.vendorId.val': vendorId },
  })
  const data: Purchase[] = []
  for (const inv of list.d ?? []) {
    const detail = await accurate<{ detailItem?: { item?: { name?: string }; detailName?: string; quantity?: number; itemUnit?: { name?: string }; unitPrice?: number }[] }>(
      '/api/purchase-invoice/detail.do',
      { params: { id: inv.id } },
    )
    data.push({
      number: inv.number,
      tanggal: fromAccurateDate(inv.transDate),
      total: Number(inv.totalAmount ?? 0),
      items: (detail.d?.detailItem ?? []).map((i) => ({ nama: i.detailName || i.item?.name || '-', jumlah: Number(i.quantity ?? 0), satuan: i.itemUnit?.name ?? null, harga: Number(i.unitPrice ?? 0) })),
    })
  }
  cache.set(vendorId, { at: Date.now(), data })
  return data
}
