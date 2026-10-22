import type { RowDataPacket } from 'mysql2'
import { accurate, accurateDateTime, accurateEnabled, fromAccurateDate } from '@/lib/accurate'
import { db } from '@/lib/db'
import { syncProductionJobs } from '@/lib/production'

// Sinkronisasi data Accurate -> database PAP-MS.
// - Inkremental memakai filter lastUpdate (hanya data yang berubah sejak sinkron terakhir)
// - Bisa terpotong batas waktu (Vercel); halaman berikutnya dilanjutkan pada run berikutnya

// Daftar (list.do): customer, sales-invoice, sales-order, item, stock (stok fisik),
//   manufacture-order (Rencana Produksi, MP), finished-good-slip (Penyelesaian Barang Jadi, FGS)
// Detail (per data): sales-order-items (baris barang SO -> Data Produk), customer-detail (alamat customer),
//   manufacture-order-detail (baris formula MP), finished-good-slip-detail (barang jadi FGS)
// Bill of Material (Formula Produksi): daftar BOM + detail bahan (bill-of-material-detail) -> menu Formulasi Produk
// Purchasing: vendor (supplier), purchase-order + purchase-order-detail (baris barang & harga), purchase-invoice
//   + purchase-invoice-open (sisa hutang faktur belum lunas; pembayaran tidak selalu mengubah lastUpdate faktur)
type ListEntity = 'customer' | 'sales-invoice' | 'sales-order' | 'item' | 'stock' | 'bill-of-material' | 'manufacture-order' | 'finished-good-slip'
  | 'vendor' | 'purchase-order' | 'purchase-invoice'
type DetailEntity = 'sales-order-items' | 'customer-detail' | 'item-detail' | 'bill-of-material-detail' | 'manufacture-order-detail' | 'finished-good-slip-detail'
  | 'purchase-order-detail' | 'purchase-invoice-open'
export type SyncEntity = ListEntity | DetailEntity
// Urutan: data kecil & inkremental dulu, stok (selalu penuh, paling lama) terakhir
export const SYNC_ENTITIES: SyncEntity[] = [
  'customer', 'sales-invoice', 'sales-order', 'sales-order-items', 'customer-detail', 'item', 'item-detail', 'bill-of-material', 'bill-of-material-detail',
  'manufacture-order', 'manufacture-order-detail', 'finished-good-slip', 'finished-good-slip-detail',
  'vendor', 'purchase-order', 'purchase-order-detail', 'purchase-invoice', 'purchase-invoice-open', 'stock',
]
export const PRODUCTION_SYNC_ENTITIES: SyncEntity[] = ['manufacture-order', 'manufacture-order-detail', 'finished-good-slip', 'finished-good-slip-detail']
// item & item-detail: Data Bahan di menu Harga Bahan
export const PURCHASING_SYNC_ENTITIES: SyncEntity[] = ['vendor', 'purchase-order', 'purchase-order-detail', 'purchase-invoice', 'purchase-invoice-open', 'item', 'item-detail']
// Baris barang MP/FGS hanya diambil untuk dokumen beberapa hari terakhir (detail.do = satu request per dokumen)
const PRODUCTION_DAYS = Number(process.env.ACCURATE_PRODUCTION_DAYS || 120)

const PATHS: Record<ListEntity, string> = {
  customer: '/api/customer/list.do',
  'sales-invoice': '/api/sales-invoice/list.do',
  'sales-order': '/api/sales-order/list.do',
  item: '/api/item/list.do',
  stock: '/api/item/list-stock.do',
  'manufacture-order': '/api/manufacture-order/list.do',
  'finished-good-slip': '/api/finished-good-slip/list.do',
  'bill-of-material': '/api/bill-of-material/list.do',
  vendor: '/api/vendor/list.do',
  'purchase-order': '/api/purchase-order/list.do',
  'purchase-invoice': '/api/purchase-invoice/list.do',
}
// Stok selalu disinkron penuh: jumlahnya berubah karena transaksi lain tanpa mengubah lastUpdate barang
const FULL_SYNC: ListEntity[] = ['item', 'stock']

type Row = Record<string, unknown>
const str = (v: unknown, max = 255) => (v === null || v === undefined || v === '' ? null : String(v).slice(0, max))
const num = (v: unknown) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v))
// Field relasi Accurate bisa berupa objek ({ id, name }) atau teks
const nameOf = (v: unknown) => (v && typeof v === 'object' ? str((v as Row).name ?? (v as Row).no) : str(v))
const idOf = (v: unknown) => (v && typeof v === 'object' ? num((v as Row).id) : num(v))

const FIELDS: Record<ListEntity, string> = {
  'sales-order': 'id,number,transDate,shipDate,customer,totalAmount,statusName,lastUpdate',
  customer: 'id,customerNo,name,email,mobilePhone,workPhone,billStreet,billCity,billProvince,billZipCode,npwpNo,suspended,category,notes,lastUpdate',
  'sales-invoice': 'id,number,transDate,customer,totalAmount,statusName,lastUpdate',
  item: 'id,no,name,itemType,itemCategory,unit1,availableToSell,balance,quantity,minimumQuantity,vendorPrice,suspended,lastUpdate',
  stock: '', // list-stock memakai field bawaan: id, no, name, quantity
  'manufacture-order': 'id,number,name,transDate,statusName,portion,lastUpdate',
  'finished-good-slip': 'id,number,transDate,description,workOrder,lastUpdate',
  'bill-of-material': 'id,number,transDate,description,item,itemUnit,suspended,lastUpdate',
  vendor: 'id,vendorNo,name,category,email,mobilePhone,workPhone,suspended,lastUpdate',
  'purchase-order': 'id,number,transDate,shipDate,vendor,totalAmount,status,statusName,percentShipped,lastUpdate',
  'purchase-invoice': 'id,number,transDate,dueDate,vendor,totalAmount,primeOwing,statusName,lastUpdate',
}

