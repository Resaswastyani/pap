import type { RowDataPacket } from 'mysql2'
import { accurateDateTime, accurateEnabled, accurateList, fromAccurateDate } from '@/lib/accurate'
import { db } from '@/lib/db'

// Sinkronisasi data Accurate -> database PAP-MS.
// - Inkremental memakai filter lastUpdate (hanya data yang berubah sejak sinkron terakhir)
// - Bisa terpotong batas waktu (Vercel); halaman berikutnya dilanjutkan pada run berikutnya

export type SyncEntity = 'customer' | 'sales-invoice' | 'item'
export const SYNC_ENTITIES: SyncEntity[] = ['customer', 'sales-invoice', 'item']

type Row = Record<string, unknown>
const str = (v: unknown, max = 255) => (v === null || v === undefined || v === '' ? null : String(v).slice(0, max))
const num = (v: unknown) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v))
// Field relasi Accurate bisa berupa objek ({ id, name }) atau teks
const nameOf = (v: unknown) => (v && typeof v === 'object' ? str((v as Row).name ?? (v as Row).no) : str(v))
const idOf = (v: unknown) => (v && typeof v === 'object' ? num((v as Row).id) : num(v))

const FIELDS: Record<SyncEntity, string> = {
  customer: 'id,customerNo,name,email,mobilePhone,workPhone,billStreet,billCity,billProvince,billZipCode,npwpNo,suspended,category,notes,lastUpdate',
  'sales-invoice': 'id,number,transDate,customer,totalAmount,statusName,lastUpdate',
  item: 'id,no,name,itemType,itemCategory,unit1,availableToSell,balance,quantity,minimumQuantity,suspended,lastUpdate',
}

async function saveCustomer(row: Row) {
  const values = [
    num(row.id), str(row.customerNo, 50), str(row.name) ?? '(tanpa nama)', nameOf(row.category ?? row.categoryName), str(row.email),
    str(row.mobilePhone, 80), str(row.workPhone, 80), str(row.billStreet, 500), str(row.billCity, 150), str(row.billProvince, 150),
    str(row.billZipCode, 20), str(row.npwpNo, 50), str(row.notes, 5000), row.suspended === true || row.suspended === 'true' ? 1 : 0, JSON.stringify(row),
  ]
  await db.query(
    `INSERT INTO customers (accurate_id, customer_no, name, category, email, mobile_phone, work_phone, bill_street, bill_city, bill_province, bill_zip, npwp_no, notes, suspended, raw, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE customer_no = VALUES(customer_no), name = VALUES(name), category = VALUES(category), email = VALUES(email),
       mobile_phone = VALUES(mobile_phone), work_phone = VALUES(work_phone), bill_street = VALUES(bill_street), bill_city = VALUES(bill_city),
       bill_province = VALUES(bill_province), bill_zip = VALUES(bill_zip), npwp_no = VALUES(npwp_no), notes = VALUES(notes),
       suspended = VALUES(suspended), raw = VALUES(raw), synced_at = NOW()`,
    values,
  )
}

async function saveInvoice(row: Row) {
  await db.query(
    `INSERT INTO accurate_sales_invoices (accurate_id, number, trans_date, customer_accurate_id, total_amount, status, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE number = VALUES(number), trans_date = VALUES(trans_date), customer_accurate_id = VALUES(customer_accurate_id),
       total_amount = VALUES(total_amount), status = VALUES(status), synced_at = NOW()`,
    [num(row.id), str(row.number, 80), fromAccurateDate(row.transDate), idOf(row.customer ?? row.customerId), num(row.totalAmount), str(row.statusName ?? row.status, 80)],
  )
}

async function saveItem(row: Row) {
  const quantity = num(row.availableToSell ?? row.balance ?? row.quantity)
  await db.query(
    `INSERT INTO accurate_items (accurate_id, item_no, name, item_type, category, unit, quantity, min_quantity, suspended, raw, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE item_no = VALUES(item_no), name = VALUES(name), item_type = VALUES(item_type), category = VALUES(category),
       unit = VALUES(unit), quantity = VALUES(quantity), min_quantity = VALUES(min_quantity), suspended = VALUES(suspended), raw = VALUES(raw), synced_at = NOW()`,
    [num(row.id), str(row.no, 80), str(row.name) ?? '(tanpa nama)', str(row.itemType, 40), nameOf(row.itemCategory), nameOf(row.unit1), quantity, num(row.minimumQuantity), row.suspended === true ? 1 : 0, JSON.stringify(row)],
  )
}

const SAVERS: Record<SyncEntity, (row: Row) => Promise<void>> = { customer: saveCustomer, 'sales-invoice': saveInvoice, item: saveItem }

type State = RowDataPacket & { entity: string; since_marker: string | null; next_page: number; run_started: string | null }

export async function syncEntity(entity: SyncEntity, deadline: number) {
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
      const params: Record<string, string | number> = { fields: FIELDS[entity], 'sp.page': page, 'sp.sort': 'id|asc' }
      // Stok berubah karena transaksi lain (tanpa mengubah lastUpdate barang): selalu sinkron penuh
      if (state?.since_marker && entity !== 'item') {
        params['filter.lastUpdate.op'] = 'GREATER_EQUAL_THAN'
        params['filter.lastUpdate.val'] = state.since_marker
      }
      const res = await accurateList<Row>(entity, params)
      for (const row of res.d ?? []) {
        await SAVERS[entity](row)
        saved++
      }
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
      results.push(await syncEntity(entity, deadline))
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
