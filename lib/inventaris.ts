// Inventaris (General Affair): aset / barang inventaris kantor beserta riwayat mutasi, kondisi, dan perbaikan.
import type { RowDataPacket } from 'mysql2'
import { fail, int, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageGa } from '@/lib/ga'
import type { UserProfile } from '@/lib/users'

export const INV_KONDISI = { baik: 'Baik', perlu_perbaikan: 'Perlu perbaikan', rusak: 'Rusak', hilang: 'Hilang' } as const
export type InvKondisi = keyof typeof INV_KONDISI
export const INV_LOG_JENIS = { tambah: 'Didata', mutasi: 'Mutasi', kondisi: 'Kondisi', perbaikan: 'Perbaikan', catatan: 'Catatan', penghapusan: 'Penghapusan' } as const
export type InvLogJenis = keyof typeof INV_LOG_JENIS
// Kategori yang disarankan di form (boleh diketik bebas)
export const INV_KATEGORI = ['Elektronik', 'Komputer & Laptop', 'Furnitur', 'Kendaraan', 'Peralatan Kantor', 'Peralatan Dapur', 'AC & Pendingin', 'Lainnya']

export const canViewInventaris = (user: UserProfile) => user.menus.includes('ga-inventaris')
export const canManageInventaris = canManageGa
export function requireInventaris(user: UserProfile) {
  if (!canViewInventaris(user)) fail(403, 'Anda tidak punya akses ke menu Inventaris.')
}
export function requireInventarisManage(user: UserProfile) {
  requireInventaris(user)
  if (!canManageInventaris(user)) fail(403, 'Data inventaris dikelola General Affair.')
}

// Pajak / uji KIR kendaraan yang jatuh tempo <= 30 hari lagi (atau sudah lewat)
export const DUE_DAYS = 30
export const DUE_SQL = `(LEAST(COALESCE(i.pajak_tahunan, '9999-12-31'), COALESCE(i.pajak_lima_tahunan, '9999-12-31'), COALESCE(i.uji_kir, '9999-12-31')) <= CURDATE() + INTERVAL ${DUE_DAYS} DAY)`

export const INV_SELECT = `SELECT i.id, i.kode, i.nama, i.kategori, i.merek, i.nomor_seri, i.jumlah, i.lokasi, i.pemegang_id, u.name AS pemegang_nama, i.pemegang_lain,
  i.tanggal_beli, i.tahun, i.pajak_tahunan, i.pajak_lima_tahunan, i.uji_kir, i.harga_beli, i.kondisi, i.status, i.catatan, UNIX_TIMESTAMP(i.foto_at) AS foto_versi, i.created_at, i.updated_at,
  (SELECT MAX(l.tanggal) FROM ga_inventaris_logs l WHERE l.item_id = i.id AND l.jenis = 'perbaikan') AS perbaikan_terakhir
  FROM ga_inventaris i LEFT JOIN users u ON u.id = i.pemegang_id`

export const LOG_SELECT = `SELECT l.id, l.tanggal, l.jenis, l.keterangan, l.biaya, l.created_at, u.name AS created_name
  FROM ga_inventaris_logs l JOIN users u ON u.id = l.created_by`

type InvRow = RowDataPacket & {
  id: number; kode: string; nama: string; lokasi: string | null; pemegang_id: number | null; pemegang_nama: string | null; pemegang_lain: string | null
  kondisi: InvKondisi; status: 'aktif' | 'dihapuskan'
}
export const serializeInv = (r: RowDataPacket) => ({ ...(r as InvRow), jumlah: Number(r.jumlah ?? 1), harga_beli: r.harga_beli === null ? null : Number(r.harga_beli), foto_versi: r.foto_versi ? String(r.foto_versi) : null })
export const serializeLog = (r: RowDataPacket) => ({ ...r, biaya: r.biaya === null ? null : Number(r.biaya) })

export async function loadInventaris(id: number) {
  const [[row]] = await db.query<RowDataPacket[]>(`${INV_SELECT} WHERE i.id = ?`, [id])
  return row ? serializeInv(row) : fail(404, 'Barang inventaris tidak ditemukan.')
}

