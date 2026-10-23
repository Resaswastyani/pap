// Perizinan & legalitas perusahaan (Guidance HR "mengurus perijinan perusahaan"): daftar izin dengan masa berlaku & pengingat perpanjangan.
import type { RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageHr } from '@/lib/hrd'
import type { UserProfile } from '@/lib/users'

type Row = RowDataPacket & Record<string, unknown>

export const PERMIT_KATEGORI = ['Legalitas usaha', 'Perpajakan', 'Lingkungan', 'Ketenagakerjaan', 'Sertifikasi produk', 'Bangunan & lokasi', 'Kendaraan', 'Lainnya'] as const

export function requirePermit(user: UserProfile) {
  if (!user.menus.includes('perizinan' as never)) fail(403, 'Anda tidak punya akses ke menu Perizinan.')
}
export const canManagePermit = (user: UserProfile) => canManageHr(user) || ['general_affair', 'accounting'].includes(user.division.code)

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v)
export function readPermit(body: Record<string, unknown>) {
  const nama = str(body.nama, 200) || fail(400, 'Nama izin wajib diisi.')
  const terbit = str(body.tanggal_terbit, 10)
  const sampai = str(body.berlaku_sampai, 10)
  if ((terbit && !isDate(terbit)) || (sampai && !isDate(sampai))) fail(400, 'Tanggal tidak valid.')
  if (terbit && sampai && sampai < terbit) fail(400, 'Berlaku sampai sebelum tanggal terbit.')
  const ingat = body.pengingat_hari === '' || body.pengingat_hari == null ? 60 : Number(body.pengingat_hari)
  if (!Number.isInteger(ingat) || ingat < 0 || ingat > 365) fail(400, 'Pengingat 0–365 hari.')
  const file = str(body.file_url, 500)
  if (file && !/^https?:\/\//i.test(file)) fail(400, 'File harus berupa link (https://...).')
  return {
    nama, kategori: str(body.kategori, 80) || null, nomor: str(body.nomor, 120) || null, instansi: str(body.instansi, 200) || null,
    tanggal_terbit: terbit || null, berlaku_sampai: sampai || null, pengingat_hari: ingat, pic: str(body.pic, 150) || null, file_url: file || null, catatan: str(body.catatan, 1000) || null,
  }
}

const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
export function permitStatus(berlaku: string | null, pengingat: number) {
  if (!berlaku) return { status: 'tanpa_batas' as const, sisa_hari: null }
  const sisa = Math.round((Date.parse(berlaku) - Date.parse(today())) / 86400e3)
  return { status: sisa < 0 ? ('kadaluarsa' as const) : sisa <= pengingat ? ('segera_habis' as const) : ('aktif' as const), sisa_hari: sisa }
}

export async function listPermits() {
  const [rows] = await db.query<Row[]>(
    `SELECT p.*, DATE_FORMAT(p.tanggal_terbit, '%Y-%m-%d') AS terbit, DATE_FORMAT(p.berlaku_sampai, '%Y-%m-%d') AS sampai, u.name AS updated_name
     FROM company_permits p LEFT JOIN users u ON u.id = COALESCE(p.updated_by, p.created_by)
     ORDER BY p.berlaku_sampai IS NULL, p.berlaku_sampai, p.nama`,
  )
  return rows.map((r) => ({
    id: Number(r.id), nama: String(r.nama), kategori: (r.kategori as string) ?? null, nomor: (r.nomor as string) ?? null, instansi: (r.instansi as string) ?? null,
    tanggal_terbit: (r.terbit as string) ?? null, berlaku_sampai: (r.sampai as string) ?? null, pengingat_hari: Number(r.pengingat_hari), pic: (r.pic as string) ?? null,
    file_url: (r.file_url as string) ?? null, catatan: (r.catatan as string) ?? null, updated_name: (r.updated_name as string) ?? null, updated_at: String(r.updated_at),
    ...permitStatus((r.sampai as string) ?? null, Number(r.pengingat_hari)),
  }))
}
