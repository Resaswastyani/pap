import type { RowDataPacket } from 'mysql2'
import { db } from '@/lib/db'
import type { MenuKey } from '@/lib/menus'
import { prospectScope } from '@/lib/marketing'
import { visibilityClause } from '@/lib/meeting'
import { canViewAllDivisions } from '@/lib/planning'
import { quotationScope } from '@/lib/quotations'
import { designScope, sampleScope } from '@/lib/requests'
import type { UserProfile } from '@/lib/users'

// Hasil pencarian global (kotak "Cari data..." di header).
// page = menu tujuan; target = id detail yang dibuka (bila halaman mendukung), selain itu kata kunci diisikan ke pencarian halaman.
export type SearchHit = { page: string; title: string; sub: string | null; target?: Record<string, number>; query?: string }

type Source = {
  menu: MenuKey
  page: string
  sql: (user: UserProfile) => [string, unknown[]]
  hit: (r: RowDataPacket) => Omit<SearchHit, 'page'>
}

const LIMIT = 5
const like = (cols: string[]) => `(${cols.map((c) => `${c} LIKE ?`).join(' OR ')})`
const args = (n: number, term: string) => Array<string>(n).fill(term)

const SOURCES: Source[] = [
  {
    menu: 'customer', page: 'Customer',
    sql: () => [`SELECT id, name, customer_no, bill_city FROM customers c WHERE ${like(['c.name', 'c.customer_no', 'c.bill_city', 'c.mobile_phone'])} ORDER BY c.name`, []],
    hit: (r) => ({ title: r.name, sub: [r.customer_no, r.bill_city].filter(Boolean).join(' · ') || null, query: r.name }),
  },
  {
    menu: 'prospek', page: 'Prospek',
    sql: (u) => { const s = prospectScope(u); return [`SELECT p.id, p.nama_usaha, p.kontak_nama, p.kota FROM prospects p WHERE ${s.sql} AND ${like(['p.nama_usaha', 'p.kontak_nama', 'p.telepon', 'p.kota'])} ORDER BY p.updated_at DESC`, s.params] },
    hit: (r) => ({ title: r.nama_usaha, sub: [r.kontak_nama, r.kota].filter(Boolean).join(' · ') || null, target: { prospectId: r.id } }),
  },
  {
    menu: 'quotation', page: 'Quotation',
    sql: (u) => { const s = quotationScope(u); return [`SELECT q.id, q.nomor, q.kepada, q.status FROM quotations q WHERE ${s.sql} AND ${like(['q.nomor', 'q.kepada', 'q.order_nomor', 'q.kontak'])} ORDER BY q.id DESC`, s.params] },
    hit: (r) => ({ title: `${r.nomor} · ${r.kepada}`, sub: r.status, target: { quotationId: r.id } }),
  },
  {
    menu: 'sample', page: 'Request Sample',
    sql: (u) => { const s = sampleScope(u); return [`SELECT s.id, s.nomor, s.nama_produk, s.status FROM sample_requests s WHERE ${s.sql} AND ${like(['s.nomor', 's.nama_produk'])} ORDER BY s.id DESC`, s.params] },
    hit: (r) => ({ title: `${r.nomor} · ${r.nama_produk ?? ''}`, sub: r.status, target: { sampleId: r.id } }),
  },
  {
    menu: 'desain', page: 'Request Desain',
    sql: (u) => { const s = designScope(u); return [`SELECT d.id, d.nomor, d.judul, d.status FROM design_requests d WHERE ${s.sql} AND ${like(['d.nomor', 'd.judul'])} ORDER BY d.id DESC`, s.params] },
    hit: (r) => ({ title: `${r.nomor} · ${r.judul ?? ''}`, sub: r.status, target: { designId: r.id } }),
  },
  {
    menu: 'produk', page: 'Data Produk',
    sql: () => [`SELECT p.id, p.kode, p.nama, c.name AS customer FROM customer_products p LEFT JOIN customers c ON c.id = p.customer_id WHERE ${like(['p.kode', 'p.nama'])} ORDER BY p.nama`, []],
    hit: (r) => ({ title: r.nama, sub: [r.kode, r.customer].filter(Boolean).join(' · ') || null, query: r.nama }),
  },
  {
    menu: 'supplier', page: 'Supplier',
    sql: () => [`SELECT v.accurate_id, v.name, v.vendor_no, v.city FROM accurate_vendors v WHERE ${like(['v.name', 'v.vendor_no', 'v.city'])} ORDER BY v.name`, []],
    hit: (r) => ({ title: r.name, sub: [r.vendor_no, r.city].filter(Boolean).join(' · ') || null, query: r.name }),
  },
  {
    menu: 'harga-bahan', page: 'Harga Bahan',
    sql: () => [`SELECT m.id, m.kode, m.nama, m.jenis FROM raw_materials m WHERE ${like(['m.kode', 'm.nama'])} ORDER BY m.nama`, []],
    hit: (r) => ({ title: r.nama, sub: [r.kode, r.jenis].filter(Boolean).join(' · ') || null, query: r.nama }),
  },
  {
    menu: 'pengajuan-pembelian', page: 'Pengajuan Pembelian',
    sql: () => [`SELECT r.id, r.nomor, r.keperluan, r.status FROM purchase_requests r WHERE ${like(['r.nomor', 'r.keperluan', 'r.po_number'])} ORDER BY r.id DESC`, []],
    hit: (r) => ({ title: `${r.nomor} · ${r.keperluan ?? ''}`, sub: r.status, target: { pageId: r.id } }),
  },
  {
    menu: 'data-mesin', page: 'Data Mesin',
    sql: () => [`SELECT m.id, m.kode, m.nama, m.tahap FROM machines m WHERE ${like(['m.kode', 'm.nama'])} ORDER BY m.nama`, []],
    hit: (r) => ({ title: r.nama, sub: [r.kode, r.tahap].filter(Boolean).join(' · ') || null, query: r.nama }),
  },
  {
    menu: 'perbaikan-mesin', page: 'Kerusakan Mesin',
    sql: () => [`SELECT r.id, r.nomor, r.keluhan, r.status, m.nama AS mesin FROM machine_repairs r LEFT JOIN machines m ON m.id = r.machine_id WHERE ${like(['r.nomor', 'r.keluhan', 'm.nama'])} ORDER BY r.id DESC`, []],
    hit: (r) => ({ title: `${r.nomor} · ${r.mesin ?? ''}`, sub: r.keluhan, target: { repairId: r.id } }),
  },
  {
    menu: 'sparepart', page: 'Sparepart & Peralatan',
    sql: () => [`SELECT t.id, t.kode, t.nama, t.kategori FROM tech_items t WHERE ${like(['t.kode', 't.nama'])} ORDER BY t.nama`, []],
    hit: (r) => ({ title: r.nama, sub: [r.kode, r.kategori].filter(Boolean).join(' · ') || null, target: { pageId: r.id } }),
  },
  {
    menu: 'karyawan', page: 'Karyawan',
    sql: () => [`SELECT e.id, e.nama, e.nip, e.jabatan FROM employees e WHERE ${like(['e.nama', 'e.nip', 'e.jabatan', 'e.divisi'])} ORDER BY e.nama`, []],
    hit: (r) => ({ title: r.nama, sub: [r.nip, r.jabatan].filter(Boolean).join(' · ') || null, query: r.nama }),
  },
  {
    menu: 'training', page: 'Training',
    sql: () => [`SELECT t.id, t.judul, t.kategori FROM training_modules t WHERE ${like(['t.judul', 't.kategori'])} ORDER BY t.judul`, []],
    hit: (r) => ({ title: r.judul, sub: r.kategori, query: r.judul }),
  },
  {
    menu: 'planning', page: 'Planning',
    sql: (u) => [`SELECT p.id, p.nomor, p.judul, p.status FROM plannings p WHERE ${canViewAllDivisions(u) ? '1 = 1' : '(p.division_id = ? OR p.created_by = ?)'} AND ${like(['p.nomor', 'p.judul'])} ORDER BY p.id DESC`,
      canViewAllDivisions(u) ? [] : [u.division.id, u.id]],
    hit: (r) => ({ title: `${r.nomor} · ${r.judul}`, sub: r.status, target: { planningId: r.id } }),
  },
  {
    menu: 'meeting', page: 'Meeting',
    sql: (u) => { const [w, p] = visibilityClause(u); return [`SELECT m.id, m.nomor, m.judul, m.waktu FROM meetings m WHERE ${w} AND ${like(['m.nomor', 'm.judul', 'm.tempat'])} ORDER BY m.waktu DESC`, p] },
    hit: (r) => ({ title: `${r.nomor} · ${r.judul}`, sub: r.waktu ? String(r.waktu).slice(0, 16) : null, target: { meetingId: r.id } }),
  },
  {
    menu: 'users', page: 'Manajemen User',
    sql: () => [`SELECT u.id, u.name, u.email FROM users u WHERE ${like(['u.name', 'u.email'])} ORDER BY u.name`, []],
    hit: (r) => ({ title: r.name, sub: r.email, query: r.name }),
  },
]

export async function globalSearch(user: UserProfile, q: string): Promise<SearchHit[]> {
  const term = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const sources = SOURCES.filter((s) => user.menus.includes(s.menu))
  const groups = await Promise.all(sources.map(async (s) => {
    const [sql, params] = s.sql(user)
    const likeCount = (sql.match(/ LIKE \?/g) ?? []).length
    try {
      const [rows] = await db.query<RowDataPacket[]>(`${sql} LIMIT ${LIMIT}`, [...params, ...args(likeCount, term)])
      return rows.map((r) => ({ page: s.page, ...s.hit(r) }))
    } catch {
      return [] // satu sumber gagal (mis. tabel belum ada) tidak menggagalkan pencarian lain
    }
  }))
  return groups.flat()
}
