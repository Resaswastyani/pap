// Kunci menu: menu operasional dibuka per divisi (tabel division_menus),
// menu fitur dibuka lewat permission (lihat PERMISSION_MENUS)
export const MENU_KEYS = {
  Dashboard: 'dashboard',
  Prospek: 'prospek',
  'Jadwal Visit': 'visit',
  'Request Sample': 'sample',
  'Request Desain': 'desain',
  Customer: 'customer',
  'Data Produk': 'produk',
  Stok: 'stok',
  Quotation: 'quotation',
  'Tabel HPP': 'hpp',
  'Repeat Order': 'repeat-order',
  'KPI Marketing': 'kpi',
  'Kalender Konten': 'konten',
  Pembayaran: 'pembayaran',
  SPK: 'sbk',
  'Jadwal Produksi': 'jadwal-produksi',
  'Jadwal Shift': 'jadwal-shift',
  'Hasil Produksi': 'hasil-produksi',
  'Data Mesin': 'data-mesin',
  'Kerusakan Mesin': 'perbaikan-mesin',
  'Perawatan Mesin': 'perawatan-mesin',
  'Standar Setting': 'standar-setting',
  'Sparepart & Peralatan': 'sparepart',
  'Pengajuan Pembelian': 'pengajuan-pembelian',
  'Formulasi Produk': 'formulasi',
  Karyawan: 'karyawan',
  Absensi: 'absensi',
  Planning: 'planning',
  'Progress Kerja': 'progress-kerja',
  Meeting: 'meeting',
  'Master Data': 'master-data',
  'Manajemen User': 'users',
  'Manajemen Role': 'roles',
  Pengaturan: 'pengaturan',
} as const

export type MenuKey = (typeof MENU_KEYS)[keyof typeof MENU_KEYS]

export const ALL_MENU_KEYS = Object.values(MENU_KEYS) as MenuKey[]

export const PERMISSION_MENUS: Partial<Record<MenuKey, string>> = {
  planning: 'planning.view',
  meeting: 'meeting.view',
  users: 'users.manage',
  roles: 'roles.manage',
}
