import type { RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { accurate, accurateEnabled } from '@/lib/accurate'
import { storeCustomerRow } from '@/lib/accurate-sync'
import { db } from '@/lib/db'
import { PERMISSIONS } from '@/lib/permissions'
import { can, type UserProfile } from '@/lib/users'

// Status CRM dihitung dari faktur penjualan Accurate:
//   prospek            belum pernah ada faktur
//   pembeli            1 faktur, transaksi terakhir masih dalam batas aktif
//   pelanggan          >= 2 faktur (repeat order), masih aktif
//   pembeli_nonaktif   1 faktur, transaksi terakhir lebih lama dari batas aktif
//   pelanggan_nonaktif >= 2 faktur, transaksi terakhir lebih lama dari batas aktif
export const CRM_INACTIVE_DAYS = Number(process.env.CRM_INACTIVE_DAYS || 180)

export const CRM_STATUS = {
  pelanggan: 'Pelanggan',
  pembeli: 'Pembeli',
  prospek: 'Prospek',
  pelanggan_nonaktif: 'Pelanggan nonaktif',
  pembeli_nonaktif: 'Pembeli nonaktif',
} as const
export type CrmStatus = keyof typeof CRM_STATUS

export const CRM_CASE = `CASE
  WHEN COALESCE(s.order_count, 0) = 0 THEN 'prospek'
  WHEN s.last_order < CURDATE() - INTERVAL ${CRM_INACTIVE_DAYS} DAY THEN IF(s.order_count >= 2, 'pelanggan_nonaktif', 'pembeli_nonaktif')
  ELSE IF(s.order_count >= 2, 'pelanggan', 'pembeli') END`

export const CUSTOMER_SELECT = `SELECT c.id, c.accurate_id, c.customer_no, c.name, c.category, c.email, c.mobile_phone, c.work_phone,
  c.bill_street, c.bill_city, c.bill_province, c.bill_zip, c.npwp_no, c.notes, c.suspended, c.synced_at, c.updated_at,
  COALESCE(s.order_count, 0) AS order_count, s.first_order, s.last_order, COALESCE(s.total_amount, 0) AS total_amount,
  (SELECT COUNT(*) FROM customer_products cp WHERE cp.customer_id = c.id) AS product_count,
  ${CRM_CASE} AS crm_status
  FROM customers c
  LEFT JOIN (
    SELECT customer_accurate_id, COUNT(*) AS order_count, MIN(trans_date) AS first_order, MAX(trans_date) AS last_order, SUM(total_amount) AS total_amount
    FROM accurate_sales_invoices GROUP BY customer_accurate_id
  ) s ON s.customer_accurate_id = c.accurate_id`

// Edit customer (tersimpan ke Accurate): permission customer.manage, atau divisi Marketing
export const canManageCustomer = (user: UserProfile) => can(user, PERMISSIONS.customerManage) || user.division.code === 'marketing'
// Kelola data produk & desain: permission product.manage, atau divisi Marketing / PPIC
export const canManageProduct = (user: UserProfile) => can(user, PERMISSIONS.productManage) || ['marketing', 'ppic'].includes(user.division.code)

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

// Nama field PAP-MS -> nama field Accurate
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

// Simpan ke Accurate dulu (sumber data utama), lalu salin ke database PAP-MS.
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

// Ambil detail terbaru dari Accurate (alamat tidak tersedia di daftar) lalu perbarui salinan PAP-MS.
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
