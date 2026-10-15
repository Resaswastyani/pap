import type { RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'
import { PRODUCT_FILE_ACCEPT, PRODUCT_FILE_MAX_BYTES } from '@/lib/permissions'

export const PRODUCT_JENIS = ['HD', 'PP', 'PE', 'Mika rigid', 'Plastik laundry', 'Lainnya'] as const

export const PRODUCT_SELECT = `SELECT p.id, p.customer_id, c.name AS customer_name, c.customer_no, p.kode, p.nama, p.jenis, p.spesifikasi, p.bahan,
  p.keterangan, p.status, p.created_by, cr.name AS created_by_name, up.name AS updated_by_name, p.created_at, p.updated_at,
  (SELECT COUNT(*) FROM customer_product_files f WHERE f.product_id = p.id) AS file_count
  FROM customer_products p
  JOIN customers c ON c.id = p.customer_id
  JOIN users cr ON cr.id = p.created_by
  LEFT JOIN users up ON up.id = p.updated_by`

export async function loadProduct(id: number) {
  const [rows] = await db.query<(RowDataPacket & { id: number; customer_id: number })[]>(`${PRODUCT_SELECT} WHERE p.id = ? LIMIT 1`, [id])
  const row = rows[0] ?? fail(404, 'Produk tidak ditemukan.')
  return { ...row, file_count: Number(row.file_count) }
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
