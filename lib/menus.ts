// Kunci menu: menu operasional dibuka per divisi (tabel division_menus),
// menu fitur dibuka lewat permission (lihat PERMISSION_MENUS)
export const MENU_KEYS = {
  Dashboard: 'dashboard',
  Monitoring: 'monitoring',
  Prospek: 'prospek',
  'Jadwal Visit': 'visit',
  'Request Sample': 'sample',
  'Request Desain': 'desain',
  Customer: 'customer',
  'Order Bulanan': 'order-bulanan',
  'Data Produk': 'produk',
  Stok: 'stok',
  Quotation: 'quotation',
  'Tabel HPP': 'hpp',
  'Repeat Order': 'repeat-order',
  'Dokumen Order': 'dokumen-order',
  'KPI Marketing': 'kpi',
  'Kalender Konten': 'konten',
  Pembayaran: 'pembayaran',
  'Rencana Produksi': 'jadwal-produksi',
  'Kapasitas Produksi': 'kapasitas-produksi',
  'Jadwal Shift': 'jadwal-shift',
  'Hasil Produksi': 'hasil-produksi',
  'Faktur Produksi': 'faktur-produksi',
  'Data Mesin': 'data-mesin',
  'Kerusakan Mesin': 'perbaikan-mesin',
  'Perawatan Mesin': 'perawatan-mesin',
  'SOP Mesin': 'sop-mesin',
  'Sparepart & Peralatan': 'sparepart',
  'Pengajuan Pembelian': 'pengajuan-pembelian',
  Supplier: 'supplier',
  'PO Pembelian': 'po-pembelian',
  'Harga Bahan': 'harga-bahan',
  'Hutang Supplier': 'hutang-supplier',
  Pengiriman: 'pengiriman',
  Ekspedisi: 'ekspedisi',
  'Ringkasan Keuangan': 'keuangan',
  'Kas & Bank': 'kas-bank',
  'Piutang Customer': 'piutang',
  'Laporan Keuangan': 'laporan-keuangan',
  'Arus Kas': 'arus-kas',
  Pajak: 'pajak',
  'Formulasi Produk': 'formulasi',
  Karyawan: 'karyawan',
  Absensi: 'absensi',
  'Grade & Gaji': 'grade-gaji',
  Training: 'training',
  'Izin & Cuti': 'izin-cuti',
  'KPI Karyawan': 'kpi-karyawan',
  'Laporan BPJS': 'bpjs',
  Perizinan: 'perizinan',
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

// Susunan menu seperti di sidebar, untuk pengaturan menu per divisi (Manajemen Role).
// Tidak termasuk Pengaturan (selalu terbuka) serta menu yang disembunyikan (Tabel HPP, Pembayaran).
export const MENU_GROUPS: { label: string; items: (keyof typeof MENU_KEYS)[] }[] = [
  { label: 'Ringkasan', items: ['Dashboard', 'Monitoring'] },
  { label: 'Marketing', items: ['Prospek', 'Jadwal Visit', 'Request Sample', 'Request Desain', 'Customer', 'Order Bulanan', 'Repeat Order', 'Data Produk', 'Quotation', 'Dokumen Order', 'Kalender Konten', 'KPI Marketing'] },
  { label: 'Produksi', items: ['Rencana Produksi', 'Kapasitas Produksi', 'Hasil Produksi', 'Faktur Produksi', 'Formulasi Produk', 'Jadwal Shift', 'Stok'] },
  { label: 'Logistik', items: ['Pengiriman', 'Ekspedisi'] },
  { label: 'Teknik', items: ['Data Mesin', 'Kerusakan Mesin', 'Perawatan Mesin', 'SOP Mesin', 'Sparepart & Peralatan'] },
  { label: 'Purchasing', items: ['Pengajuan Pembelian', 'PO Pembelian', 'Supplier', 'Harga Bahan', 'Hutang Supplier'] },
  { label: 'Accounting', items: ['Ringkasan Keuangan', 'Kas & Bank', 'Piutang Customer', 'Laporan Keuangan', 'Arus Kas', 'Pajak'] },
  { label: 'SDM', items: ['Karyawan', 'Grade & Gaji', 'Absensi', 'Training', 'Izin & Cuti', 'KPI Karyawan', 'Laporan BPJS', 'Perizinan'] },
  { label: 'Kolaborasi', items: ['Planning', 'Progress Kerja', 'Meeting'] },
  { label: 'Sistem', items: ['Master Data', 'Manajemen User', 'Manajemen Role'] },
]
// Kunci menu yang bisa diatur per divisi (selain ini, isi division_menus tidak disentuh saat disimpan)
export const CONFIGURABLE_MENU_KEYS = MENU_GROUPS.flatMap((g) => g.items.map((label) => MENU_KEYS[label])) as MenuKey[]
