import type { RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { accurate, accurateEnabled } from '@/lib/accurate'
import { storeCustomerRow } from '@/lib/accurate-sync'
import { db } from '@/lib/db'
import { PERMISSIONS } from '@/lib/permissions'
import { isMarketing } from '@/lib/marketing'
import { can, type UserProfile } from '@/lib/users'
import { sectorSql } from '@/lib/sectors'

// Status CRM dihitung dari faktur penjualan Accurate:
//   prospek            belum pernah ada faktur
//   pembeli            1 faktur, transaksi terakhir masih dalam batas aktif
//   pelanggan          >= 2 faktur (repeat order), masih aktif
//   pembeli_nonaktif   1 faktur, transaksi terakhir lebih lama dari batas aktif
//   pelanggan_nonaktif >= 2 faktur, transaksi terakhir lebih lama dari batas aktif
// Batas aktif mengikuti cycle order masing-masing customer (lihat CYCLE_SQL / PASSIVE_DAYS_SQL);
// customer yang cycle-nya belum diketahui (baru 1x order, belum diisi manual) memakai CRM_INACTIVE_DAYS.
export const CRM_INACTIVE_DAYS = Number(process.env.CRM_INACTIVE_DAYS || 90)

// ---- Cycle order per customer ----
// Otomatis: median jarak antar tanggal order (12 jarak terakhir; jarak < 3 hari = kiriman susulan, diabaikan).
// Manual (cycle_manual_days) menggantikan hasil otomatis, mis. untuk customer yang baru 1x order.
export const CYCLE_PASSIVE_FACTOR = 3 // pasif bila tidak order > 3x cycle-nya (melewatkan 2 cycle)
export const CYCLE_PASSIVE_MIN_DAYS = 30 // ... tetapi tidak kurang dari 30 hari
export const CYCLE_SQL = 'COALESCE(c.cycle_manual_days, c.cycle_auto_days)'
export const PASSIVE_DAYS_SQL = `IF(${CYCLE_SQL} IS NULL, ${CRM_INACTIVE_DAYS}, GREATEST(${CYCLE_PASSIVE_MIN_DAYS}, ${CYCLE_SQL} * ${CYCLE_PASSIVE_FACTOR}))`
export const CYCLE_UNIT_DAYS = { hari: 1, bulan: 30 } as const

const CYCLE_ANALYSIS = `SELECT customer_accurate_id, COUNT(*) AS gaps, ROUND(MAX(med)) AS median FROM (
    SELECT customer_accurate_id, gap, MEDIAN(gap) OVER (PARTITION BY customer_accurate_id) AS med FROM (
      SELECT customer_accurate_id, gap, ROW_NUMBER() OVER (PARTITION BY customer_accurate_id ORDER BY d DESC) AS rn FROM (
        SELECT customer_accurate_id, d, DATEDIFF(d, LAG(d) OVER (PARTITION BY customer_accurate_id ORDER BY d)) AS gap
        FROM (SELECT DISTINCT customer_accurate_id, trans_date AS d FROM accurate_sales_invoices WHERE trans_date IS NOT NULL AND customer_accurate_id IS NOT NULL) a
      ) b WHERE gap >= 3
    ) r WHERE rn <= 12
  ) m GROUP BY customer_accurate_id`

// Hitung ulang cycle otomatis semua customer dari faktur
export async function refreshCustomerCycles() {
  await db.query(
    `UPDATE customers c LEFT JOIN (${CYCLE_ANALYSIS}) x ON x.customer_accurate_id = c.accurate_id
     SET c.cycle_auto_days = x.median, c.cycle_auto_gaps = x.gaps, c.cycle_analyzed_at = NOW()`,
  )
}

// Dipanggil sebelum membaca daftar customer / repeat order: analisis ulang bila ada faktur yang tersinkron
// setelah analisis terakhir (dicek paling sering tiap 5 menit per proses)
let cycleCheckedAt = 0
export async function ensureCustomerCycles() {
  if (Date.now() - cycleCheckedAt < 5 * 60_000) return
  cycleCheckedAt = Date.now()
  const [[row]] = await db.query<(RowDataPacket & { inv: string | null; done: string | null })[]>(
    'SELECT (SELECT MAX(synced_at) FROM accurate_sales_invoices) AS inv, (SELECT MAX(cycle_analyzed_at) FROM customers) AS done',
  )
  if (row.inv && (!row.done || row.inv > row.done)) await refreshCustomerCycles()
}

// Cycle order boleh diisi manual oleh tim marketing / pengelola customer
export const canEditCycle = (user: UserProfile) => user.role.isAdmin || isMarketing(user) || canManageCustomer(user)

// Isi manual: { value, unit: 'hari' | 'bulan' } atau value kosong = kembali ke otomatis
export function readCycleInput(body: Record<string, unknown>) {
  if (body.value === null || body.value === '' || body.value === undefined) return null
  const unit = body.unit === 'bulan' ? 'bulan' : 'hari'
  const value = Number(body.value)
  if (!Number.isInteger(value) || value < 1) fail(400, 'Cycle order harus berupa angka bulat minimal 1.')
  const days = value * CYCLE_UNIT_DAYS[unit]
  if (days > 730) fail(400, 'Cycle order maksimal 24 bulan (730 hari).')
  return { days, unit }
}

export const CRM_STATUS = {
  pelanggan: 'Pelanggan',
  pembeli: 'Pembeli',
  prospek: 'Prospek',
  pelanggan_nonaktif: 'Pelanggan pasif',
  pembeli_nonaktif: 'Pembeli pasif',
} as const
export type CrmStatus = keyof typeof CRM_STATUS

export const CRM_CASE = `CASE
  WHEN COALESCE(s.order_count, 0) = 0 THEN 'prospek'
  WHEN DATEDIFF(CURDATE(), s.last_order) > ${PASSIVE_DAYS_SQL} THEN IF(s.order_count >= 2, 'pelanggan_nonaktif', 'pembeli_nonaktif')
  ELSE IF(s.order_count >= 2, 'pelanggan', 'pembeli') END`

export const CUSTOMER_SELECT = `SELECT c.id, c.accurate_id, c.customer_no, c.name, c.category, c.email, c.mobile_phone, c.work_phone,
  c.bill_street, c.bill_city, c.bill_province, c.bill_zip, c.npwp_no, c.notes, c.suspended, c.synced_at, c.created_at, c.updated_at,
  COALESCE(s.order_count, 0) AS order_count, s.first_order, s.last_order, COALESCE(s.total_amount, 0) AS total_amount,
  (SELECT COUNT(*) FROM customer_products cp WHERE cp.customer_id = c.id) AS product_count,
  ${CRM_CASE} AS crm_status, ${sectorSql('c.category')} AS sektor,
  c.cycle_auto_days, c.cycle_auto_gaps, c.cycle_manual_days, c.cycle_manual_unit, ${CYCLE_SQL} AS cycle_hari, ${PASSIVE_DAYS_SQL} AS batas_pasif
  FROM customers c
  LEFT JOIN (
    SELECT customer_accurate_id, COUNT(*) AS order_count, MIN(trans_date) AS first_order, MAX(trans_date) AS last_order, SUM(total_amount) AS total_amount
    FROM accurate_sales_invoices GROUP BY customer_accurate_id
  ) s ON s.customer_accurate_id = c.accurate_id`

// Edit customer (tersimpan ke Accurate): permission customer.manage, atau divisi Marketing (semua sub-divisi)
export const canManageCustomer = (user: UserProfile) => user.role.isAdmin || can(user, PERMISSIONS.customerManage) || user.division.code.startsWith('marketing')
// Kelola data produk & desain: permission product.manage, atau divisi Marketing / PPIC
export const canManageProduct = (user: UserProfile) => user.role.isAdmin || can(user, PERMISSIONS.productManage) || user.division.code.startsWith('marketing') || user.division.code === 'ppic'

export const canViewCustomers = (user: UserProfile) => user.menus.includes('customer')
export const canViewProducts = (user: UserProfile) => user.menus.includes('produk') || user.menus.includes('customer')

export function requireMenu(user: UserProfile, ok: boolean) {
  if (!ok) fail(403, 'Anda tidak punya akses ke menu ini.')
}

export async function loadCustomer(id: number) {
  const [rows] = await db.query<RowDataPacket[]>(`${CUSTOMER_SELECT} WHERE c.id = ? LIMIT 1`, [id])
  return rows[0] ?? fail(404, 'Customer tidak ditemukan.')
}

export type CustomerInput = {
  name: string
  email: string | null
  mobile_phone: string | null
  work_phone: string | null
  bill_street: string | null
  bill_city: string | null
  bill_province: string | null
  bill_zip: string | null
  npwp_no: string | null
  notes: string | null
}

// Nama field SIMPAP -> nama field Accurate
const ACCURATE_FIELD: Record<keyof CustomerInput, string> = {
  name: 'name',
  email: 'email',
  mobile_phone: 'mobilePhone',
  work_phone: 'workPhone',
  bill_street: 'billStreet',
  bill_city: 'billCity',
  bill_province: 'billProvince',
  bill_zip: 'billZipCode',
  npwp_no: 'npwpNo',
  notes: 'notes',
}

// Simpan ke Accurate dulu (sumber data utama), lalu salin ke database SIMPAP.
// Saat edit, hanya field yang berubah yang dikirim agar data lain di Accurate tidak tertimpa.
export async function saveCustomerToAccurate(input: CustomerInput, accurateId: number | null, previous?: Partial<CustomerInput>) {
  if (!accurateEnabled()) fail(400, 'Integrasi Accurate belum dikonfigurasi, data customer belum bisa disimpan.')
  const body: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(ACCURATE_FIELD) as [keyof CustomerInput, string][]) {
    const value = input[key] ?? ''
    if (!accurateId || (previous?.[key] ?? '') !== value) body[field] = value
  }
  if (accurateId) {
    if (!Object.keys(body).length) return { accurateId, customerNo: null }
    body.id = accurateId
  } else {
    body.transDate = accurateToday()
  }
  let res
  try {
    res = await accurate<unknown>('/api/customer/save.do', { method: 'POST', body })
  } catch (error) {
    fail(502, `Gagal menyimpan ke Accurate: ${(error as Error).message}`)
  }
  const saved = (res!.r ?? res!.d) as Record<string, unknown>
  const id = Number(saved?.id ?? accurateId)
  if (!id) fail(502, 'Accurate tidak mengembalikan ID customer.')
  return { accurateId: id, customerNo: (saved?.customerNo as string) ?? null }
}

