import type { RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'
import { HPP_PARAM_KEYS, type HppParams } from '@/lib/hpp-calc'
import { isLeadOf, isManagement, type UserProfile } from '@/lib/users'

// Harga bahan baku diperbarui Kepala Purchasing / GM (staff Purchasing melihat saja); parameter biaya & data dokumen oleh Admin / GM
export const canEditPrices = (user: UserProfile) => isManagement(user) || isLeadOf(user, 'purchasing')
export const canEditHppParams = (user: UserProfile) => user.role.isAdmin || user.division.code === 'general_manager'
export const canViewHpp = (user: UserProfile) => user.menus.includes('hpp') || user.menus.includes('quotation')

export function requireHpp(user: UserProfile) {
  if (!canViewHpp(user)) fail(403, 'Anda tidak punya akses ke Tabel HPP.')
}

export async function loadSettings(prefix: 'hpp.' | 'doc.') {
  const [rows] = await db.query<(RowDataPacket & { key: string; value: string | null })[]>('SELECT `key`, value FROM app_settings WHERE `key` LIKE ?', [`${prefix}%`])
  return Object.fromEntries(rows.map((r) => [r.key.slice(prefix.length), r.value ?? ''])) as Record<string, string>
}

export async function loadHppParams(): Promise<HppParams> {
  const raw = await loadSettings('hpp.')
  return Object.fromEntries(HPP_PARAM_KEYS.map((k) => [k, Number(raw[k] ?? 0) || 0])) as HppParams
}

export async function saveSettings(prefix: 'hpp.' | 'doc.', values: Record<string, unknown>, allowed: string[], userId: number) {
  const rows: unknown[][] = []
  for (const key of allowed) {
    if (values[key] === undefined) continue
    let value = str(values[key], 2000)
    if (prefix === 'hpp.') {
      const n = Number(String(values[key]).replace(',', '.'))
      if (!Number.isFinite(n) || n < 0) fail(400, `Nilai ${key} harus angka ≥ 0.`)
      value = String(n)
    }
    rows.push([`${prefix}${key}`, value, userId])
  }
  if (rows.length) {
    await db.query('INSERT INTO app_settings (`key`, value, updated_by) VALUES ? ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)', [rows])
  }
}

export const DOC_KEYS = ['nama', 'alamat', 'telepon', 'email', 'rekening', 'syarat', 'penandatangan']

export type MaterialRow = { id: number; kode: string; nama: string; jenis: string; satuan: string; harga: number; density: number | null; aktif: number }

export async function loadMaterials(activeOnly = false) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT m.*, u.name AS updated_by_name,
       (SELECT p.harga FROM raw_material_prices p WHERE p.material_id = m.id ORDER BY p.id DESC LIMIT 1 OFFSET 1) AS harga_sebelumnya
     FROM raw_materials m LEFT JOIN users u ON u.id = m.updated_by
     ${activeOnly ? 'WHERE m.aktif = 1' : ''} ORDER BY FIELD(m.jenis, 'resin', 'pewarna', 'tinta', 'aditif', 'lainnya'), m.nama`,
  )
  return rows.map((m) => ({
    ...(m as RowDataPacket & MaterialRow),
    harga: Number(m.harga),
    density: m.density === null ? null : Number(m.density),
    harga_sebelumnya: m.harga_sebelumnya === null ? null : Number(m.harga_sebelumnya) as number | null,
  })) as (MaterialRow & { harga_sebelumnya: number | null; keterangan: string | null; updated_by_name: string | null; updated_at: string })[]
}

export function readMaterialInput(body: Record<string, unknown>) {
  const kode = str(body.kode, 30).toUpperCase()
  const nama = str(body.nama, 150)
  if (!kode || !nama) fail(400, 'Kode dan nama bahan wajib diisi.')
  const jenis = ['resin', 'pewarna', 'tinta', 'aditif', 'lainnya'].includes(String(body.jenis)) ? String(body.jenis) : 'lainnya'
  const harga = Number(String(body.harga ?? 0).replace(/\./g, '').replace(',', '.'))
  if (!Number.isFinite(harga) || harga < 0) fail(400, 'Harga harus angka ≥ 0.')
  const densityRaw = String(body.density ?? '').replace(',', '.')
  const density = densityRaw ? Number(densityRaw) : null
  if (density !== null && (!Number.isFinite(density) || density <= 0 || density > 3)) fail(400, 'Density tidak valid (contoh HDPE 0,95).')
  return {
    kode, nama, jenis,
    satuan: str(body.satuan, 20) || 'kg',
    harga,
    density,
    keterangan: str(body.keterangan, 500) || null,
    aktif: body.aktif === false || body.aktif === 0 || body.aktif === '0' ? 0 : 1,
  }
}

export const toNumber = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null
  const n = Number(String(value).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