export const todayWib = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)

export function readDate(value: unknown, label: string, required = false) {
  const v = str(value, 10)
  if (!v) return required ? fail(400, `${label} wajib diisi.`) : null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) fail(400, `${label} tidak valid.`)
  return v
}
export function readMoney(value: unknown, label: string) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(String(value).replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.'))
  if (!Number.isFinite(n) || n < 0 || n > 1e13) fail(400, `${label} tidak valid.`)
  return Math.round(n)
}

// { kode, nama, kategori, merek, nomor_seri, jumlah, lokasi, pemegang_id, pemegang_lain, tanggal_beli, harga_beli, kondisi, catatan,
//   tahun, pajak_tahunan, pajak_lima_tahunan, uji_kir (kendaraan) }
export async function readInventarisInput(body: Record<string, unknown>) {
  const nama = str(body.nama, 200)
  if (!nama) fail(400, 'Isi nama barang.')
  const kondisi = (str(body.kondisi, 20) || 'baik') as InvKondisi
  if (!(kondisi in INV_KONDISI)) fail(400, 'Kondisi tidak valid.')
  let pemegangId: number | null = null
  if (body.pemegang_id) {
    pemegangId = int(body.pemegang_id)
    const [[u]] = await db.query<RowDataPacket[]>('SELECT id FROM users WHERE id = ? AND is_active = 1', [pemegangId])
    if (!u) fail(400, 'Pemegang tidak ditemukan.')
  }
  const jumlah = body.jumlah === undefined || body.jumlah === '' ? 1 : Number(body.jumlah)
  if (!Number.isInteger(jumlah) || jumlah < 1 || jumlah > 100000) fail(400, 'Jumlah harus angka bulat minimal 1.')
  const tahun = body.tahun === undefined || body.tahun === '' || body.tahun === null ? null : Number(body.tahun)
  if (tahun !== null && (!Number.isInteger(tahun) || tahun < 1950 || tahun > new Date().getFullYear() + 1)) fail(400, 'Tahun tidak valid.')
  return {
    jumlah, tahun,
    pajakTahunan: readDate(body.pajak_tahunan, 'Pajak tahunan'),
    pajakLimaTahunan: readDate(body.pajak_lima_tahunan, 'Pajak 5 tahunan'),
    ujiKir: readDate(body.uji_kir, 'Uji KIR'),
    kode: str(body.kode, 40).toUpperCase() || null, // kosong = dibuat otomatis INV-0001
    nama, kondisi, pemegangId,
    kategori: str(body.kategori, 100) || null,
    merek: str(body.merek, 150) || null,
    nomorSeri: str(body.nomor_seri, 150) || null,
    lokasi: str(body.lokasi, 150) || null,
    pemegangLain: pemegangId ? null : str(body.pemegang_lain, 150) || null,
    tanggalBeli: readDate(body.tanggal_beli, 'Tanggal beli'),
    hargaBeli: readMoney(body.harga_beli, 'Harga beli'),
    catatan: str(body.catatan, 5000) || null,
  }
}

export async function addInventarisLog(input: { itemId: number; jenis: InvLogJenis; keterangan: string | null; biaya?: number | null; tanggal?: string | null; userId: number }) {
  await db.query('INSERT INTO ga_inventaris_logs (item_id, tanggal, jenis, keterangan, biaya, created_by) VALUES (?, ?, ?, ?, ?, ?)', [
    input.itemId, input.tanggal ?? todayWib(), input.jenis, input.keterangan, input.biaya ?? null, input.userId,
  ])
}

export async function assertKodeFree(kode: string, exceptId?: number) {
  const [[row]] = await db.query<RowDataPacket[]>('SELECT id FROM ga_inventaris WHERE kode = ? AND id <> ?', [kode, exceptId ?? 0])
  if (row) fail(409, `Kode ${kode} sudah dipakai barang lain.`)
}