// Ambil detail terbaru dari Accurate (alamat tidak tersedia di daftar) lalu perbarui salinan SIMPAP.
// Gagal tidak menghentikan proses: data lokal tetap ditampilkan.
export async function refreshCustomerFromAccurate(accurateId: number | null) {
  if (!accurateId || !accurateEnabled()) return false
  try {
    const res = await accurate<Record<string, unknown>>('/api/customer/detail.do', { params: { id: accurateId } })
    await storeCustomerRow(res.d)
    return true
  } catch (error) {
    console.warn('[customer detail]', (error as Error).message)
    return false
  }
}

function accurateToday() {
  const d = new Date(Date.now() + 7 * 3600e3)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
}

export async function upsertLocalCustomer(input: CustomerInput, accurateId: number, customerNo: string | null) {
  await db.query(
    `INSERT INTO customers (accurate_id, customer_no, name, email, mobile_phone, work_phone, bill_street, bill_city, bill_province, bill_zip, npwp_no, notes, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE customer_no = COALESCE(VALUES(customer_no), customer_no), name = VALUES(name), email = VALUES(email),
       mobile_phone = VALUES(mobile_phone), work_phone = VALUES(work_phone), bill_street = VALUES(bill_street), bill_city = VALUES(bill_city),
       bill_province = VALUES(bill_province), bill_zip = VALUES(bill_zip), npwp_no = VALUES(npwp_no), notes = VALUES(notes), synced_at = NOW()`,
    [accurateId, customerNo, input.name, input.email, input.mobile_phone, input.work_phone, input.bill_street, input.bill_city, input.bill_province, input.bill_zip, input.npwp_no, input.notes],
  )
  const [[row]] = await db.query<(RowDataPacket & { id: number })[]>('SELECT id FROM customers WHERE accurate_id = ?', [accurateId])
  return row.id
}

// Validasi input form customer
export function readCustomerInput(body: Record<string, unknown>): CustomerInput {
  const name = str(body.name, 255)
  if (!name) fail(400, 'Nama customer wajib diisi.')
  const email = str(body.email, 255)
  if (email && !/^\S+@\S+\.\S+$/.test(email)) fail(400, 'Format email tidak valid.')
  const opt = (key: string, max = 255) => str(body[key], max) || null
  return {
    name,
    email: email || null,
    mobile_phone: opt('mobile_phone', 80),
    work_phone: opt('work_phone', 80),
    bill_street: opt('bill_street', 500),
    bill_city: opt('bill_city', 150),
    bill_province: opt('bill_province', 150),
    bill_zip: opt('bill_zip', 20),
    npwp_no: opt('npwp_no', 50),
    notes: opt('notes', 5000),
  }
}