// Penyimpanan per halaman (satu query untuk banyak baris) agar sinkron cepat ke database jarak jauh.

// Dipakai sinkron daftar (tanpa alamat) dan detail customer (dengan alamat).
// Alamat hanya diperbarui bila baris membawanya: penandanya kolom raw (diisi hanya untuk data detail).
export async function storeCustomerRows(rows: Row[]) {
  if (!rows.length) return
  const values = rows.map((row) => {
    const hasAddress = 'billStreet' in row || 'billCity' in row
    return [
      num(row.id), str(row.customerNo, 50), str(row.name) ?? '(tanpa nama)', nameOf(row.category ?? row.categoryName), str(row.email),
      str(row.mobilePhone, 80), str(row.workPhone, 80), str(row.billStreet, 500), str(row.billCity, 150), str(row.billProvince, 150),
      str(row.billZipCode, 20), str(row.npwpNo, 50), str(row.notes, 5000), row.suspended === true || row.suspended === 'true' ? 1 : 0,
      hasAddress ? JSON.stringify(row) : null,
    ]
  })
  await db.query(
    `INSERT INTO customers (accurate_id, customer_no, name, category, email, mobile_phone, work_phone, bill_street, bill_city, bill_province, bill_zip, npwp_no, notes, suspended, raw)
     VALUES ?
     ON DUPLICATE KEY UPDATE customer_no = VALUES(customer_no), name = VALUES(name), category = VALUES(category), email = VALUES(email),
       mobile_phone = VALUES(mobile_phone), work_phone = VALUES(work_phone),
       bill_street = IF(VALUES(raw) IS NULL, bill_street, VALUES(bill_street)), bill_city = IF(VALUES(raw) IS NULL, bill_city, VALUES(bill_city)),
       bill_province = IF(VALUES(raw) IS NULL, bill_province, VALUES(bill_province)), bill_zip = IF(VALUES(raw) IS NULL, bill_zip, VALUES(bill_zip)),
       raw = COALESCE(VALUES(raw), raw), npwp_no = VALUES(npwp_no), notes = VALUES(notes), suspended = VALUES(suspended), synced_at = NOW()`,
    [values],
  )
  await db.query('UPDATE customers SET synced_at = NOW() WHERE synced_at IS NULL')
}
export const storeCustomerRow = (row: Row) => storeCustomerRows([row])

async function saveInvoices(rows: Row[]) {
  if (!rows.length) return
  await db.query(
    `INSERT INTO accurate_sales_invoices (accurate_id, number, trans_date, customer_accurate_id, total_amount, status)
     VALUES ?
     ON DUPLICATE KEY UPDATE number = VALUES(number), trans_date = VALUES(trans_date), customer_accurate_id = VALUES(customer_accurate_id),
       total_amount = VALUES(total_amount), status = VALUES(status), synced_at = NOW()`,
    [rows.map((row) => [num(row.id), str(row.number, 80), fromAccurateDate(row.transDate), idOf(row.customer ?? row.customerId), num(row.totalAmount), str(row.statusName ?? row.status, 80)])],
  )
}

async function saveItems(rows: Row[]) {
  if (!rows.length) return
  await db.query(
    `INSERT INTO accurate_items (accurate_id, item_no, name, item_type, category, unit, quantity, min_quantity, vendor_price, suspended, last_update)
     VALUES ?
     ON DUPLICATE KEY UPDATE item_no = VALUES(item_no), name = VALUES(name), item_type = VALUES(item_type), category = VALUES(category),
       unit = VALUES(unit), quantity = VALUES(quantity), min_quantity = VALUES(min_quantity), vendor_price = VALUES(vendor_price), suspended = VALUES(suspended),
       last_update = VALUES(last_update), synced_at = NOW()`,
    [rows.map((row) => [
      num(row.id), str(row.no, 80), str(row.name) ?? '(tanpa nama)', str(row.itemType, 40), nameOf(row.itemCategory), nameOf(row.unit1),
      num(row.availableToSell ?? row.balance ?? row.quantity), num(row.minimumQuantity), num(row.vendorPrice), row.suspended === true ? 1 : 0, str(row.lastUpdate, 20),
    ])],
  )
}

async function saveStock(rows: Row[]) {
  if (!rows.length) return
  await db.query(
    `INSERT INTO accurate_items (accurate_id, item_no, name, quantity_on_hand)
     VALUES ?
     ON DUPLICATE KEY UPDATE quantity_on_hand = VALUES(quantity_on_hand), synced_at = NOW()`,
    [rows.map((row) => [num(row.id), str(row.no, 80), str(row.name) ?? '(tanpa nama)', num(row.quantity)])],
  )
}

