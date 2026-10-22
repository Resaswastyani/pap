// Konstanta & tipe log aktivitas sistem (aman dipakai di komponen client)
export const ACTIVITY_ACTIONS = {
  create: 'Tambah',
  update: 'Ubah',
  delete: 'Hapus',
  upload: 'Unggah file',
  password: 'Ganti password',
  permission: 'Ubah permission',
  checkin: 'Check-in',
  import: 'Impor',
  sync: 'Sinkron',
  login: 'Login',
  login_failed: 'Login gagal',
  logout: 'Logout',
} as const
export type ActivityAction = keyof typeof ACTIVITY_ACTIONS

export const ACTIVITY_MODULES = [
  'Autentikasi', 'Manajemen User', 'Manajemen Role', 'Planning', 'Meeting', 'Prospek', 'Jadwal Visit',
  'Request Sample', 'Request Desain', 'Quotation', 'HPP', 'Repeat Order', 'Customer', 'Data Produk', 'Master Data',
  'Rencana Produksi', 'Kapasitas Produksi', 'Faktur Produksi', 'Accounting', 'Grade & Gaji', 'Jadwal Shift', 'Data Mesin', 'Perawatan Mesin', 'SOP Mesin', 'Sparepart & Peralatan', 'Pengajuan Pembelian', 'Supplier', 'PO Pembelian', 'Harga Bahan', 'Catatan', 'Accurate',
] as const

export type ActivityChange = { field: string; from: string | null; to: string | null }
export type DeviceType = 'desktop' | 'mobile' | 'tablet' | 'lainnya'
