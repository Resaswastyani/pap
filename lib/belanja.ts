// Belanja ATK & RTK (General Affair): nota belanja beserta item-itemnya.
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageGa } from '@/lib/ga'
import type { UserProfile } from '@/lib/users'

// Kategori yang disarankan (boleh diketik bebas)
export const BELANJA_KATEGORI = ['ATK', 'RTK', 'Obat', 'Konsumsi', 'Perlengkapan IT', 'Operasional', 'Lainnya']

export const canViewBelanja = (user: UserProfile) => user.menus.includes('ga-belanja')
export const canManageBelanja = canManageGa
export function requireBelanja(user: UserProfile) {
  if (!canViewBelanja(user)) fail(403, 'Anda tidak punya akses ke menu Belanja ATK & RTK.')
}
export function requireBelanjaManage(user: UserProfile) {
  requireBelanja(user)
  if (!canManageBelanja(user)) fail(403, 'Catatan belanja dikelola General Affair.')
}

export const BELANJA_SELECT = `SELECT b.id, b.tanggal, b.kategori, b.toko, b.catatan, b.total, b.sumber, b.created_at, b.updated_at, u.name AS created_name,
  (SELECT COUNT(*) FROM ga_belanja_items i WHERE i.belanja_id = b.id) AS jumlah_item,
  (SELECT GROUP_CONCAT(i.nama ORDER BY i.urutan SEPARATOR ', ') FROM ga_belanja_items i WHERE i.belanja_id = b.id) AS ringkasan
  FROM ga_belanja b JOIN users u ON u.id = b.created_by`

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
type BelanjaRow = RowDataPacket & { id: number; tanggal: string; kategori: string; toko: string | null; catatan: string | null; sumber: string | null; created_name: string }
export const serializeBelanja = (r: RowDataPacket) => ({ ...(r as BelanjaRow), total: Number(r.total), jumlah_item: Number(r.jumlah_item ?? 0), ringkasan: r.ringkasan ? String(r.ringkasan).slice(0, 300) : null })
export const serializeItem = (r: RowDataPacket) => ({ id: r.id, nama: r.nama, qty: n(r.qty), satuan: r.satuan, harga_satuan: n(r.harga_satuan), total: n(r.total) })

export async function loadBelanja(id: number) {
  const [[row]] = await db.query<RowDataPacket[]>(`${BELANJA_SELECT} WHERE b.id = ?`, [id])
  if (!row) fail(404, 'Catatan belanja tidak ditemukan.')
  const [items] = await db.query<RowDataPacket[]>('SELECT * FROM ga_belanja_items WHERE belanja_id = ? ORDER BY urutan, id', [id])
  return { ...serializeBelanja(row!), items: items.map(serializeItem) }
}

export type BelanjaItemInput = { nama: string; qty: number | null; satuan: string | null; harga: number | null; total: number | null }
export type BelanjaInput = { tanggal: string; kategori: string; toko: string | null; catatan: string | null; items: BelanjaItemInput[]; total: number }

function money(v: unknown, label: string) {
  if (v === null || v === undefined || v === '') return null
  const x = Number(String(v).replace(',', '.'))
  if (!Number.isFinite(x) || x < 0 || x > 1e13) fail(400, `${label} tidak valid.`)
  return x
}

// { tanggal, kategori, toko, catatan, total (dipakai bila item tanpa harga), items: [{ nama, qty, satuan, harga_satuan, total }] }
export function readBelanjaInput(body: Record<string, unknown>): BelanjaInput {
  const tanggal = str(body.tanggal, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal) || Number.isNaN(Date.parse(tanggal))) fail(400, 'Isi tanggal belanja.')
  const kategori = str(body.kategori, 50) || 'ATK'
  const raw = Array.isArray(body.items) ? body.items as Record<string, unknown>[] : []
  const items: BelanjaItemInput[] = []
  for (const [i, it] of raw.entries()) {
    const nama = str(it?.nama, 255)
    if (!nama) continue
    const qty = money(it.qty, `Qty item ${i + 1}`)
    const harga = money(it.harga_satuan, `Harga satuan item ${i + 1}`)
    let total = money(it.total, `Total item ${i + 1}`)
    if (total === null && harga !== null && qty !== null) total = Math.round(harga * qty)
    items.push({ nama, qty, satuan: str(it.satuan, 40) || null, harga, total })
  }
  if (items.length > 300) fail(400, 'Maksimal 300 item per nota.')
  const sum = items.reduce((s, it) => s + (it.total ?? 0), 0)
  const total = sum > 0 ? sum : money(body.total, 'Total') ?? 0
  if (!items.length && !total) fail(400, 'Isi minimal satu item belanja atau total belanja.')
  return { tanggal, kategori, toko: str(body.toko, 150) || null, catatan: str(body.catatan, 5000) || null, items, total }
}

// Simpan nota (baru / ubah) beserta itemnya dalam satu transaksi
export async function saveBelanja(input: BelanjaInput, userId: number, id?: number, sumber?: string | null, conn?: PoolConnection) {
  const c = conn ?? (await db.getConnection())
  try {
    if (!conn) await c.beginTransaction()
    let belanjaId = id
    if (belanjaId) {
      await c.query('UPDATE ga_belanja SET tanggal = ?, kategori = ?, toko = ?, catatan = ?, total = ? WHERE id = ?', [input.tanggal, input.kategori, input.toko, input.catatan, input.total, belanjaId])
      await c.query('DELETE FROM ga_belanja_items WHERE belanja_id = ?', [belanjaId])
    } else {
      const [res] = await c.query<ResultSetHeader>('INSERT INTO ga_belanja (tanggal, kategori, toko, catatan, total, sumber, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        input.tanggal, input.kategori, input.toko, input.catatan, input.total, sumber ?? null, userId,
      ])
      belanjaId = res.insertId
    }
    if (input.items.length) {
      await c.query('INSERT INTO ga_belanja_items (belanja_id, urutan, nama, qty, satuan, harga_satuan, total) VALUES ?', [
        input.items.map((it, i) => [belanjaId, i, it.nama, it.qty, it.satuan, it.harga, it.total]),
      ])
    }
    if (!conn) await c.commit()
    return belanjaId!
  } catch (e) {
    if (!conn) await c.rollback()
    throw e
  } finally {
    if (!conn) c.release()
  }
}
