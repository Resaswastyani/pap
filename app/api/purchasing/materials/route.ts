import { NextResponse } from 'next/server'
import { handle, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { MATERIAL_WHERE, readMaterialInput, saveMaterial } from '@/lib/materials'
import { n, requirePurchasingMenu, type Row } from '@/lib/purchasing'
import { purchasingCan, requirePurchasingCan } from '@/lib/purchasing-write'

// Data Bahan dari data barang Accurate (lokal, hasil sinkron): ?q=&kategori=&nonaktif=1
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requirePurchasingMenu(user, 'harga-bahan')
  const params = new URL(request.url).searchParams
  const q = (params.get('q') ?? '').trim().slice(0, 100)
  const kategori = (params.get('kategori') ?? '').trim().slice(0, 150)
  const where = [MATERIAL_WHERE]
  const args: unknown[] = []
  if (params.get('nonaktif') !== '1') where.push('it.suspended = 0')
  if (q) where.push('(it.name LIKE ? OR it.item_no LIKE ?)'), args.push(`%${q}%`, `%${q}%`)
  if (kategori) where.push('it.category = ?'), args.push(kategori)
  const [rows] = await db.query<Row[]>(
    `SELECT it.accurate_id AS id, it.item_no, it.name, it.item_type, it.category, it.unit, it.vendor_price, it.min_quantity,
       COALESCE(it.quantity_on_hand, it.quantity) AS stok, it.material_produced, it.suspended,
       (SELECT p.unit_price FROM accurate_purchase_order_items p JOIN accurate_purchase_orders po ON po.accurate_id = p.po_accurate_id
        WHERE p.item_accurate_id = it.accurate_id AND p.unit_price > 0 ORDER BY po.trans_date DESC, po.accurate_id DESC LIMIT 1) AS harga_po
     FROM accurate_items it WHERE ${where.join(' AND ')} ORDER BY it.suspended, it.name LIMIT 2000`,
    args,
  )
  const [cats] = await db.query<Row[]>(`SELECT DISTINCT it.category FROM accurate_items it WHERE ${MATERIAL_WHERE} AND it.category IS NOT NULL ORDER BY it.category`)
  const can = purchasingCan(user)
  return NextResponse.json({
    items: rows.map((r) => ({
      ...(r as Record<string, unknown>), vendor_price: n(r.vendor_price), min_quantity: n(r.min_quantity), stok: n(r.stok), harga_po: n(r.harga_po),
      bahan_baku: !!r.material_produced, suspended: !!r.suspended,
    })),
    categories: cats.map((c) => String(c.category)),
    can: { create: can.priceCreate, update: can.price, delete: can.priceDelete },
  })
})

// Tambah bahan baru di Accurate
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requirePurchasingCan(user, 'priceCreate', 'menambah bahan')
  return NextResponse.json({ item: await saveMaterial(readMaterialInput(await readJson(request))) })
})
