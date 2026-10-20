// Database formulasi produk (PPIC): campuran bahan baku per formula, dipakai di SPK.
// Bahan diambil dari bahan baku Tabel HPP sehingga biaya bahan per kg bisa dihitung dari harga terbaru.
import type { RowDataPacket } from 'mysql2'
import { fail, int, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canViewHpp } from '@/lib/hpp'
import { isManagement, type UserProfile } from '@/lib/users'

export const PLASTIC_TYPES = ['HD', 'PP', 'PE', 'LLDPE', 'Mika rigid', 'Lainnya'] as const

export const canViewFormulations = (user: UserProfile) => user.menus.includes('formulasi')
export function requireFormulations(user: UserProfile) {
  if (!canViewFormulations(user)) fail(403, 'Anda tidak punya akses ke menu Formulasi Produk.')
}
// Dikelola PPIC (Guidance: PPIC update formulasi bahan untuk produksi), GM, admin
export const canManageFormulations = (user: UserProfile) => isManagement(user) || user.division.code === 'ppic'
// Biaya bahan hanya untuk yang boleh melihat harga (Tabel HPP)
export const canSeeCost = canViewHpp

type ItemRow = RowDataPacket & { formulation_id: number; urutan: number; material_id: number; kode: string; nama: string; jenis: string; satuan: string; harga: number | string; persentase: number | string; keterangan: string | null }
export type FormulaItem = { material_id: number; kode: string; nama: string; jenis: string; satuan: string; persentase: number; keterangan: string | null; harga?: number }

// "HDPE 70% · LLDPE 25% · MB-PUTIH 5%"
export const compositionText = (items: Pick<FormulaItem, 'nama' | 'persentase' | 'keterangan'>[]) =>
  items.map((i) => `${i.nama} ${Number(i.persentase).toLocaleString('id-ID', { maximumFractionDigits: 3 })}%${i.keterangan ? ` (${i.keterangan})` : ''}`).join(' · ')

export async function loadFormulations(where = '', args: unknown[] = [], user: UserProfile) {
  const [rows] = await db.query<(RowDataPacket & { id: number; kode: string; nama: string; versi: number; status: 'aktif' | 'arsip'; dipakai_aktif: number | string; dipakai_total: number | string })[]>(
    `SELECT f.id, f.kode, f.nama, f.jenis_plastik, f.tingkat_kualitas, f.product_id, p.nama AS product_nama, c.name AS customer_name, f.versi, f.status, f.catatan,
       f.created_at, f.updated_at, uc.name AS created_name, uu.name AS updated_name,
       (SELECT COUNT(*) FROM production_jobs j WHERE j.formulasi_id = f.id AND j.status IN ('menunggu', 'dijadwalkan', 'berjalan')) AS dipakai_aktif,
       (SELECT COUNT(*) FROM production_jobs j WHERE j.formulasi_id = f.id) AS dipakai_total
     FROM formulations f
     LEFT JOIN customer_products p ON p.id = f.product_id
     LEFT JOIN customers c ON c.id = p.customer_id
     JOIN users uc ON uc.id = f.created_by
     LEFT JOIN users uu ON uu.id = f.updated_by
     ${where} ORDER BY f.status, f.kode`,
    args,
  )
  const ids = rows.map((r) => r.id)
  const [items] = ids.length
    ? await db.query<ItemRow[]>(
      `SELECT i.formulation_id, i.urutan, i.material_id, m.kode, m.nama, m.jenis, m.satuan, m.harga, i.persentase, i.keterangan
       FROM formulation_items i JOIN raw_materials m ON m.id = i.material_id WHERE i.formulation_id IN (?) ORDER BY i.formulation_id, i.urutan`,
      [ids],
    )
    : [[] as ItemRow[]]
  const showCost = canSeeCost(user)
  return rows.map((r) => {
    const list = items.filter((i) => i.formulation_id === r.id).map((i) => ({
      material_id: i.material_id, kode: i.kode, nama: i.nama, jenis: i.jenis, satuan: i.satuan, persentase: Number(i.persentase), keterangan: i.keterangan,
      ...(showCost ? { harga: Number(i.harga) } : {}),
    }))
    // Biaya bahan per kg campuran (bahan bersatuan kg dengan harga terisi)
    const priced = list.filter((i) => i.satuan.toLowerCase() === 'kg' && (i.harga ?? 0) > 0)
    const biaya = showCost && priced.length ? priced.reduce((sum, i) => sum + (i.persentase / 100) * (i.harga ?? 0), 0) : null
    return {
      ...r,
      dipakai_aktif: Number(r.dipakai_aktif),
      dipakai_total: Number(r.dipakai_total),
      items: list,
      total_persen: Math.round(list.reduce((sum, i) => sum + i.persentase, 0) * 1000) / 1000,
      komposisi: compositionText(list),
      biaya_per_kg: biaya === null ? null : Math.round(biaya),
      biaya_lengkap: showCost ? priced.length === list.length : null,
    }
  })
}