async function saveSalesOrders(rows: Row[]) {
  if (!rows.length) return
  await db.query(
    `INSERT INTO accurate_sales_orders (accurate_id, number, trans_date, ship_date, customer_accurate_id, total_amount, status, last_update)
     VALUES ?
     ON DUPLICATE KEY UPDATE number = VALUES(number), trans_date = VALUES(trans_date), ship_date = VALUES(ship_date), customer_accurate_id = VALUES(customer_accurate_id),
       total_amount = VALUES(total_amount), status = VALUES(status), last_update = VALUES(last_update)`,
    [rows.map((row) => [num(row.id), str(row.number, 80), fromAccurateDate(row.transDate), fromAccurateDate(row.shipDate), idOf(row.customer), num(row.totalAmount), str(row.statusName, 80), str(row.lastUpdate, 20)])],
  )
}

// Rencana Produksi (MP): header dari daftar; tanggal mulai/selesai & status dilengkapi dari detail
async function saveManufactureOrders(rows: Row[]) {
  if (!rows.length) return
  await db.query(
    `INSERT INTO accurate_manufacture_orders (accurate_id, number, name, trans_date, status_name, progress, last_update)
     VALUES ?
     ON DUPLICATE KEY UPDATE number = VALUES(number), name = VALUES(name), trans_date = VALUES(trans_date), status_name = VALUES(status_name),
       progress = VALUES(progress), last_update = VALUES(last_update)`,
    [rows.map((row) => [num(row.id), str(row.number, 80), str(row.name), fromAccurateDate(row.transDate), str(row.statusName, 80), num(row.portion), str(row.lastUpdate, 20)])],
  )
}

// Penyelesaian Barang Jadi (FGS): perintah kerja (WO) & rencana produksi asalnya ikut di objek workOrder
async function saveFinishedGoodSlips(rows: Row[]) {
  if (!rows.length) return
  await db.query(
    `INSERT INTO accurate_finished_good_slips (accurate_id, number, trans_date, wo_accurate_id, wo_number, mo_accurate_id, description, last_update)
     VALUES ?
     ON DUPLICATE KEY UPDATE number = VALUES(number), trans_date = VALUES(trans_date), wo_accurate_id = VALUES(wo_accurate_id), wo_number = VALUES(wo_number),
       mo_accurate_id = VALUES(mo_accurate_id), description = VALUES(description), last_update = VALUES(last_update)`,
    [rows.map((row) => {
      const wo = (row.workOrder && typeof row.workOrder === 'object' ? row.workOrder : {}) as Row
      return [num(row.id), str(row.number, 80), fromAccurateDate(row.transDate), num(wo.id), str(wo.number, 80), num(wo.manufactureOrderId), str(row.description, 5000), str(row.lastUpdate, 20)]
    })],
  )
}

// Kepala Bill of Material: barang jadi & nomor formula (bahan diambil terpisah lewat detail.do)
export async function saveBoms(rows: Row[]) {
  if (!rows.length) return
  await db.query(
    `INSERT INTO accurate_boms (accurate_id, number, trans_date, description, item_accurate_id, item_no, item_name, unit, suspended, last_update)
     VALUES ?
     ON DUPLICATE KEY UPDATE number = VALUES(number), trans_date = VALUES(trans_date), description = VALUES(description), item_accurate_id = VALUES(item_accurate_id),
       item_no = VALUES(item_no), item_name = VALUES(item_name), unit = COALESCE(VALUES(unit), unit), suspended = VALUES(suspended),
       last_update = VALUES(last_update), synced_at = NOW()`,
    [rows.map((row) => {
      const item = (row.item && typeof row.item === 'object' ? row.item : {}) as Row
      return [num(row.id), str(row.number, 80), fromAccurateDate(row.transDate), str(row.description, 500), num(item.id ?? row.itemId), str(item.no, 80), str(item.name),
        nameOf(row.itemUnit), row.suspended === true ? 1 : 0, str(row.lastUpdate, 20)]
    })],
  )
}

// Simpan detail satu BOM (jumlah hasil + baris bahan) dari detail.do / balasan save.do
export async function storeBomDetail(d: Row, lastUpdate: string | null) {
  const id = num(d.id)
  if (!id) return
  const item = (d.item && typeof d.item === 'object' ? d.item : {}) as Row
  await saveBoms([{ ...d, lastUpdate: lastUpdate ?? d.lastUpdate }])
  await db.query('UPDATE accurate_boms SET quantity = ?, unit = COALESCE(?, unit), item_name = COALESCE(?, item_name), detail_synced_update = ? WHERE accurate_id = ?', [
    num(d.quantityDefault ?? d.quantity) ?? 1, nameOf(d.itemUnit), str(item.name), lastUpdate ?? str(d.lastUpdate, 20) ?? '', id,
  ])
  const lines = ((d.detailMaterial ?? []) as Row[]).map((line) => {
    const mat = (line.item ?? {}) as Row
    return [id, num(line.id), num(line.seq), num(mat.id ?? line.itemId), str(mat.no, 80), str(mat.name), num(line.quantity ?? line.quantityDefault), nameOf(line.itemUnit)]
  }).filter((line) => line[1] !== null)
  await db.query('DELETE FROM accurate_bom_materials WHERE bom_accurate_id = ?', [id])
  if (lines.length) {
    await db.query('INSERT INTO accurate_bom_materials (bom_accurate_id, line_id, seq, item_accurate_id, item_no, item_name, quantity, unit) VALUES ?', [lines])
  }
}

