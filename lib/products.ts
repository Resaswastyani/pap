import type { RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'
import { PRODUCT_FILE_ACCEPT, PRODUCT_FILE_MAX_BYTES } from '@/lib/permissions'

export const PRODUCT_JENIS = ['HD', 'PP', 'PE', 'Mika rigid', 'Plastik laundry', 'Lainnya'] as const

// Produk bisa berasal dari barang Accurate (accurate_item_id, dibuat otomatis dari Sales Order) atau ditambah manual.
// customer_id = customer utama (pemesan terbanyak); semua pemesan diambil dari baris Sales Order.
export const PRODUCT_SELECT = `SELECT p.id, p.customer_id, c.name AS customer_name, c.customer_no, p.accurate_item_id, p.kode, p.nama, p.jenis,
  p.spesifikasi, p.bahan, p.keterangan, p.status, p.created_by, COALESCE(cr.name, 'Sinkron Accurate') AS created_by_name,
  up.name AS updated_by_name, p.created_at, p.updated_at,
  (SELECT COUNT(*) FROM customer_product_files f WHERE f.product_id = p.id) AS file_count,
  (SELECT MAX(so.trans_date) FROM accurate_sales_order_items soi JOIN accurate_sales_orders so ON so.accurate_id = soi.so_accurate_id
     WHERE soi.item_accurate_id = p.accurate_item_id) AS last_order,
  (SELECT COUNT(DISTINCT so.customer_accurate_id) FROM accurate_sales_order_items soi JOIN accurate_sales_orders so ON so.accurate_id = soi.so_accurate_id
     WHERE soi.item_accurate_id = p.accurate_item_id) AS customer_count,
  (SELECT COALESCE(i.quantity_on_hand, i.quantity) FROM accurate_items i WHERE i.accurate_id = p.accurate_item_id) AS stock,
  (SELECT i.unit FROM accurate_items i WHERE i.accurate_id = p.accurate_item_id) AS unit
  FROM customer_products p
  LEFT JOIN customers c ON c.id = p.customer_id
  LEFT JOIN users cr ON cr.id = p.created_by
  LEFT JOIN users up ON up.id = p.updated_by`

export const serializeProduct = (row: RowDataPacket) => ({
  ...row,
  file_count: Number(row.file_count),
  customer_count: Number(row.customer_count ?? 0),
  stock: row.stock === null || row.stock === undefined ? null : Number(row.stock),
})

// Produk yang pernah dipesan customer (lewat Sales Order) atau customer utamanya = customer ini
export const PRODUCT_OF_CUSTOMER = `(p.customer_id = ? OR p.accurate_item_id IN (
  SELECT soi.item_accurate_id FROM accurate_sales_order_items soi JOIN accurate_sales_orders so ON so.accurate_id = soi.so_accurate_id
  WHERE so.customer_accurate_id = (SELECT accurate_id FROM customers WHERE id = ?)))`

export async function loadProduct(id: number) {
  const [rows] = await db.query<(RowDataPacket & { id: number; customer_id: number | null; accurate_item_id: number | null })[]>(`${PRODUCT_SELECT} WHERE p.id = ? LIMIT 1`, [id])
  const row = rows[0] ?? fail(404, 'Produk tidak ditemukan.')
  return serializeProduct(row) as typeof row & ReturnType<typeof serializeProduct>
}

// Riwayat pesanan produk dari Sales Order Accurate (untuk PPIC & Marketing)
export async function loadProductOrders(accurateItemId: number | null) {
  if (!accurateItemId) return []
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT so.number, so.trans_date, so.status, c.id AS customer_id, c.name AS customer_name, soi.quantity, soi.unit, soi.unit_price, soi.notes
     FROM accurate_sales_order_items soi
     JOIN accurate_sales_orders so ON so.accurate_id = soi.so_accurate_id
     LEFT JOIN customers c ON c.accurate_id = so.customer_accurate_id
     WHERE soi.item_accurate_id = ? ORDER BY so.trans_date DESC, so.accurate_id DESC LIMIT 30`,
    [accurateItemId],
  )
  return rows.map((row) => ({ ...row, quantity: row.quantity === null ? null : Number(row.quantity), unit_price: row.unit_price === null ? null : Number(row.unit_price) }))
}

export async function productJenisList() {
  const [rows] = await db.query<(RowDataPacket & { jenis: string })[]>('SELECT DISTINCT jenis FROM customer_products WHERE jenis IS NOT NULL ORDER BY jenis')
  return [...new Set([...PRODUCT_JENIS, ...rows.map((r) => r.jenis)])]
}

export async function loadProductFiles(productId: number) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT f.id, f.name, f.mime, f.size, u.name AS uploaded_by_name, f.created_at FROM customer_product_files f
     JOIN users u ON u.id = f.uploaded_by WHERE f.product_id = ? ORDER BY f.id`,
    [productId],
  )
  return rows
}

export function readProductInput(body: Record<string, unknown>) {
  const nama = str(body.nama, 255)
  if (!nama) fail(400, 'Nama produk wajib diisi.')
  const status = body.status === 'nonaktif' ? 'nonaktif' : 'aktif'
  return {
    nama,
    kode: str(body.kode, 80) || null,
    jenis: str(body.jenis, 80) || null,
    spesifikasi: str(body.spesifikasi, 10000) || null,
    bahan: str(body.bahan, 10000) || null,
    keterangan: str(body.keterangan, 10000) || null,
    status,
  }
}

export function validProductFile(value: unknown) {
  if (!(value instanceof File) || !value.size) return fail(400, 'File wajib dipilih.')
  if (!(PRODUCT_FILE_ACCEPT as readonly string[]).includes(value.type)) fail(400, `${value.name}: format harus PDF atau gambar (JPG/PNG/WEBP).`)
  if (value.size > PRODUCT_FILE_MAX_BYTES) fail(400, `${value.name}: ukuran maksimal 4 MB. Kompres PDF terlebih dahulu bila lebih besar.`)
  return value
}
