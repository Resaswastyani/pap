// Kunci menu: menu operasional dibuka per divisi (tabel division_menus),
// menu fitur dibuka lewat permission (lihat PERMISSION_MENUS)
export const MENU_KEYS = {
  Dashboard: 'dashboard',
  Customer: 'customer',
  Quotation: 'quotation',
  'Surat Berita Kerja': 'sbk',
  'Jadwal Produksi': 'jadwal-produksi',
  'Data Mesin': 'data-mesin',
  Karyawan: 'karyawan',
  Absensi: 'absensi',
  Planning: 'planning',
  'Progress Kerja': 'progress-kerja',
  Meeting: 'meeting',
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
