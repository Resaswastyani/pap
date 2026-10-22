// Data Bahan (menu Harga Bahan): tambah / ubah / hapus barang bahan baku, bahan pendukung, dan perlengkapan
// langsung di data Barang & Jasa Accurate. Setiap perubahan dikirim ke Accurate lebih dulu, lalu baris lokal
// accurate_items diperbarui dari detail Accurate sehingga SIMPAP dan Accurate selalu sama.
// Bahan = barang bertanda "Bahan Baku" (materialProduced) atau barang yang tidak diproduksi / pernah dibeli lewat PO.
import type { RowDataPacket } from 'mysql2'
import { accurate, accurateList, AccurateError } from '@/lib/accurate'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'

async function send<T>(path: string, options: Parameters<typeof accurate>[1]) {
  try {
    return await accurate<T>(path, options)
  } catch (error) {
    if (error instanceof AccurateError) fail(400, error.message.replace(/^Accurate \(\d+\): /, 'Accurate: '))
    throw error
  }
}

export const MATERIAL_TYPES = { INVENTORY: 'Persediaan (punya stok)', NON_INVENTORY: 'Non persediaan (ATK, perlengkapan)' } as const
export type MaterialType = keyof typeof MATERIAL_TYPES

// Barang yang termasuk "bahan" untuk daftar Data Bahan
export const MATERIAL_WHERE = `it.item_type IN ('INVENTORY', 'NON_INVENTORY') AND (it.material_produced = 1 OR COALESCE(it.item_produced, 0) = 0
  OR EXISTS (SELECT 1 FROM accurate_purchase_order_items p WHERE p.item_accurate_id = it.accurate_id))`

export type MaterialInput = {
  no: string | null; name: string; type: MaterialType; category: string | null; unit: string; vendor_price: number | null
  min_quantity: number | null; bahan_baku: boolean; suspended: boolean
}

const num = (v: unknown, label: string) => {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(String(v).replace(',', '.'))
  if (!Number.isFinite(n) || n < 0 || n > 1e13) fail(400, `${label} tidak valid.`)
  return n
}

export function readMaterialInput(body: Record<string, unknown>): MaterialInput {
  const name = str(body.name, 255)
  if (!name) fail(400, 'Nama bahan wajib diisi.')
  const unit = str(body.unit, 40)
  if (!unit) fail(400, 'Satuan wajib diisi (mis. kg, roll, pcs).')
  const type = (str(body.type, 20) || 'INVENTORY') as MaterialType
  if (!(type in MATERIAL_TYPES)) fail(400, 'Jenis barang tidak valid.')
  return {
    no: str(body.no, 50) || null, name, type, category: str(body.category, 150) || null, unit,
    vendor_price: num(body.vendor_price, 'Harga beli'), min_quantity: num(body.min_quantity, 'Stok minimum'),
    bahan_baku: body.bahan_baku !== false, suspended: body.suspended === true,
  }
}

// Isian save.do barang. Saat ubah, kolom yang dikosongkan dikirim kosong agar ikut terhapus di Accurate.
function itemForm(v: MaterialInput, id?: number) {
  const blank = id ? '' : null
  return {
    ...(id ? { id } : { itemType: v.type }),
    ...(v.no ? { no: v.no } : {}),
    name: v.name,
    itemCategoryName: v.category ?? blank,
    unit1Name: v.unit,
    vendorPrice: v.vendor_price ?? (id ? 0 : null),
    minimumQuantity: v.min_quantity ?? (id ? 0 : null),
    materialProduced: v.type === 'INVENTORY' ? v.bahan_baku : null,
    suspended: v.suspended,
  }
}

type Detail = Record<string, unknown>
const s = (v: unknown, max = 255) => (v === null || v === undefined || v === '' ? null : String(v).slice(0, max))
const nameOf = (v: unknown) => (v && typeof v === 'object' ? s((v as Detail).name) : s(v))

