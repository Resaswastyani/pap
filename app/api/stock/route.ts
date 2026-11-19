import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, pageParams, readJson, requireUser, str } from '@/lib/api'
import { requireMenu } from '@/lib/customers'
import { db } from '@/lib/db'
import { canManageStock, STOCK_CATEGORY_GROUPS } from '@/lib/stock'
import { fillAllInBackground, fillAsOf, todayWib } from '@/lib/stock-history'

export const maxDuration = 120

// Stok barang dari Accurate (salinan; diperbarui oleh sinkronisasi). Pengelompokan menurut kategori barang di Accurate:
//   ?jenis=bahan     bahan baku     : kategori Biji Plastik, Roll Mika
//   ?jenis=pembantu  bahan pembantu : kategori Tinta, Solven, Box Mika
//   ?jenis=jadi      barang jadi    : barang yang dicentang "Diproduksi"
// ?tanggal=YYYY-MM-DD (lampau): stok per tanggal dari catatan harian, atau dihitung dari Accurate bila belum tercatat
const CATEGORY_GROUPS = STOCK_CATEGORY_GROUPS
const inCategories = (list: string[]) => `UPPER(TRIM(i.category)) IN (${list.map((c) => db.escape(c)).join(', ')})`
const jenisWhereOf = (jenis: string | null) => (jenis === 'bahan' || jenis === 'pembantu' ? inCategories(CATEGORY_GROUPS[jenis]) : jenis === 'jadi' ? 'i.item_produced = 1' : '1 = 1')
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireMenu(user, user.menus.includes('stok'))
  const params = new URL(request.url).searchParams
  const jenis = params.get('jenis')
  const jenisWhere = jenisWhereOf(jenis)
  const today = todayWib()
  const tglParam = str(params.get('tanggal'), 10)
  const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(tglParam) && tglParam < today ? tglParam : null
  // Stok fisik yang dipakai: hari ini = salinan Accurate; tanggal lampau = catatan per tanggal
  const QTY = tanggal ? 's.qty' : 'COALESCE(i.quantity_on_hand, i.quantity)'
  const COST = tanggal ? 'COALESCE(s.unit_cost, i.unit_cost)' : 'i.unit_cost'
  const JOIN = tanggal ? `LEFT JOIN stock_snapshots s ON s.accurate_id = i.accurate_id AND s.tanggal = ${db.escape(tanggal)}` : ''

  const where = ['i.suspended = 0', jenisWhere]
  const args: unknown[] = []
  const q = str(params.get('q'), 100)
  if (q) where.push('(i.name LIKE ? OR i.item_no LIKE ? OR i.category LIKE ?)'), args.push(`%${q}%`, `%${q}%`, `%${q}%`)
  const category = str(params.get('category'), 150)
  if (category) where.push('i.category = ?'), args.push(category)
  if (params.get('low') === '1') where.push(`i.min_quantity > 0 AND ${QTY} <= i.min_quantity`)
  if (params.get('type') === 'inventory') where.push("i.item_type = 'INVENTORY'")
  const { page, pageSize, offset } = pageParams(params)

  // Tanggal lampau: hitung dulu barang di halaman ini (bahan baku: semua) yang belum tercatat
  if (tanggal) {
    const [ids] = await db.query<RowDataPacket[]>(
      `SELECT i.accurate_id FROM accurate_items i WHERE ${where.join(' AND ')} ORDER BY i.name ${jenis === 'bahan' ? '' : 'LIMIT ? OFFSET ?'}`,
      jenis === 'bahan' ? args : [...args, pageSize, offset],
    )
    await fillAsOf(tanggal, ids.map((r) => Number(r.accurate_id)))
  }

  const [items] = await db.query<RowDataPacket[]>(
    `SELECT i.accurate_id, i.item_no, i.name, i.item_type, i.category, i.unit, i.quantity, i.quantity_on_hand, i.min_quantity, i.vendor_price, ${COST} AS unit_cost, i.synced_at
       ${tanggal ? ', s.qty AS qty_tgl, s.sumber' : ''}
     FROM accurate_items i ${JOIN} WHERE ${where.join(' AND ')} ORDER BY ${tanggal ? 'i.name' : `(${QTY} <= 0), i.name`} LIMIT ? OFFSET ?`,
    [...args, pageSize, offset],
  )
  const [[{ count }]] = await db.query<(RowDataPacket & { count: number })[]>(`SELECT COUNT(*) AS count FROM accurate_items i ${JOIN} WHERE ${where.join(' AND ')}`, args)
  const [categories] = await db.query<(RowDataPacket & { category: string })[]>(
    `SELECT DISTINCT category FROM accurate_items i WHERE category IS NOT NULL AND suspended = 0 AND ${jenisWhere} ORDER BY category`,
  )
  const [[summary]] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total, SUM(i.min_quantity > 0 AND ${QTY} <= i.min_quantity) AS low, SUM(${QTY} <= 0) AS empty, MAX(i.synced_at) AS synced_at,
       SUM(GREATEST(COALESCE(${QTY}, 0), 0) * COALESCE(${COST}, 0)) AS nilai${tanggal ? ', COUNT(s.accurate_id) AS dihitung, SUM(s.sumber = \'harian\') AS harian' : ''}
     FROM accurate_items i ${JOIN} WHERE i.suspended = 0 AND i.item_type = 'INVENTORY' AND ${jenisWhere}`,
  )
  return NextResponse.json({
    // Nilai = stok fisik x harga pokok rata-rata Accurate (stok minus dihitung 0)
    items: items.map((row) => {
      const fisik = tanggal ? n(row.qty_tgl) : n(row.quantity_on_hand) ?? n(row.quantity)
      const cost = n(row.unit_cost)
      return {
        ...row, quantity: tanggal ? null : n(row.quantity), quantity_on_hand: tanggal ? n(row.qty_tgl) : n(row.quantity_on_hand), min_quantity: n(row.min_quantity),
        vendor_price: n(row.vendor_price), unit_cost: cost, nilai: cost !== null && fisik !== null ? Math.max(fisik, 0) * cost : null,
      }
    }),
    total: Number(count), page, pageSize,
    categories: categories.map((c) => c.category),
    summary: {
      total: Number(summary.total ?? 0), low: Number(summary.low ?? 0), empty: Number(summary.empty ?? 0), synced_at: summary.synced_at, nilai: Number(summary.nilai ?? 0),
      ...(tanggal ? { tanggal, dihitung: Number(summary.dihitung ?? 0), harian: Number(summary.harian ?? 0) } : {}),
    },
    can: { manage: canManageStock(user) && jenis !== 'pembantu' },
  })
})

// Hitung stok per tanggal untuk semua barang satu kelompok di latar: { jenis, tanggal }
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireMenu(user, user.menus.includes('stok'))
  const body = await readJson(request)
  const tanggal = str(body.tanggal, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal) || tanggal >= todayWib()) fail(400, 'Pilih tanggal sebelum hari ini.')
  const [ids] = await db.query<RowDataPacket[]>(
    `SELECT i.accurate_id FROM accurate_items i LEFT JOIN stock_snapshots s ON s.accurate_id = i.accurate_id AND s.tanggal = ?
     WHERE i.suspended = 0 AND i.item_type = 'INVENTORY' AND ${jenisWhereOf(String(body.jenis ?? ''))} AND s.accurate_id IS NULL ORDER BY i.name`,
    [tanggal],
  )
  const started = fillAllInBackground(tanggal, ids.map((r) => Number(r.accurate_id)))
  return NextResponse.json({ sisa: ids.length, started })
})
