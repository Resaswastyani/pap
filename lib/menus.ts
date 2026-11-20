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
  // Dua menu stok (Produksi) memakai satu hak akses 'stok' (Stok Bahan Pembantu disembunyikan dulu)
  'Stok Bahan Baku': 'stok',
  'Stok Barang Jadi': 'stok',
  Quotation: 'quotation',
  'Tabel HPP': 'hpp',
  'Repeat Order': 'repeat-order',
  'Kendala Customer': 'kendala-customer',
  'Dokumen Order': 'dokumen-order',
  'KPI Marketing': 'kpi',
  'Kalender Konten': 'konten',
  Pembayaran: 'pembayaran',
  'Rencana Produksi': 'jadwal-produksi',
  // Analisis Bahan Baku: menu sendiri di Produksi, hak aksesnya mengikuti menu Rencana Produksi
  'Analisis Bahan Baku': 'jadwal-produksi',
  'Kapasitas Produksi': 'kapasitas-produksi',
  'Jadwal Shift': 'jadwal-shift',
  'Hasil Produksi': 'hasil-produksi',
  'Faktur Produksi': 'faktur-produksi',
  'Analisa Teknik Order': 'analisa-teknik',
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
  // Jobdesk: menu sendiri di SDM, hak aksesnya mengikuti menu Karyawan
  Jobdesk: 'karyawan',
  Absensi: 'absensi',
  'Grade & Gaji': 'grade-gaji',
  Lembur: 'lembur',
  Training: 'training',
  'Izin & Cuti': 'izin-cuti',
  'KPI Karyawan': 'kpi-karyawan',
  'Laporan BPJS': 'bpjs',
  Perizinan: 'perizinan',
  'Data GA': 'ga-data',
  'Pengajuan GA': 'ga-pengajuan',
  // Menu Inventaris lama: kini tab "Inventaris lainnya" di menu Inventaris (kunci ga-data); kunci tetap untuk tautan lama
  Inventaris: 'ga-inventaris',
  'Jadwal Service Inventaris': 'ga-service',
  'Belanja ATK & RTK': 'ga-belanja',
  Planning: 'planning',
  Meeting: 'meeting',
  'Master Data': 'master-data',
  'Manajemen User': 'users',
  'Manajemen Role': 'roles',
  Pengaturan: 'pengaturan',
  'Data Terhapus': 'data-terhapus',
  'Tiket Kendala': 'tiket',
  'Action Plan': 'action-plan',
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
  { label: 'Marketing', items: ['Prospek', 'Jadwal Visit', 'Request Sample', 'Request Desain', 'Customer', 'Order Bulanan', 'Repeat Order', 'Kendala Customer', 'Data Produk', 'Quotation', 'Dokumen Order', 'Kalender Konten', 'KPI Marketing'] },
  { label: 'Produksi', items: ['Rencana Produksi', 'Kapasitas Produksi', 'Hasil Produksi', 'Faktur Produksi', 'Formulasi Produk', 'Jadwal Shift', 'Stok'] },
  { label: 'Logistik', items: ['Pengiriman', 'Ekspedisi'] },
  { label: 'Teknik', items: ['Analisa Teknik Order', 'Data Mesin', 'Kerusakan Mesin', 'Perawatan Mesin', 'SOP Mesin', 'Sparepart & Peralatan'] },
  { label: 'Purchasing', items: ['Pengajuan Pembelian', 'PO Pembelian', 'Supplier', 'Harga Bahan', 'Hutang Supplier'] },
  { label: 'Accounting', items: ['Ringkasan Keuangan', 'Kas & Bank', 'Piutang Customer', 'Laporan Keuangan', 'Arus Kas', 'Pajak'] },
  { label: 'SDM', items: ['Karyawan', 'Grade & Gaji', 'Lembur', 'Absensi', 'Training', 'Izin & Cuti', 'KPI Karyawan', 'Laporan BPJS', 'Perizinan'] },
  { label: 'General Affair', items: ['Data GA', 'Jadwal Service Inventaris', 'Pengajuan GA', 'Belanja ATK & RTK'] },
  { label: 'Kolaborasi', items: ['Planning', 'Meeting'] },
  { label: 'Sistem', items: ['Master Data', 'Manajemen User', 'Manajemen Role'] },
]
// Kunci menu yang bisa diatur per divisi (selain ini, isi division_menus tidak disentuh saat disimpan)
export const CONFIGURABLE_MENU_KEYS = MENU_GROUPS.flatMap((g) => g.items.map((label) => MENU_KEYS[label])) as MenuKey[]

// Nama menu yang tampil di layar bila berbeda dari kunci internalnya (kunci tetap dipakai untuk akses, notifikasi & log)
export const MENU_DISPLAY: Record<string, string> = { 'Tiket Kendala': 'Tiket Kendala (IT Support)', 'Faktur Produksi': 'Faktur Penjualan', 'Data GA': 'Inventaris' }
export const menuName = (label: string) => MENU_DISPLAY[label] ?? label
