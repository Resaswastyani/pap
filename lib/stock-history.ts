import type { RowDataPacket } from 'mysql2'
import { accurate } from '@/lib/accurate'
import { runInBackground } from '@/lib/background'
import { db } from '@/lib/db'

// Stok per tanggal: catatan harian (dari salinan Accurate tiap sinkron) + hitung ulang dari Accurate untuk tanggal lampau
type Row = RowDataPacket & Record<string, unknown>
export const todayWib = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
const accDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

// Catat stok hari ini untuk semua barang persediaan (diperbarui tiap sinkron -> nilai akhir hari)
export async function snapshotToday() {
  await db.query(
    `INSERT INTO stock_snapshots (tanggal, accurate_id, qty, unit_cost, sumber)
     SELECT ?, accurate_id, COALESCE(quantity_on_hand, quantity), unit_cost, 'harian' FROM accurate_items WHERE suspended = 0 AND item_type = 'INVENTORY'
     ON DUPLICATE KEY UPDATE qty = VALUES(qty), unit_cost = VALUES(unit_cost), sumber = 'harian'`,
    [todayWib()],
  )
}

// Hitung stok per tanggal dari Accurate untuk barang yang belum tercatat (paralel terbatas agar tidak membebani Accurate)
export async function fillAsOf(tanggal: string, ids: number[], budgetMs = 25_000) {
  if (!ids.length) return 0
  const [have] = await db.query<Row[]>('SELECT accurate_id FROM stock_snapshots WHERE tanggal = ? AND accurate_id IN (?)', [tanggal, ids])
  const done = new Set(have.map((r) => Number(r.accurate_id)))
  const todo = ids.filter((id) => !done.has(id))
  if (!todo.length) return 0
  const [items] = await db.query<Row[]>('SELECT accurate_id, item_no, unit_cost FROM accurate_items WHERE accurate_id IN (?)', [todo])
  const started = Date.now()
  let filled = 0
  const queue = [...items]
  async function worker() {
    while (queue.length && Date.now() - started < budgetMs) {
      const it = queue.shift()!
      try {
        const res = await accurate<{ availableStock?: number }>('/api/item/get-stock.do', { params: { no: String(it.item_no), asOfDate: accDate(tanggal) } })
        const qty = Number((res.d as { availableStock?: number } | undefined)?.availableStock ?? 0)
        await db.query(
          `INSERT INTO stock_snapshots (tanggal, accurate_id, qty, unit_cost, sumber) VALUES (?, ?, ?, ?, 'asof')
           ON DUPLICATE KEY UPDATE qty = IF(sumber = 'harian', qty, VALUES(qty))`,
          [tanggal, it.accurate_id, qty, it.unit_cost ?? null],
        )
        filled++
      } catch (error) {
        console.error('[stok per tanggal]', it.item_no, (error as Error).message)
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker))
  return filled
}

// Hitung semua barang satu kelompok di latar (barang jadi ribuan item)
export function fillAllInBackground(tanggal: string, ids: number[]) {
  return runInBackground(`stok-asof:${tanggal}:${ids.length}`, async () => {
    for (let i = 0; i < ids.length; i += 200) await fillAsOf(tanggal, ids.slice(i, i + 200), 120_000)
  })
}

// Riwayat satu barang: stok & nilai per tanggal tercatat + perubahan dari tanggal sebelumnya
export async function itemHistory(accurateId: number, days = 60) {
  const [rows] = await db.query<Row[]>(
    `SELECT DATE_FORMAT(tanggal, '%Y-%m-%d') AS tanggal, qty, unit_cost, sumber FROM stock_snapshots
     WHERE accurate_id = ? AND tanggal >= ? ORDER BY tanggal`,
    [accurateId, new Date(Date.now() + 7 * 3600e3 - days * 86400e3).toISOString().slice(0, 10)],
  )
  let prev: number | null = null
  const list = rows.map((r) => {
    const qty = r.qty === null ? null : Number(r.qty)
    const cost = r.unit_cost === null ? null : Number(r.unit_cost)
    const out = { tanggal: String(r.tanggal), qty, unit_cost: cost, nilai: qty !== null && cost !== null ? Math.max(qty, 0) * cost : null, perubahan: qty !== null && prev !== null ? qty - prev : null, sumber: String(r.sumber) }
    if (qty !== null) prev = qty
    return out
  })
  return list.reverse()
}