// ---------- Purchasing ----------
async function saveVendors(rows: Row[]) {
  if (!rows.length) return
  await db.query(
    `INSERT INTO accurate_vendors (accurate_id, vendor_no, name, category, email, mobile_phone, work_phone, suspended, last_update)
     VALUES ?
     ON DUPLICATE KEY UPDATE vendor_no = VALUES(vendor_no), name = VALUES(name), category = VALUES(category), email = VALUES(email),
       mobile_phone = VALUES(mobile_phone), work_phone = VALUES(work_phone), suspended = VALUES(suspended), last_update = VALUES(last_update), synced_at = NOW()`,
    [rows.map((row) => [num(row.id), str(row.vendorNo, 50), str(row.name) ?? '(tanpa nama)', nameOf(row.category), str(row.email), str(row.mobilePhone, 80),
      str(row.workPhone, 80), row.suspended === true ? 1 : 0, str(row.lastUpdate, 20)])],
  )
}

async function savePurchaseOrders(rows: Row[]) {
  if (!rows.length) return
  await db.query(
    `INSERT INTO accurate_purchase_orders (accurate_id, number, trans_date, ship_date, vendor_accurate_id, total_amount, status, status_name, percent_shipped, last_update)
     VALUES ?
     ON DUPLICATE KEY UPDATE number = VALUES(number), trans_date = VALUES(trans_date), ship_date = VALUES(ship_date), vendor_accurate_id = VALUES(vendor_accurate_id),
       total_amount = VALUES(total_amount), status = VALUES(status), status_name = VALUES(status_name), percent_shipped = VALUES(percent_shipped),
       last_update = VALUES(last_update), synced_at = NOW()`,
    [rows.map((row) => [num(row.id), str(row.number, 80), fromAccurateDate(row.transDate), fromAccurateDate(row.shipDate), idOf(row.vendor), num(row.totalAmount),
      str(row.status, 40), str(row.statusName, 80), num(row.percentShipped), str(row.lastUpdate, 20)])],
  )
}

async function savePurchaseInvoices(rows: Row[]) {
  if (!rows.length) return
  await db.query(
    `INSERT INTO accurate_purchase_invoices (accurate_id, number, trans_date, due_date, vendor_accurate_id, total_amount, owing, status_name, last_update)
     VALUES ?
     ON DUPLICATE KEY UPDATE number = VALUES(number), trans_date = VALUES(trans_date), due_date = VALUES(due_date), vendor_accurate_id = VALUES(vendor_accurate_id),
       total_amount = VALUES(total_amount), owing = VALUES(owing), status_name = VALUES(status_name), last_update = VALUES(last_update), synced_at = NOW()`,
    [rows.map((row) => [num(row.id), str(row.number, 80), fromAccurateDate(row.transDate), fromAccurateDate(row.dueDate), idOf(row.vendor),
      num(row.totalAmount), num(row.primeOwing), str(row.statusName, 80), str(row.lastUpdate, 20)])],
  )
}

const SAVERS: Record<ListEntity, (rows: Row[]) => Promise<void>> = {
  customer: storeCustomerRows, 'sales-invoice': saveInvoices, 'sales-order': saveSalesOrders, item: saveItems, stock: saveStock, 'bill-of-material': saveBoms,
  'manufacture-order': saveManufactureOrders, 'finished-good-slip': saveFinishedGoodSlips,
  vendor: saveVendors, 'purchase-order': savePurchaseOrders, 'purchase-invoice': savePurchaseInvoices,
}

