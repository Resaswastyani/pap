import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { handle, pageParams, requireUser, str } from '@/lib/api'
import { requireMenu } from '@/lib/customers'
import { db } from '@/lib/db'

// Stok barang dari Accurate (salinan; diperbarui oleh sinkronisasi)
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireMenu(user, user.menus.includes('stok'))
  const params = new URL(request.url).searchParams
  const where = ['i.suspended = 0']
  const args: unknown[] = []
  const q = str(params.get('q'), 100)
  if (q) where.push('(i.name LIKE ? OR i.item_no LIKE ? OR i.category LIKE ?)'), args.push(`%${q}%`, `%${q}%`, `%${q}%`)
  const category = str(params.get('category'), 150)
  if (category) where.push('i.category = ?'), args.push(category)
  if (params.get('low') === '1') where.push('i.min_quantity > 0 AND COALESCE(i.quantity_on_hand, i.quantity) <= i.min_quantity')
  if (params.get('type') === 'inventory') where.push("i.item_type = 'INVENTORY'")

  const { page, pageSize, offset } = pageParams(params)
  const [items] = await db.query<RowDataPacket[]>(
    `SELECT i.accurate_id, i.item_no, i.name, i.item_type, i.category, i.unit, i.quantity, i.quantity_on_hand, i.min_quantity, i.synced_at
     FROM accurate_items i WHERE ${where.join(' AND ')} ORDER BY (COALESCE(i.quantity_on_hand, i.quantity) <= 0), i.name LIMIT ? OFFSET ?`,
    [...args, pageSize, offset],
  )
  const [[{ count }]] = await db.query<(RowDataPacket & { count: number })[]>(`SELECT COUNT(*) AS count FROM accurate_items i WHERE ${where.join(' AND ')}`, args)
  const [categories] = await db.query<(RowDataPacket & { category: string })[]>(
    'SELECT DISTINCT category FROM accurate_items WHERE category IS NOT NULL AND suspended = 0 ORDER BY category',
  )
  const [[summary]] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total, SUM(min_quantity > 0 AND COALESCE(quantity_on_hand, quantity) <= min_quantity) AS low, SUM(COALESCE(quantity_on_hand, quantity) <= 0) AS empty, MAX(synced_at) AS synced_at
     FROM accurate_items WHERE suspended = 0 AND item_type = 'INVENTORY'`,
  )
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  return NextResponse.json({
    items: items.map((row) => ({ ...row, quantity: n(row.quantity), quantity_on_hand: n(row.quantity_on_hand), min_quantity: n(row.min_quantity) })),
    total: Number(count), page, pageSize,
    categories: categories.map((c) => c.category),
    summary: { total: Number(summary.total ?? 0), low: Number(summary.low ?? 0), empty: Number(summary.empty ?? 0), synced_at: summary.synced_at },
  })
})
