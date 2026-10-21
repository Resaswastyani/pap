// Peralatan & sparepart teknik (Guidance Tehnik: "Mengatur stok sparepart tehnik mesin", "Mengatur dan mendata peralatan tehnik").
import type { RowDataPacket } from 'mysql2'
import { fail, int, str } from '@/lib/api'
import { db } from '@/lib/db'
import { decimal, ITEM_JENIS, ITEM_KONDISI, type ItemJenis, type ItemKondisi } from '@/lib/teknik'

export const ITEM_SELECT = `SELECT i.id, i.kode, i.nama, i.jenis, i.kategori, i.machine_id, m.nama AS machine_nama, i.satuan, i.stok, i.stok_minimum,
  i.lokasi, i.kondisi, i.catatan, i.aktif, i.created_at, i.updated_at,
  (SELECT MAX(mv.created_at) FROM tech_item_moves mv WHERE mv.item_id = i.id) AS gerak_terakhir
  FROM tech_items i LEFT JOIN machines m ON m.id = i.machine_id`

export const MOVE_SELECT = `SELECT mv.id, mv.item_id, mv.tanggal, mv.jenis, mv.jumlah, mv.stok_setelah, mv.repair_id, r.nomor AS repair_nomor, rm.nama AS repair_mesin,
  mv.purchase_request_id, pr.nomor AS pr_nomor, mv.keterangan, mv.created_by, u.name AS created_name, mv.created_at
  FROM tech_item_moves mv
  JOIN users u ON u.id = mv.created_by
  LEFT JOIN machine_repairs r ON r.id = mv.repair_id
  LEFT JOIN machines rm ON rm.id = r.machine_id
  LEFT JOIN purchase_requests pr ON pr.id = mv.purchase_request_id`

type ItemRow = RowDataPacket & { id: number; kode: string; nama: string; satuan: string }
export const serializeItem = (r: RowDataPacket) => ({ ...(r as ItemRow), stok: Number(r.stok), stok_minimum: Number(r.stok_minimum), aktif: !!r.aktif })
export const serializeMove = (r: RowDataPacket) => ({ ...r, jumlah: Number(r.jumlah), stok_setelah: Number(r.stok_setelah) })

export async function loadItem(id: number) {
  const [[row]] = await db.query<RowDataPacket[]>(`${ITEM_SELECT} WHERE i.id = ?`, [id])
  return row ? serializeItem(row) : fail(404, 'Barang tidak ditemukan.')
}

// { kode, nama, jenis, kategori, machine_id, satuan, stok_minimum, lokasi, kondisi, catatan }
export async function readItemInput(body: Record<string, unknown>) {
  const kode = str(body.kode, 40).toUpperCase()
  if (!kode) fail(400, 'Isi kode barang.')
  const nama = str(body.nama, 200)
  if (!nama) fail(400, 'Isi nama barang.')
  const jenis = (str(body.jenis, 20) || 'sparepart') as ItemJenis
  if (!(jenis in ITEM_JENIS)) fail(400, 'Jenis barang tidak valid.')
  const kondisi = (str(body.kondisi, 20) || 'baik') as ItemKondisi
  if (!(kondisi in ITEM_KONDISI)) fail(400, 'Kondisi tidak valid.')
  let machineId: number | null = null
  if (body.machine_id) {
    machineId = int(body.machine_id)
    const [[m]] = await db.query<RowDataPacket[]>('SELECT id FROM machines WHERE id = ?', [machineId])
    if (!m) fail(400, 'Mesin tidak ditemukan.')
  }
  return {
    kode, nama, jenis, kondisi, machineId,
    kategori: str(body.kategori, 100) || null,
    satuan: str(body.satuan, 40) || 'pcs',
    stokMinimum: decimal(body.stok_minimum, 'Stok minimum', { required: false }),
    lokasi: str(body.lokasi, 150) || null,
    catatan: str(body.catatan, 5000) || null,
  }
}
