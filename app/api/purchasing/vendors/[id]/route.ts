import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canEditVendor, n, requirePurchasingMenu, VENDOR_JENIS, type Row } from '@/lib/purchasing'
import { deleteVendor, readVendorInput, requirePurchasingCan, saveVendor } from '@/lib/purchasing-write'

type Ctx = { params: Promise<{ id: string }> }

async function loadVendor(ctx: Ctx) {
  const id = int((await ctx.params).id)
  const [[v]] = await db.query<Row[]>(
    `SELECT v.accurate_id AS id, v.vendor_no, v.name, v.category, v.email, v.mobile_phone, v.work_phone, v.suspended,
       p.jenis, p.kontak, p.telepon, p.lead_time_hari, p.penilaian, p.catatan, p.updated_at AS profile_updated_at, u.name AS profile_updated_by
     FROM accurate_vendors v LEFT JOIN vendor_profiles p ON p.vendor_accurate_id = v.accurate_id LEFT JOIN users u ON u.id = p.updated_by
     WHERE v.accurate_id = ?`,
    [id],
  )
  return v ?? fail(404, 'Supplier tidak ditemukan.')
}

// Detail supplier: profil, barang yang dipasok (harga terakhir), PO terbaru, faktur belum lunas
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requirePurchasingMenu(user, 'supplier')
  const v = await loadVendor(ctx)
  const [items] = await db.query<Row[]>(
    `SELECT x.item_accurate_id, x.item_no, x.item_name, x.unit, x.unit_price, x.trans_date, x.number, x.pembelian, x.kuantitas
     FROM (
       SELECT i.item_accurate_id, i.item_no, i.item_name, i.unit, i.unit_price, po.trans_date, po.number,
         COUNT(*) OVER (PARTITION BY i.item_accurate_id) AS pembelian, SUM(i.quantity) OVER (PARTITION BY i.item_accurate_id) AS kuantitas,
         ROW_NUMBER() OVER (PARTITION BY i.item_accurate_id ORDER BY po.trans_date DESC, po.accurate_id DESC) AS rn
       FROM accurate_purchase_order_items i JOIN accurate_purchase_orders po ON po.accurate_id = i.po_accurate_id
       WHERE po.vendor_accurate_id = ? AND i.item_accurate_id IS NOT NULL
     ) x WHERE x.rn = 1 ORDER BY x.trans_date DESC, x.item_name LIMIT 100`,
    [v.id],
  )
  const [orders] = await db.query<Row[]>(
    `SELECT accurate_id AS id, number, trans_date, ship_date, total_amount, status, status_name, percent_shipped
     FROM accurate_purchase_orders WHERE vendor_accurate_id = ? ORDER BY trans_date DESC, accurate_id DESC LIMIT 15`,
    [v.id],
  )
  const [invoices] = await db.query<Row[]>(
    `SELECT accurate_id AS id, number, trans_date, due_date, total_amount, owing, DATEDIFF(due_date, CURDATE()) AS sisa_hari
     FROM accurate_purchase_invoices WHERE vendor_accurate_id = ? AND owing > 0 ORDER BY due_date, accurate_id`,
    [v.id],
  )
  return NextResponse.json({
    item: { ...v, suspended: !!v.suspended, jenis: v.jenis ? String(v.jenis).split(',') : [], penilaian: n(v.penilaian), lead_time_hari: n(v.lead_time_hari) },
    items: items.map((r) => ({ ...r, unit_price: n(r.unit_price), pembelian: Number(r.pembelian), kuantitas: n(r.kuantitas) })),
    orders: orders.map((r) => ({ ...r, total_amount: n(r.total_amount), percent_shipped: n(r.percent_shipped) })),
    invoices: invoices.map((r) => ({ ...r, total_amount: n(r.total_amount), owing: n(r.owing), sisa_hari: n(r.sisa_hari) })),
    can: { edit: canEditVendor(user) },
  })
})

// Catatan Purchasing: { jenis: [], kontak, telepon, lead_time_hari, penilaian, catatan }
export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requirePurchasingMenu(user, 'supplier')
  if (!canEditVendor(user)) fail(403, 'Catatan supplier diisi oleh divisi Purchasing.')
  const v = await loadVendor(ctx)
  const body = await readJson(request)
  const jenis = Array.isArray(body.jenis) ? [...new Set(body.jenis.map(String))] : []
  if (jenis.some((j) => !(j in VENDOR_JENIS))) fail(400, 'Jenis supplier tidak valid.')
  const lead = body.lead_time_hari === '' || body.lead_time_hari == null ? null : int(body.lead_time_hari)
  if (lead !== null && (lead < 0 || lead > 365)) fail(400, 'Lead time harus 0–365 hari.')
  const nilai = body.penilaian === '' || body.penilaian == null ? null : int(body.penilaian)
  if (nilai !== null && (nilai < 1 || nilai > 5)) fail(400, 'Penilaian harus 1–5.')
  await db.query(
    `INSERT INTO vendor_profiles (vendor_accurate_id, jenis, kontak, telepon, lead_time_hari, penilaian, catatan, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE jenis = VALUES(jenis), kontak = VALUES(kontak), telepon = VALUES(telepon), lead_time_hari = VALUES(lead_time_hari),
       penilaian = VALUES(penilaian), catatan = VALUES(catatan), updated_by = VALUES(updated_by)`,
    [v.id, jenis.join(',') || null, str(body.kontak, 150) || null, str(body.telepon, 80) || null, lead, nilai, str(body.catatan, 5000) || null, user.id],
  )
  return NextResponse.json({ ok: true })
})

// Ubah data pemasok di Accurate: { name, category, mobile_phone, work_phone, email, alamat, kota, npwp }
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requirePurchasingCan(user, 'supplier', 'mengubah data supplier')
  const v = await loadVendor(ctx)
  return NextResponse.json({ item: await saveVendor(readVendorInput(await readJson(request)), Number(v.id)) })
})

// Hapus pemasok di Accurate (hanya bila belum punya PO / faktur)
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requirePurchasingCan(user, 'supplier', 'menghapus supplier')
  const v = await loadVendor(ctx)
  await deleteVendor(Number(v.id))
  return NextResponse.json({ ok: true, name: v.name })
})
