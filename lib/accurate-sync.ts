import type { RowDataPacket } from 'mysql2'
import { accurate, accurateDateTime, accurateEnabled, fromAccurateDate } from '@/lib/accurate'
import { db } from '@/lib/db'

// Sinkronisasi data Accurate -> database PAP-MS.
// - Inkremental memakai filter lastUpdate (hanya data yang berubah sejak sinkron terakhir)
// - Bisa terpotong batas waktu (Vercel); halaman berikutnya dilanjutkan pada run berikutnya

// Daftar (list.do): customer, sales-invoice, sales-order, item, stock (stok fisik)
// Detail (per data): sales-order-items (baris barang SO -> Data Produk), customer-detail (alamat customer)
type ListEntity = 'customer' | 'sales-invoice' | 'sales-order' | 'item' | 'stock'
type DetailEntity = 'sales-order-items' | 'customer-detail'
export type SyncEntity = ListEntity | DetailEntity
export const SYNC_ENTITIES: SyncEntity[] = ['customer', 'sales-invoice', 'sales-order', 'item', 'stock', 'sales-order-items', 'customer-detail']

const PATHS: Record<ListEntity, string> = {
  customer: '/api/customer/list.do',
  'sales-invoice': '/api/sales-invoice/list.do',
  'sales-order': '/api/sales-order/list.do',
  item: '/api/item/list.do',
  stock: '/api/item/list-stock.do',
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
  'sales-order': 'id,number,transDate,customer,totalAmount,statusName,lastUpdate',
  customer: 'id,customerNo,name,email,mobilePhone,workPhone,billStreet,billCity,billProvince,billZipCode,npwpNo,suspended,category,notes,lastUpdate',
  'sales-invoice': 'id,number,transDate,customer,totalAmount,statusName,lastUpdate',
  item: 'id,no,name,itemType,itemCategory,unit1,availableToSell,balance,quantity,minimumQuantity,suspended,lastUpdate',
  stock: '', // list-stock memakai field bawaan: id, no, name, quantity
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
    `INSERT INTO accurate_items (accurate_id, item_no, name, item_type, category, unit, quantity, min_quantity, suspended)
     VALUES ?
     ON DUPLICATE KEY UPDATE item_no = VALUES(item_no), name = VALUES(name), item_type = VALUES(item_type), category = VALUES(category),
       unit = VALUES(unit), quantity = VALUES(quantity), min_quantity = VALUES(min_quantity), suspended = VALUES(suspended), synced_at = NOW()`,
    [rows.map((row) => [
      num(row.id), str(row.no, 80), str(row.name) ?? '(tanpa nama)', str(row.itemType, 40), nameOf(row.itemCategory), nameOf(row.unit1),
      num(row.availableToSell ?? row.balance ?? row.quantity), num(row.minimumQuantity), row.suspended === true ? 1 : 0,
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
    `INSERT INTO accurate_sales_orders (accurate_id, number, trans_date, customer_accurate_id, total_amount, status, last_update)
     VALUES ?
     ON DUPLICATE KEY UPDATE number = VALUES(number), trans_date = VALUES(trans_date), customer_accurate_id = VALUES(customer_accurate_id),
       total_amount = VALUES(total_amount), status = VALUES(status), last_update = VALUES(last_update)`,
    [rows.map((row) => [num(row.id), str(row.number, 80), fromAccurateDate(row.transDate), idOf(row.customer), num(row.totalAmount), str(row.statusName, 80), str(row.lastUpdate, 20)])],
  )
}

const SAVERS: Record<ListEntity, (rows: Row[]) => Promise<void>> = { customer: storeCustomerRows, 'sales-invoice': saveInvoices, 'sales-order': saveSalesOrders, item: saveItems, stock: saveStock }

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

const DETAIL_TASKS: Record<DetailEntity, (deadline: number) => Promise<{ saved: number; done: boolean }>> = {
  'sales-order-items': syncSalesOrderItems,
  'customer-detail': syncCustomerDetails,
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
  return results
}

export async function syncStatus() {
  const [rows] = await db.query<RowDataPacket[]>('SELECT entity, last_success, status, message, updated_at FROM accurate_sync_state')
  return rows
}
