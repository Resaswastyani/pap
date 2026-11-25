// Matriks akses Menu x Aksi per role. Ditegakkan terpusat:
//   - view   : menu disembunyikan dari sidebar & API menu itu menolak (lewat user.menus, lihat lib/users.ts toProfile)
//   - create / update / delete : setiap POST / PUT / PATCH / DELETE ke API menu itu diperiksa di handle() (lib/api.ts)
// Bawaan semua diizinkan; yang disimpan hanya pencabutan (tabel role_menu_denials). Super Admin selalu boleh.
import type { MenuKey } from '@/lib/menus'

export const MENU_ACTIONS = { view: 'Lihat', create: 'Tambah', update: 'Ubah', delete: 'Hapus' } as const
export type MenuAction = keyof typeof MENU_ACTIONS
export const ACTION_KEYS = Object.keys(MENU_ACTIONS) as MenuAction[]

// Endpoint API -> menu (prefiks terpanjang menang). Satu endpoint bisa dipakai beberapa menu: aksi diizinkan bila
// diizinkan di salah satu menu yang dimiliki user.
export const API_MENUS: [string, MenuKey[]][] = [
  ['/api/prospects', ['prospek']],
  ['/api/visits', ['visit']],
  ['/api/samples', ['sample']],
  ['/api/designs', ['desain']],
  ['/api/customers', ['customer']],
  ['/api/orders/monthly', ['order-bulanan']],
  ['/api/repeat-order', ['repeat-order']],
  ['/api/complaints', ['kendala-customer']],
  ['/api/products', ['produk']],
  ['/api/quotations', ['quotation']],
  ['/api/order-documents', ['dokumen-order']],
  ['/api/sales-orders', ['dokumen-order']],
  ['/api/order-custom', ['order-custom']],
  ['/api/content', ['konten']],
  ['/api/kpi', ['kpi']],
  ['/api/payments', ['pembayaran']],
  ['/api/hpp', ['hpp']],
  ['/api/production/results', ['hasil-produksi']],
  ['/api/production/finished', ['hasil-produksi']],
  ['/api/production/stages', ['hasil-produksi']],
  ['/api/production', ['jadwal-produksi']],
  ['/api/capacity', ['kapasitas-produksi']],
  ['/api/faktur', ['faktur-produksi']],
  ['/api/formulations', ['formulasi']],
  ['/api/shift-schedule', ['jadwal-shift']],
  ['/api/stock', ['stok']],
  ['/api/logistik/shipments', ['pengiriman']],
  ['/api/logistik/expeditions', ['ekspedisi']],
  ['/api/expeditions', ['ekspedisi']],
  ['/api/tech-analyses', ['analisa-teknik', 'analisa-teknik-mkt', 'analisa-teknik-ppic', 'prospek', 'produk']],
  ['/api/machines', ['data-mesin']],
  ['/api/repairs', ['perbaikan-mesin']],
  ['/api/maintenance', ['perawatan-mesin']],
  ['/api/sop', ['sop-mesin']],
  ['/api/tech-items', ['sparepart']],
  ['/api/purchase-requests', ['pengajuan-pembelian']],
  ['/api/purchasing/orders', ['po-pembelian']],
  ['/api/purchasing/items', ['po-pembelian']],
  ['/api/purchasing/vendors', ['supplier']],
  ['/api/purchasing/vendor-prices', ['harga-bahan']],
  ['/api/purchasing/prices', ['harga-bahan']],
  ['/api/purchasing/materials', ['harga-bahan']],
  ['/api/purchasing/payables', ['hutang-supplier']],
  ['/api/vendors', ['supplier']],
  ['/api/accounting/cash', ['kas-bank']],
  ['/api/accounting/receivables', ['piutang']],
  ['/api/accounting/reports', ['laporan-keuangan']],
  ['/api/accounting/cashflow', ['arus-kas']],
  ['/api/accounting/tax', ['pajak']],
  ['/api/accounting', ['keuangan']],
  ['/api/hrd/employees', ['karyawan']],
  ['/api/hrd/jobdesks', ['karyawan']],
  ['/api/hrd/sheet', ['karyawan']],
  ['/api/hrd/payroll', ['grade-gaji']],
  ['/api/hrd/attendance', ['absensi']],
  ['/api/hrd/training', ['training']],
  ['/api/hrd/tests', ['training']],
  ['/api/hrd/leaves', ['izin-cuti']],
  ['/api/hrd/kpi', ['kpi-karyawan']],
  ['/api/hrd/bpjs', ['bpjs']],
  ['/api/hrd/permits', ['perizinan']],
  ['/api/ga/requests', ['ga-pengajuan']],
  ['/api/ga/service', ['ga-service']],
  ['/api/ga/belanja', ['ga-belanja']],
  ['/api/ga', ['ga-data']],
  ['/api/planning', ['planning']],
  ['/api/meetings', ['meeting']],
  ['/api/action-plan', ['action-plan']],
  ['/api/tickets', ['tiket']],
  ['/api/users', ['users']],
  ['/api/roles', ['roles']],
  ['/api/divisions', ['roles']],
  ['/api/master', ['master-data']],
  ['/api/recycle-bin', ['data-terhapus']],
]

// Menu yang punya aksi tulis (tambah / ubah / hapus) lewat API; menu lain hanya "Lihat"
export const WRITABLE_MENUS = new Set<string>(API_MENUS.flatMap(([, keys]) => keys))

export function menusForPath(pathname: string): MenuKey[] | null {
  let best: [string, MenuKey[]] | null = null
  for (const entry of API_MENUS) if ((pathname === entry[0] || pathname.startsWith(`${entry[0]}/`)) && (!best || entry[0].length > best[0].length)) best = entry
  return best ? best[1] : null
}

// POST ke koleksi = tambah; POST ke data tertentu (/api/x/12/...) = ubah / aksi; PUT & PATCH = ubah; DELETE = hapus
export function actionFor(method: string, pathname: string): MenuAction | null {
  if (method === 'DELETE') return 'delete'
  if (method === 'PUT' || method === 'PATCH') return 'update'
  if (method === 'POST') return /\/\d+(\/|$)/.test(pathname) ? 'update' : 'create'
  return null
}
