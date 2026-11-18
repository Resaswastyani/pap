import { fail } from '@/lib/api'
import { isManagement, type UserProfile } from '@/lib/users'

// Stok Bahan Baku & Barang Jadi: kelompok barang Accurate dan hak kelola data barang
export const STOCK_CATEGORY_GROUPS = {
  bahan: ['BIJI PLASTIK', 'ROLL MIKA'],
  pembantu: ['TINTA', 'SOLVEN', 'SOLVENT', 'BOX MIKA'],
}
export type StockJenis = 'bahan' | 'pembantu' | 'jadi'

// Tambah / ubah / hapus barang (langsung di Accurate): Admin / GM, PPIC, Purchasing, Inventory / Gudang
export const canManageStock = (user: UserProfile) => isManagement(user) || ['ppic', 'purchasing', 'inventory', 'gudang'].includes(user.division.code)
export function requireManageStock(user: UserProfile) {
  if (!user.menus.includes('stok' as never)) fail(403, 'Anda tidak punya akses ke menu Stok.')
  if (!canManageStock(user)) fail(403, 'Data barang dikelola oleh Admin / GM, PPIC, Purchasing, atau Inventory.')
}
