import { fail, str } from '@/lib/api'
import type { UserProfile } from '@/lib/users'

// Master Data: dikelola Admin & Super Admin, dilihat semua divisi yang punya menu Master Data
export const canManageMaster = (user: UserProfile) => user.role.isAdmin

export function requireMaster(user: UserProfile) {
  if (!user.menus.includes('master-data')) fail(403, 'Anda tidak punya akses ke Master Data.')
}

export function readPackagingInput(body: Record<string, unknown>) {
  const kode = str(body.kode, 30).toUpperCase()
  const nama = str(body.nama, 150)
  if (!kode || !nama) fail(400, 'Kode dan nama produk packaging wajib diisi.')
  const opt = (key: string, max = 255) => str(body[key], max) || null
  return {
    kode,
    nama,
    bahan: opt('bahan', 150),
    proses: opt('proses', 255),
    ketebalan: opt('ketebalan', 100),
    kegunaan: opt('kegunaan', 500),
    keterangan: opt('keterangan', 5000),
    status: body.status === 'nonaktif' ? 'nonaktif' : 'aktif',
  }
}

// Jenis file desain untuk ikon & filter
export const DESIGN_KIND_SQL = {
  gambar: "f.mime LIKE 'image/%'",
  pdf: "f.mime = 'application/pdf'",
  sumber: "(f.mime NOT LIKE 'image/%' AND f.mime <> 'application/pdf')", // CDR, AI, PSD, ...
} as const