// Baca ulang satu barang dari Accurate dan simpan ke accurate_items
export async function refreshItem(id: number) {
  const d = (await send<Detail>('/api/item/detail.do', { params: { id } })).d
  await db.query(
    `INSERT INTO accurate_items (accurate_id, item_no, name, item_type, category, unit, min_quantity, vendor_price, suspended, item_produced, material_produced, last_update)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE item_no = VALUES(item_no), name = VALUES(name), item_type = VALUES(item_type), category = VALUES(category), unit = VALUES(unit),
       min_quantity = VALUES(min_quantity), vendor_price = VALUES(vendor_price), suspended = VALUES(suspended), item_produced = VALUES(item_produced),
       material_produced = VALUES(material_produced), last_update = VALUES(last_update), detail_synced_update = VALUES(last_update), synced_at = NOW()`,
    [id, s(d.no, 80), s(d.name) ?? '(tanpa nama)', s(d.itemType, 40), nameOf(d.itemCategory), nameOf(d.unit1), d.minimumQuantity ?? null, d.vendorPrice ?? null,
      d.suspended === true ? 1 : 0, d.itemProduced === true ? 1 : 0, d.materialProduced === true ? 1 : 0, s(d.lastUpdate, 20)],
  )
  return d
}

// Isian form ubah: langsung dari Accurate agar yang diubah adalah data terbaru
export async function materialForEdit(id: number) {
  const d = (await send<Detail>('/api/item/detail.do', { params: { id } })).d
  return {
    id, no: s(d.no) ?? '', name: s(d.name) ?? '', type: (s(d.itemType) ?? 'INVENTORY') as string, category: nameOf(d.itemCategory) ?? '', unit: nameOf(d.unit1) ?? '',
    vendor_price: d.vendorPrice ?? '', min_quantity: d.minimumQuantity ?? '', bahan_baku: d.materialProduced === true, suspended: d.suspended === true,
  }
}

export async function saveMaterial(v: MaterialInput, id?: number) {
  if (id) {
    const [[row]] = await db.query<RowDataPacket[]>('SELECT accurate_id FROM accurate_items WHERE accurate_id = ?', [id])
    if (!row) fail(404, 'Bahan tidak ditemukan. Sinkron data barang dulu.')
  }
  const res = await send<unknown>('/api/item/save.do', { form: itemForm(v, id) })
  const newId = id ?? Number(((res.r ?? {}) as { id?: number }).id)
  if (!newId) fail(502, 'Accurate tidak mengembalikan id barang.')
  const d = await refreshItem(newId)
  return { id: newId, no: String(d.no ?? ''), name: String(d.name ?? v.name) }
}

// Hapus di Accurate; barang yang sudah dipakai transaksi ditolak Accurate -> dinonaktifkan (suspended) sebagai gantinya
export async function deleteMaterial(id: number) {
  const [[row]] = await db.query<RowDataPacket[]>(
    `SELECT it.name, (SELECT COUNT(*) FROM accurate_purchase_order_items p WHERE p.item_accurate_id = it.accurate_id)
       + (SELECT COUNT(*) FROM accurate_bom_materials b WHERE b.item_accurate_id = it.accurate_id) AS dipakai
     FROM accurate_items it WHERE it.accurate_id = ?`,
    [id],
  )
  if (!row) fail(404, 'Bahan tidak ditemukan.')
  if (!Number(row.dipakai)) {
    try {
      await accurate('/api/item/delete.do', { method: 'DELETE', params: { id } })
      await db.query('DELETE FROM accurate_items WHERE accurate_id = ?', [id])
      return { deleted: true, name: String(row.name) }
    } catch (error) {
      if (!(error instanceof AccurateError)) throw error
      // Ditolak Accurate (mis. ada transaksi lain) -> nonaktifkan
    }
  }
  await send('/api/item/save.do', { form: { id, suspended: true } })
  await refreshItem(id)
  return { deleted: false, name: String(row.name) }
}

// Kategori barang Accurate untuk pilihan form
export async function itemCategories() {
  try {
    const res = await accurateList<{ id: number; name: string }>('item-category', { fields: 'id,name', 'sp.pageSize': 100 })
    return (res.d ?? []).map((c) => c.name).sort()
  } catch {
    const [rows] = await db.query<RowDataPacket[]>('SELECT DISTINCT category FROM accurate_items WHERE category IS NOT NULL ORDER BY category')
    return rows.map((r) => String(r.category))
  }
}

// Data Produk: nama / kode produk yang berasal dari barang Accurate ikut diubah di Accurate agar keduanya sama
export async function renameAccurateItem(id: number, name: string, no: string | null) {
  const [[row]] = await db.query<RowDataPacket[]>('SELECT name, item_no FROM accurate_items WHERE accurate_id = ?', [id])
  if (row && row.name === name && (!no || row.item_no === no)) return
  await send('/api/item/save.do', { form: { id, name, ...(no ? { no } : {}) } })
  await refreshItem(id)
}
