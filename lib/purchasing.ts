// Purchasing (Guidance divisi Purchasing): database supplier, PO pembelian, harga bahan, hutang supplier.
// Data transaksi diambil dari Accurate Online (hanya baca, lihat lib/accurate-sync.ts); PAP-MS hanya menyimpan
// catatan Purchasing per supplier (vendor_profiles).
import type { RowDataPacket } from 'mysql2'
import { fail } from '@/lib/api'
import { isManagement, type UserProfile } from '@/lib/users'

export const PURCHASING_MENUS = ['supplier', 'po-pembelian', 'harga-bahan', 'hutang-supplier'] as const
export type PurchasingMenu = (typeof PURCHASING_MENUS)[number]

const hasMenu = (user: UserProfile, key: string) => user.menus.includes(key as never)
export const canViewPurchasing = (user: UserProfile) => PURCHASING_MENUS.some((m) => hasMenu(user, m))
export function requirePurchasingMenu(user: UserProfile, ...keys: PurchasingMenu[]) {
  if (!keys.some((k) => hasMenu(user, k))) fail(403, 'Anda tidak punya akses ke menu ini.')
}
// Catatan supplier (jenis, kontak, lead time, penilaian) diisi divisi Purchasing / GM / admin
export const canEditVendor = (user: UserProfile) => isManagement(user) || user.division.code === 'purchasing'

export const VENDOR_JENIS = { bahan_baku: 'Bahan baku', bahan_pendukung: 'Bahan pendukung', teknik: 'Teknik / sparepart', atk: 'ATK', jasa: 'Jasa', lainnya: 'Lainnya' } as const
export type VendorJenis = keyof typeof VENDOR_JENIS

// PO masih menunggu barang: belum diterima penuh dan tidak ditutup
export const PO_OPEN = "COALESCE(po.percent_shipped, 0) < 100 AND COALESCE(po.status, '') NOT IN ('CLOSED', 'FULLRECEIVED')"

export const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
export const todayWib = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
export type Row = RowDataPacket & Record<string, unknown>
