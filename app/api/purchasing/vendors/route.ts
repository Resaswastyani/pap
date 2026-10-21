import { NextResponse } from 'next/server'
import { handle, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canEditVendor, n, requirePurchasingMenu, type Row } from '@/lib/purchasing'
import { purchasingCan, readVendorInput, requirePurchasingCan, saveVendor } from '@/lib/purchasing-write'

// Database supplier: data pemasok Accurate + catatan Purchasing + ringkasan pembelian 12 bulan & hutang
export const GET = handle(async () => {
  const user = await requireUser()
  requirePurchasingMenu(user, 'supplier')
  const [rows] = await db.query<Row[]>(
    `SELECT v.accurate_id AS id, v.vendor_no, v.name, v.category, v.email, v.mobile_phone, v.work_phone, v.suspended,
       p.jenis, p.kontak, p.telepon, p.lead_time_hari, p.penilaian, p.catatan,
       po.po_12m, po.total_12m, po.last_po, po.open_po,
       pi.owing, pi.overdue
     FROM accurate_vendors v
     LEFT JOIN vendor_profiles p ON p.vendor_accurate_id = v.accurate_id
     LEFT JOIN (
       SELECT vendor_accurate_id, SUM(trans_date >= CURDATE() - INTERVAL 12 MONTH) AS po_12m,
         SUM(IF(trans_date >= CURDATE() - INTERVAL 12 MONTH, total_amount, 0)) AS total_12m, MAX(trans_date) AS last_po,
         SUM(COALESCE(percent_shipped, 0) < 100 AND COALESCE(status, '') NOT IN ('CLOSED', 'FULLRECEIVED')) AS open_po
       FROM accurate_purchase_orders GROUP BY vendor_accurate_id
     ) po ON po.vendor_accurate_id = v.accurate_id
     LEFT JOIN (
       SELECT vendor_accurate_id, SUM(owing) AS owing, SUM(IF(due_date < CURDATE(), owing, 0)) AS overdue
       FROM accurate_purchase_invoices WHERE owing > 0 GROUP BY vendor_accurate_id
     ) pi ON pi.vendor_accurate_id = v.accurate_id
     ORDER BY v.suspended, COALESCE(po.total_12m, 0) DESC, v.name`,
  )
  return NextResponse.json({
    items: rows.map((r) => ({
      ...r, suspended: !!r.suspended, jenis: r.jenis ? String(r.jenis).split(',') : [], penilaian: n(r.penilaian), lead_time_hari: n(r.lead_time_hari),
      po_12m: Number(r.po_12m ?? 0), total_12m: Number(r.total_12m ?? 0), open_po: Number(r.open_po ?? 0), owing: Number(r.owing ?? 0), overdue: Number(r.overdue ?? 0),
    })),
    can: { edit: canEditVendor(user), manage: purchasingCan(user).supplier },
  })
})

// Tambah pemasok baru di Accurate
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requirePurchasingCan(user, 'supplier', 'menambah supplier')
  return NextResponse.json({ item: await saveVendor(readVendorInput(await readJson(request))) })
})