// Jalankan fn untuk tiap item dengan beberapa permintaan paralel ke Accurate
async function eachParallel<T>(items: T[], limit: number, deadline: number, fn: (item: T) => Promise<void>) {
  let index = 0
  let done = 0
  const worker = async () => {
    while (index < items.length && Date.now() < deadline) {
      const item = items[index++]
      await fn(item)
      done++
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return done
}

// Produk otomatis dari barang yang pernah dipesan; customer utama = pemesan terbanyak
export async function refreshProductsForOrders(soIds: number[]) {
  if (!soIds.length) return
  await db.query(
    `INSERT IGNORE INTO customer_products (accurate_item_id, kode, nama, jenis, status)
     SELECT soi.item_accurate_id, MAX(COALESCE(i.item_no, soi.item_no)), MAX(COALESCE(i.name, soi.item_name)), MAX(i.category), 'aktif'
     FROM accurate_sales_order_items soi LEFT JOIN accurate_items i ON i.accurate_id = soi.item_accurate_id
     WHERE soi.so_accurate_id IN (?) AND soi.item_accurate_id IS NOT NULL
     GROUP BY soi.item_accurate_id`,
    [soIds],
  )
  await db.query(
    `UPDATE customer_products p JOIN (
       SELECT t.item_accurate_id, (
         SELECT c.id FROM accurate_sales_order_items s2
         JOIN accurate_sales_orders o2 ON o2.accurate_id = s2.so_accurate_id
         JOIN customers c ON c.accurate_id = o2.customer_accurate_id
         WHERE s2.item_accurate_id = t.item_accurate_id
         GROUP BY c.id ORDER BY COUNT(*) DESC, MAX(o2.trans_date) DESC LIMIT 1
       ) AS cid
       FROM (SELECT DISTINCT item_accurate_id FROM accurate_sales_order_items WHERE so_accurate_id IN (?) AND item_accurate_id IS NOT NULL) t
     ) x ON x.item_accurate_id = p.accurate_item_id
     SET p.customer_id = COALESCE(x.cid, p.customer_id)`,
    [soIds],
  )
}

// Baris barang SO yang baru / berubah (lastUpdate berbeda dari saat terakhir diambil)
async function syncSalesOrderItems(deadline: number) {
  const [pending] = await db.query<(RowDataPacket & { accurate_id: number; last_update: string | null })[]>(
    `SELECT accurate_id, last_update FROM accurate_sales_orders
     WHERE items_synced_update IS NULL OR items_synced_update <> COALESCE(last_update, '')
     ORDER BY trans_date DESC LIMIT 400`,
  )
  const synced: number[] = []
  const failed: string[] = []
  try {
  await eachParallel(pending, 4, deadline, async (so) => {
    let res
    try {
      res = await accurate<Row>('/api/sales-order/detail.do', { params: { id: so.accurate_id } })
    } catch (error) {
      // Satu order gagal tidak menghentikan yang lain; dicoba lagi pada sinkron berikutnya
      failed.push(`${so.accurate_id}: ${(error as Error).message}`)
      return
    }
    const lines = ((res.d?.detailItem ?? []) as Row[]).map((line) => {
      const item = (line.item ?? {}) as Row
      const unit = line.itemUnit && typeof line.itemUnit === 'object' ? (line.itemUnit as Row).name : line.itemUnit
      return [so.accurate_id, num(line.id), num(item.id), str(item.no, 80), str(item.name ?? line.detailName), num(line.quantity), str(unit, 40), num(line.unitPrice), str(line.detailNotes, 500)]
    }).filter((line) => line[1] !== null)
    await db.query('DELETE FROM accurate_sales_order_items WHERE so_accurate_id = ?', [so.accurate_id])
    if (lines.length) {
      // ON DUPLICATE: aman bila order yang sama sempat diproses dua kali bersamaan
      await db.query(
        `INSERT INTO accurate_sales_order_items (so_accurate_id, line_id, item_accurate_id, item_no, item_name, quantity, unit, unit_price, notes) VALUES ?
         ON DUPLICATE KEY UPDATE item_accurate_id = VALUES(item_accurate_id), item_no = VALUES(item_no), item_name = VALUES(item_name),
           quantity = VALUES(quantity), unit = VALUES(unit), unit_price = VALUES(unit_price), notes = VALUES(notes)`,
        [lines],
      )
    }
    await db.query('UPDATE accurate_sales_orders SET items_synced_update = ? WHERE accurate_id = ?', [so.last_update ?? '', so.accurate_id])
    synced.push(so.accurate_id)
  })
  } finally {
    // Produk tetap dibuat dari order yang sudah berhasil, walau ada yang gagal
    await refreshProductsForOrders(synced)
  }
  if (failed.length && !synced.length) throw new Error(`Gagal mengambil detail Sales Order: ${failed[0]}`)
  return { saved: synced.length, done: synced.length === pending.length && pending.length < 400 }
}

// Alamat customer hanya ada di detail.do: lengkapi customer yang belum pernah diambil detailnya
async function syncCustomerDetails(deadline: number) {
  const [pending] = await db.query<(RowDataPacket & { accurate_id: number })[]>(
    'SELECT accurate_id FROM customers WHERE raw IS NULL AND accurate_id IS NOT NULL ORDER BY updated_at DESC LIMIT 400',
  )
  let saved = 0
  await eachParallel(pending, 4, deadline, async (c) => {
    const res = await accurate<Row>('/api/customer/detail.do', { params: { id: c.accurate_id } }).catch(() => null)
    if (res?.d) {
      await storeCustomerRows([res.d])
      saved++
    }
  })
  return { saved, done: saved === pending.length && pending.length < 400 }
}

// Tanda "Diproduksi" & "Bahan Baku" (Barang & Jasa > Umum > Tipe Persediaan) hanya ada di detail.do barang
async function syncItemDetails(deadline: number) {
  const [pending] = await db.query<(RowDataPacket & { accurate_id: number; last_update: string | null })[]>(
    `SELECT accurate_id, last_update FROM accurate_items
     WHERE item_type = 'INVENTORY' AND suspended = 0 AND (detail_synced_update IS NULL OR detail_synced_update <> COALESCE(last_update, ''))
     ORDER BY accurate_id DESC LIMIT 400`,
  )
  let saved = 0
  await eachParallel(pending, 4, deadline, async (item) => {
    const res = await accurate<Row>('/api/item/detail.do', { params: { id: item.accurate_id } }).catch(() => null)
    if (!res?.d) return
    await db.query('UPDATE accurate_items SET item_produced = ?, material_produced = ?, detail_synced_update = ? WHERE accurate_id = ?', [
      res.d.itemProduced === true ? 1 : 0,
      res.d.materialProduced === true ? 1 : 0,
      item.last_update ?? '',
      item.accurate_id,
    ])
    saved++
  })
  return { saved, done: saved === pending.length && pending.length < 400 }
}

const unitName = (v: unknown) => (v && typeof v === 'object' ? str((v as Row).name, 40) : str(v, 40))

// Dokumen produksi (MP/FGS) terbaru yang baris barangnya belum diambil atau sudah berubah
async function pendingProductionDocs(table: 'accurate_manufacture_orders' | 'accurate_finished_good_slips') {
  const [rows] = await db.query<(RowDataPacket & { accurate_id: number; last_update: string | null })[]>(
    `SELECT accurate_id, last_update FROM ${table}
     WHERE trans_date >= CURDATE() - INTERVAL ? DAY AND (detail_synced_update IS NULL OR detail_synced_update <> COALESCE(last_update, ''))
     ORDER BY trans_date DESC, accurate_id DESC LIMIT 300`,
    [PRODUCTION_DAYS],
  )
  return rows
}

// Baris formula Rencana Produksi (produk utama, BOM, kuantitas, status, progres, jadwal, kuantitas jadi)
async function syncManufactureOrderDetails(deadline: number) {
  const pending = await pendingProductionDocs('accurate_manufacture_orders')
  let saved = 0
  const failed: string[] = []
  await eachParallel(pending, 4, deadline, async (mo) => {
    let res
    try {
      res = await accurate<Row>('/api/manufacture-order/detail.do', { params: { id: mo.accurate_id } })
    } catch (error) {
      failed.push(`${mo.accurate_id}: ${(error as Error).message}`)
      return
    }
    const d = res.d ?? {}
    const lines = ((d.detailManufactureOrder ?? []) as Row[]).map((line) => {
      const item = (line.item ?? {}) as Row
      const bom = (line.billOfMaterial ?? {}) as Row
      return [
        mo.accurate_id, num(line.id), num(line.seq), num(item.id ?? line.itemId), str(item.no, 80), str(item.name ?? line.detailName, 500),
        num(bom.id ?? line.billOfMaterialId), str(bom.number, 80), num(line.quantity), unitName(line.itemUnit),
        fromAccurateDate(line.startDate), fromAccurateDate(line.endDate), str(line.status, 40), str(line.statusName, 80),
        num(line.portionProgress), num(line.workOrderQuantity), num(line.finishedGoodSlipQuantity), num(line.percentMaterialSliped), str(line.detailNotes, 1000),
      ]
    }).filter((line) => line[1] !== null)
    await db.query('DELETE FROM accurate_manufacture_order_items WHERE mo_accurate_id = ?', [mo.accurate_id])
    if (lines.length) {
      await db.query(
        `INSERT INTO accurate_manufacture_order_items (mo_accurate_id, line_id, seq, item_accurate_id, item_no, item_name, bom_accurate_id, bom_number, quantity, unit,
           start_date, end_date, status, status_name, progress, wo_quantity, fgs_quantity, material_percent, notes) VALUES ?
         ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), status = VALUES(status), status_name = VALUES(status_name), progress = VALUES(progress),
           wo_quantity = VALUES(wo_quantity), fgs_quantity = VALUES(fgs_quantity), material_percent = VALUES(material_percent)`,
        [lines],
      )
    }
    await db.query(
      `UPDATE accurate_manufacture_orders SET start_date = ?, end_date = ?, status = ?, status_name = COALESCE(?, status_name), progress = COALESCE(?, progress),
         description = ?, detail_synced_update = ? WHERE accurate_id = ?`,
      [fromAccurateDate(d.startDate), fromAccurateDate(d.endDate), str(d.status, 40), str(d.statusName, 80), num(d.portion), str(d.description, 5000), mo.last_update ?? '', mo.accurate_id],
    )
    saved++
  })
  if (failed.length && !saved) throw new Error(`Gagal mengambil detail Rencana Produksi: ${failed[0]}`)
  return { saved, done: saved === pending.length && pending.length < 300 }
}

// Barang jadi pada Penyelesaian Barang Jadi (biasanya satu barang per dokumen)
async function syncFinishedGoodSlipDetails(deadline: number) {
  const pending = await pendingProductionDocs('accurate_finished_good_slips')
  let saved = 0
  const failed: string[] = []
  await eachParallel(pending, 4, deadline, async (fgs) => {
    let res
    try {
      res = await accurate<Row>('/api/finished-good-slip/detail.do', { params: { id: fgs.accurate_id } })
    } catch (error) {
      failed.push(`${fgs.accurate_id}: ${(error as Error).message}`)
      return
    }
    const d = res.d ?? {}
    const lines = ((d.detailItem ?? []) as Row[]).map((line) => {
      const item = (line.item ?? {}) as Row
      return [
        fgs.accurate_id, num(line.id), num(line.seq), num(item.id ?? line.itemId), str(item.no, 80), str(line.detailName ?? item.name, 500),
        num(line.quantity), unitName(line.itemUnit), nameOf(line.warehouse), str(line.detailNotes, 1000),
      ]
    }).filter((line) => line[1] !== null)
    await db.query('DELETE FROM accurate_finished_good_slip_items WHERE fgs_accurate_id = ?', [fgs.accurate_id])
    if (lines.length) {
      await db.query(
        `INSERT INTO accurate_finished_good_slip_items (fgs_accurate_id, line_id, seq, item_accurate_id, item_no, item_name, quantity, unit, warehouse, notes) VALUES ?
         ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), unit = VALUES(unit), warehouse = VALUES(warehouse)`,
        [lines],
      )
    }
    const wo = (d.workOrder && typeof d.workOrder === 'object' ? d.workOrder : {}) as Row
    await db.query(
      `UPDATE accurate_finished_good_slips SET wo_accurate_id = COALESCE(?, wo_accurate_id), wo_number = COALESCE(?, wo_number),
         mo_accurate_id = COALESCE(?, mo_accurate_id), detail_synced_update = ? WHERE accurate_id = ?`,
      [num(wo.id ?? d.workOrderId), str(wo.number, 80), num(wo.manufactureOrderId), fgs.last_update ?? '', fgs.accurate_id],
    )
    saved++
  })
  if (failed.length && !saved) throw new Error(`Gagal mengambil detail Penyelesaian Barang Jadi: ${failed[0]}`)
  return { saved, done: saved === pending.length && pending.length < 300 }
}

// Bahan tiap Bill of Material hanya ada di detail.do: ambil BOM baru / berubah
async function syncBomDetails(deadline: number) {
  const [pending] = await db.query<(RowDataPacket & { accurate_id: number; last_update: string | null })[]>(
    `SELECT accurate_id, last_update FROM accurate_boms
     WHERE detail_synced_update IS NULL OR detail_synced_update <> COALESCE(last_update, '')
     ORDER BY accurate_id DESC LIMIT 400`,
  )
  let saved = 0
  await eachParallel(pending, 4, deadline, async (bom) => {
    const res = await accurate<Row>('/api/bill-of-material/detail.do', { params: { id: bom.accurate_id } }).catch(() => null)
    if (!res?.d) return
    await storeBomDetail(res.d, bom.last_update ?? '')
    saved++
  })
  return { saved, done: saved === pending.length && pending.length < 400 }
}

// Satu PO dibaca ulang dari Accurate (setelah dibuat / diubah dari PAP-MS): header + baris barang
export async function refreshPurchaseOrder(id: number) {
  const res = await accurate<Row>('/api/purchase-order/detail.do', { params: { id } })
  const d = res.d
  await savePurchaseOrders([{ ...d, vendor: d.vendor ?? d.vendorId, lastUpdate: null }])
  await storePurchaseOrderLines(id, (d.detailItem ?? []) as Row[])
  await db.query("UPDATE accurate_purchase_orders SET detail_synced_update = COALESCE(last_update, '') WHERE accurate_id = ?", [id])
  return d
}

async function storePurchaseOrderLines(poId: number, detail: Row[]) {
  const lines = detail.map((line) => {
    const item = (line.item ?? {}) as Row
    return [poId, num(line.id), num(line.seq), num(item.id ?? line.itemId), str(item.no, 80), str(line.detailName ?? item.name, 500),
      num(line.quantity), unitName(line.itemUnit), num(line.unitPrice), num(line.totalPrice), num(line.shipQuantity), str(line.detailNotes, 1000)]
  }).filter((line) => line[1] !== null)
  await db.query('DELETE FROM accurate_purchase_order_items WHERE po_accurate_id = ?', [poId])
  if (lines.length) {
    await db.query(
      `INSERT INTO accurate_purchase_order_items (po_accurate_id, line_id, seq, item_accurate_id, item_no, item_name, quantity, unit, unit_price, total_price, quantity_shipped, notes)
       VALUES ? ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), unit_price = VALUES(unit_price), total_price = VALUES(total_price), quantity_shipped = VALUES(quantity_shipped)`,
      [lines],
    )
  }
}

// Baris barang PO (harga beli per barang -> database harga bahan; jumlah diterima -> monitoring PO)
async function syncPurchaseOrderDetails(deadline: number) {
  const [pending] = await db.query<(RowDataPacket & { accurate_id: number; last_update: string | null })[]>(
    `SELECT accurate_id, last_update FROM accurate_purchase_orders
     WHERE detail_synced_update IS NULL OR detail_synced_update <> COALESCE(last_update, '')
     ORDER BY trans_date DESC, accurate_id DESC LIMIT 300`,
  )
  let saved = 0
  const failed: string[] = []
  await eachParallel(pending, 4, deadline, async (po) => {
    let res
    try {
      res = await accurate<Row>('/api/purchase-order/detail.do', { params: { id: po.accurate_id } })
    } catch (error) {
      failed.push(`${po.accurate_id}: ${(error as Error).message}`)
      return
    }
    await storePurchaseOrderLines(po.accurate_id, (res.d?.detailItem ?? []) as Row[])
    await db.query('UPDATE accurate_purchase_orders SET detail_synced_update = ? WHERE accurate_id = ?', [po.last_update ?? '', po.accurate_id])
    saved++
  })
  if (failed.length && !saved) throw new Error(`Gagal mengambil detail PO: ${failed[0]}`)
  return { saved, done: saved === pending.length && pending.length < 300 }
}

// Sisa hutang terkini: semua faktur belum lunas dari Accurate; yang tidak ada lagi di daftar berarti sudah lunas
async function syncOpenPurchaseInvoices(deadline: number) {
  const open: Row[] = []
  for (let page = 1; ; page++) {
    const res = await accurate<Row[]>(PATHS['purchase-invoice'], {
      params: { fields: FIELDS['purchase-invoice'], 'filter.outstanding': 'true', 'sp.page': page, 'sp.pageSize': 100, 'sp.sort': 'id|asc' },
    })
    open.push(...(res.d ?? []))
    if (page >= (res.sp?.pageCount ?? 1) || !(res.d ?? []).length) break
    if (Date.now() > deadline) return { saved: 0, done: false }
  }
  await savePurchaseInvoices(open)
  const ids = open.map((row) => num(row.id)).filter((id): id is number => id !== null)
  await db.query(
    `UPDATE accurate_purchase_invoices SET owing = 0, status_name = IF(status_name = 'Belum Lunas', 'Lunas', status_name)
     WHERE owing > 0${ids.length ? ' AND accurate_id NOT IN (?)' : ''}`,
    ids.length ? [ids] : [],
  )
  return { saved: open.length, done: true }
}

const DETAIL_TASKS: Record<DetailEntity, (deadline: number) => Promise<{ saved: number; done: boolean }>> = {
  'sales-order-items': syncSalesOrderItems,
  'customer-detail': syncCustomerDetails,
  'item-detail': syncItemDetails,
  'bill-of-material-detail': syncBomDetails,
  'manufacture-order-detail': syncManufactureOrderDetails,
  'finished-good-slip-detail': syncFinishedGoodSlipDetails,
  'purchase-order-detail': syncPurchaseOrderDetails,
  'purchase-invoice-open': syncOpenPurchaseInvoices,
}

async function runDetailTask(entity: DetailEntity, deadline: number) {
  await db.query(
    `INSERT INTO accurate_sync_state (entity, status) VALUES (?, 'berjalan') ON DUPLICATE KEY UPDATE status = 'berjalan', message = NULL`,
    [entity],
  )
  try {
    const result = await DETAIL_TASKS[entity](deadline)
    await db.query(
      `UPDATE accurate_sync_state SET status = 'ok', message = ?, last_success = IF(?, NOW(), last_success) WHERE entity = ?`,
      [result.done ? `${result.saved} data diperbarui` : `${result.saved} data diperbarui, sisanya berlanjut`, result.done ? 1 : 0, entity],
    )
    return { entity, ...result }
  } catch (error) {
    await db.query("UPDATE accurate_sync_state SET status = 'gagal', message = ? WHERE entity = ?", [String((error as Error).message).slice(0, 500), entity])
    throw error
  }
}

type State = RowDataPacket & { entity: string; since_marker: string | null; next_page: number; run_started: string | null }

export async function syncEntity(entity: ListEntity, deadline: number) {
  const [[state]] = await db.query<State[]>('SELECT entity, since_marker, next_page, run_started FROM accurate_sync_state WHERE entity = ?', [entity])
  const page0 = state?.next_page ?? 1
  // Awal run baru: catat waktu mulai (jadi penanda lastUpdate run berikutnya)
  const runStarted = page0 === 1 || !state?.run_started ? accurateDateTime() : state.run_started
  await db.query(
    `INSERT INTO accurate_sync_state (entity, status, run_started, next_page) VALUES (?, 'berjalan', ?, ?)
     ON DUPLICATE KEY UPDATE status = 'berjalan', run_started = VALUES(run_started), message = NULL`,
    [entity, runStarted, page0],
  )
  let page = page0
  let saved = 0
  try {
    while (true) {
      const params: Record<string, string | number> = { 'sp.page': page, 'sp.pageSize': 100 }
      if (FIELDS[entity]) {
        params.fields = FIELDS[entity]
        params['sp.sort'] = 'id|asc'
      }
      if (state?.since_marker && !FULL_SYNC.includes(entity)) {
        params['filter.lastUpdate.op'] = 'GREATER_EQUAL_THAN'
        params['filter.lastUpdate.val'] = state.since_marker
      }
      const res = await accurate<Row[]>(PATHS[entity], { params })
      const rows = res.d ?? []
      await SAVERS[entity](rows)
      saved += rows.length
      const pageCount = res.sp?.pageCount ?? 1
      if (page >= pageCount || !(res.d ?? []).length) break
      page++
      if (Date.now() > deadline) {
        // Waktu habis: lanjutkan dari halaman ini pada run berikutnya
        await db.query("UPDATE accurate_sync_state SET status = 'ok', next_page = ?, message = ? WHERE entity = ?", [page, `Berlanjut di halaman ${page}/${pageCount}`, entity])
        return { entity, saved, done: false }
      }
    }
    await db.query(
      "UPDATE accurate_sync_state SET status = 'ok', next_page = 1, since_marker = ?, last_success = NOW(), message = ? WHERE entity = ?",
      [runStarted, `${saved} data diperbarui`, entity],
    )
    return { entity, saved, done: true }
  } catch (error) {
    await db.query("UPDATE accurate_sync_state SET status = 'gagal', next_page = ?, message = ? WHERE entity = ?", [page, String((error as Error).message).slice(0, 500), entity])
    throw error
  }
}

// Sinkron semua entity dalam batas waktu (default 45 detik agar aman untuk fungsi Vercel 60 detik)
export async function syncAll(budgetMs = 45_000, only?: SyncEntity[]) {
  if (!accurateEnabled()) throw new Error('Integrasi Accurate belum dikonfigurasi.')
  const deadline = Date.now() + budgetMs
  const results: { entity: SyncEntity; saved: number; done: boolean; error?: string }[] = []
  for (const entity of only ?? SYNC_ENTITIES) {
    if (Date.now() > deadline) break
    try {
      results.push(entity in DETAIL_TASKS ? await runDetailTask(entity as DetailEntity, deadline) : await syncEntity(entity as ListEntity, deadline))
    } catch (error) {
      results.push({ entity, saved: 0, done: false, error: (error as Error).message })
    }
  }
  // Pesanan berisi barang "Diproduksi" -> job jadwal produksi (cepat, hanya query database)
  try {
    await syncProductionJobs()
  } catch (error) {
    console.error('[production jobs]', error)
  }
  return results
}

export async function syncStatus() {
  const [rows] = await db.query<RowDataPacket[]>('SELECT entity, last_success, status, message, updated_at FROM accurate_sync_state')
  return rows
}