export async function loadFormulation(id: number, user: UserProfile) {
  const [row] = await loadFormulations('WHERE f.id = ?', [id], user)
  return row ?? fail(404, 'Formulasi tidak ditemukan.')
}

// Isi form: { kode, nama, jenis_plastik, tingkat_kualitas, product_id, status, catatan, items: [{ material_id, persentase, keterangan }] }
export async function readFormulationInput(body: Record<string, unknown>) {
  const kode = str(body.kode, 30).toUpperCase()
  const nama = str(body.nama, 200)
  if (!kode || !nama) fail(400, 'Kode dan nama formulasi wajib diisi.')
  const raw = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : []
  if (!raw.length) fail(400, 'Isi minimal satu bahan.')
  if (raw.length > 20) fail(400, 'Maksimal 20 bahan per formulasi.')
  const [materials] = await db.query<(RowDataPacket & { id: number })[]>('SELECT id FROM raw_materials')
  const known = new Set(materials.map((m) => m.id))
  const seen = new Set<number>()
  const items = raw.map((item, index) => {
    const materialId = int(item.material_id) ?? fail(400, `Pilih bahan pada baris ${index + 1}.`)
    if (!known.has(materialId)) fail(400, `Bahan pada baris ${index + 1} tidak ditemukan di Tabel HPP.`)
    if (seen.has(materialId)) fail(400, 'Bahan yang sama dipilih lebih dari sekali.')
    seen.add(materialId)
    const persen = Number(String(item.persentase ?? '').replace(',', '.'))
    if (!Number.isFinite(persen) || persen <= 0 || persen > 100) fail(400, `Persentase baris ${index + 1} harus antara 0 dan 100.`)
    return { materialId, persen: Math.round(persen * 1000) / 1000, keterangan: str(item.keterangan, 255) || null }
  })
  const total = items.reduce((sum, i) => sum + i.persen, 0)
  if (Math.abs(total - 100) > 0.01) fail(400, `Total persentase bahan harus 100% (sekarang ${Math.round(total * 1000) / 1000}%).`)
  const productId = body.product_id ? int(body.product_id) : null
  if (productId) {
    const [[product]] = await db.query<RowDataPacket[]>('SELECT id FROM customer_products WHERE id = ?', [productId])
    if (!product) fail(400, 'Produk tidak ditemukan.')
  }
  return {
    kode, nama, items, productId,
    jenis: str(body.jenis_plastik, 40) || null,
    kualitas: str(body.tingkat_kualitas, 100) || null,
    status: body.status === 'arsip' ? 'arsip' : 'aktif',
    catatan: str(body.catatan, 5000) || null,
  }
}

export type FormulationInput = Awaited<ReturnType<typeof readFormulationInput>>
// Simpan baris bahan; kembalikan true bila komposisi berubah (versi naik)
export async function saveItems(conn: { query: typeof db.query }, formulationId: number, items: FormulationInput['items']) {
  const [old] = await conn.query<RowDataPacket[]>('SELECT material_id, persentase FROM formulation_items WHERE formulation_id = ? ORDER BY urutan', [formulationId])
  const before = old.map((o) => `${o.material_id}:${Number(o.persentase)}`).sort().join('|')
  const after = items.map((i) => `${i.materialId}:${i.persen}`).sort().join('|')
  await conn.query('DELETE FROM formulation_items WHERE formulation_id = ?', [formulationId])
  await conn.query(
    'INSERT INTO formulation_items (formulation_id, urutan, material_id, persentase, keterangan) VALUES ?',
    [items.map((i, index) => [formulationId, index + 1, i.materialId, i.persen, i.keterangan])],
  )
  return old.length > 0 && before !== after
}
