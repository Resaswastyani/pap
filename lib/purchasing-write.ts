// Purchasing: tambah / ubah / hapus data di Accurate dari PAP-MS (PO pembelian, harga beli acuan barang, supplier).
// Setiap perubahan dikirim ke Accurate lebih dulu; data lokal (accurate_*) diperbarui dari jawaban Accurate.
import type { RowDataPacket } from 'mysql2'
import { accurate, accurateList, AccurateError, fromAccurateDate } from '@/lib/accurate'
import { refreshPurchaseOrder } from '@/lib/accurate-sync'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'
import { PERMISSIONS, type PermissionCode } from '@/lib/permissions'
import { type PurchasingMenu } from '@/lib/purchasing'
import { can, isManagement, type UserProfile } from '@/lib/users'

// ---------- Hak akses per menu (permission, bisa diatur per role / per user) ----------
const hasMenu = (user: UserProfile, menu: PurchasingMenu) => user.menus.includes(menu as never)
// Divisi Purchasing, GM, dan admin selalu boleh; divisi lain lewat permission
export const purchasingCan = (user: UserProfile) => {
  const owner = isManagement(user) || user.division.code === 'purchasing'
  const allow = (menu: PurchasingMenu, code: PermissionCode) => hasMenu(user, menu) && (owner || can(user, code))
  return {
    supplier: allow('supplier', PERMISSIONS.purchasingSupplier),
    poCreate: allow('po-pembelian', PERMISSIONS.purchasingPoCreate),
    poUpdate: allow('po-pembelian', PERMISSIONS.purchasingPoUpdate),
    poDelete: allow('po-pembelian', PERMISSIONS.purchasingPoDelete),
    price: allow('harga-bahan', PERMISSIONS.purchasingPrice),
    priceCreate: allow('harga-bahan', PERMISSIONS.purchasingPriceCreate),
    priceDelete: allow('harga-bahan', PERMISSIONS.purchasingPriceDelete),
  }
}
export function requirePurchasingCan(user: UserProfile, key: keyof ReturnType<typeof purchasingCan>, label: string) {
  if (!purchasingCan(user)[key]) fail(403, `Anda tidak punya izin untuk ${label}. Atur di Manajemen Role / Manajemen User (modul Purchasing).`)
}

// Pesan error Accurate diteruskan ke pengguna sebagai 400
async function send<T>(path: string, options: Parameters<typeof accurate>[1]) {
  try {
    return await accurate<T>(path, options)
  } catch (error) {
    if (error instanceof AccurateError) fail(400, error.message.replace(/^Accurate \(\d+\): /, 'Accurate: '))
    throw error
  }
}

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v)
const toAccDate = (v: string) => `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`
const todayWib = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
const money = (v: unknown, label: string, { min = 0, max = 1e13 } = {}) => {
  const n = Number(String(v ?? '').replace(',', '.'))
  if (v === '' || v === null || v === undefined || !Number.isFinite(n) || n < min || n > max) fail(400, `${label} tidak valid.`)
  return n
}
const optPct = (v: unknown, label: string) => (v === '' || v === null || v === undefined ? null : money(v, label, { max: 100 }))

// ---------- Pilihan form PO (dari Accurate, di-cache 10 menit) ----------
type Named = { id: number; name: string }
let optionCache: { at: number; data: { paymentTerms: Named[]; fobs: Named[]; shipments: Named[] } } | null = null
export async function poOptions() {
  if (!optionCache || Date.now() - optionCache.at > 10 * 60e3) {
    const list = async (entity: string) => {
      try {
        const res = await accurateList<{ id: number; name: string; suspended?: boolean }>(entity, { fields: 'id,name,suspended' })
        return (res.d ?? []).filter((r) => !r.suspended).map((r) => ({ id: r.id, name: r.name }))
      } catch {
        return []
      }
    }
    optionCache = { at: Date.now(), data: { paymentTerms: await list('payment-term'), fobs: await list('fob'), shipments: await list('shipment') } }
  }
  const [vendors] = await db.query<RowDataPacket[]>('SELECT accurate_id AS id, vendor_no, name FROM accurate_vendors WHERE suspended = 0 AND vendor_no IS NOT NULL ORDER BY name')
  // Alamat kirim bawaan: alamat PO terakhir dari PAP-MS, atau dari PO terbaru di Accurate
  const [[addr]] = await db.query<(RowDataPacket & { value: string | null })[]>("SELECT value FROM app_settings WHERE `key` = 'purchasing.po_address'")
  let defaultAddress = addr?.value ?? ''
  if (!defaultAddress) {
    const [[last]] = await db.query<(RowDataPacket & { accurate_id: number })[]>('SELECT accurate_id FROM accurate_purchase_orders ORDER BY trans_date DESC, accurate_id DESC LIMIT 1')
    if (last) defaultAddress = String((await accurate<{ toAddress?: string }>('/api/purchase-order/detail.do', { params: { id: last.accurate_id } }).catch(() => null))?.d?.toAddress ?? '')
  }
  return { ...optionCache.data, vendors, defaultAddress }
}

// Barang untuk baris PO: dari data barang Accurate + harga beli terakhir
export async function searchItems(q: string) {
  const like = `%${q}%`
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT it.accurate_id AS id, it.item_no, it.name, it.unit, it.category, it.vendor_price,
       (SELECT i.unit_price FROM accurate_purchase_order_items i JOIN accurate_purchase_orders po ON po.accurate_id = i.po_accurate_id
        WHERE i.item_accurate_id = it.accurate_id AND i.unit_price > 0 ORDER BY po.trans_date DESC, po.accurate_id DESC LIMIT 1) AS harga_terakhir
     FROM accurate_items it
     WHERE it.suspended = 0 AND it.item_no IS NOT NULL ${q ? 'AND (it.name LIKE ? OR it.item_no LIKE ? OR it.category LIKE ?)' : ''}
     ORDER BY (SELECT COUNT(*) FROM accurate_purchase_order_items i WHERE i.item_accurate_id = it.accurate_id) DESC, it.name LIMIT 40`,
    q ? [like, like, like] : [],
  )
  return rows.map((r) => ({ ...r, vendor_price: r.vendor_price === null ? null : Number(r.vendor_price), harga_terakhir: r.harga_terakhir === null ? null : Number(r.harga_terakhir) }))
}

// ---------- PO pembelian ----------
export type PoLineInput = { id: number | null; item_no: string; nama: string | null; quantity: number; unit: string | null; unit_price: number; disc_pct: number | null; catatan: string | null }
export type PoInput = {
  vendor_no: string; tanggal: string; nomor: string | null; ship_date: string | null; payment_term: string | null; fob: string | null; shipment: string | null
  alamat: string | null; keterangan: string | null; taxable: boolean; inclusive_tax: boolean; disc_pct: number | null; lines: PoLineInput[]
}

export function readPoInput(body: Record<string, unknown>): PoInput {
  const vendor_no = str(body.vendor_no, 50)
  if (!vendor_no) fail(400, 'Pilih pemasok.')
  const tanggal = str(body.tanggal, 10) || todayWib()
  if (!isDate(tanggal)) fail(400, 'Tanggal PO tidak valid.')
  const ship = str(body.ship_date, 10)
  if (ship && !isDate(ship)) fail(400, 'Tanggal pengiriman tidak valid.')
  const raw = Array.isArray(body.lines) ? (body.lines as Record<string, unknown>[]) : []
  const lines = raw.filter((l) => str(l.item_no, 80)).map((l, i): PoLineInput => ({
    id: Number(l.id) || null,
    item_no: str(l.item_no, 80),
    nama: str(l.nama, 255) || null,
    quantity: money(l.quantity, `Kuantitas baris ${i + 1}`, { min: 0.0001 }),
    unit: str(l.unit, 40) || null,
    unit_price: money(l.unit_price, `Harga baris ${i + 1}`),
    disc_pct: optPct(l.disc_pct, `Diskon baris ${i + 1}`),
    catatan: str(l.catatan, 1000) || null,
  }))
  if (!lines.length) fail(400, 'Tambahkan minimal satu barang.')
  if (lines.length > 100) fail(400, 'Maksimal 100 barang per PO.')
  return {
    vendor_no, tanggal, nomor: str(body.nomor, 50) || null, ship_date: ship || null,
    payment_term: str(body.payment_term, 100) || null, fob: str(body.fob, 100) || null, shipment: str(body.shipment, 100) || null,
    alamat: str(body.alamat, 1000) || null, keterangan: str(body.keterangan, 1000) || null,
    taxable: body.taxable === true, inclusive_tax: body.taxable === true && body.inclusive_tax === true, disc_pct: optPct(body.disc_pct, 'Diskon faktur'), lines,
  }
}

// Isian save.do PO Accurate. Ubah PO: id + id baris lama; baris yang dihapus dikirim dengan _status=delete.
function poForm(v: PoInput, existing?: { id: number; lineIds: number[] }) {
  const form: Record<string, string | number | boolean | null> = {
    vendorNo: v.vendor_no, transDate: toAccDate(v.tanggal), number: v.nomor, shipDate: v.ship_date ? toAccDate(v.ship_date) : null,
    paymentTermName: v.payment_term, fobName: v.fob, shipmentName: v.shipment, toAddress: v.alamat, description: v.keterangan,
    taxable: v.taxable, inclusiveTax: v.inclusive_tax, cashDiscPercent: v.disc_pct === null ? (existing ? '' : null) : v.disc_pct,
  }
  if (existing) form.id = existing.id
  v.lines.forEach((l, i) => {
    const p = `detailItem[${i}].`
    if (existing && l.id && existing.lineIds.includes(l.id)) form[`${p}id`] = l.id
    form[`${p}itemNo`] = l.item_no
    form[`${p}quantity`] = l.quantity
    form[`${p}unitPrice`] = l.unit_price
    form[`${p}itemUnitName`] = l.unit
    form[`${p}detailName`] = l.nama
    form[`${p}detailNotes`] = l.catatan ?? (existing ? '' : null)
    form[`${p}itemDiscPercent`] = l.disc_pct === null ? (existing ? '' : null) : l.disc_pct
    form[`${p}useTax1`] = v.taxable
  })
  if (existing) {
    const kept = new Set(v.lines.map((l) => l.id).filter(Boolean))
    existing.lineIds.filter((id) => !kept.has(id)).forEach((id, j) => {
      const p = `detailItem[${v.lines.length + j}].`
      form[`${p}id`] = id
      form[`${p}_status`] = 'delete'
    })
  }
  return form
}

type AccPo = Record<string, unknown> & { id: number; number: string; percentShipped?: number; status?: string; detailItem?: Record<string, unknown>[] }
async function poDetail(id: number) {
  return (await send<AccPo>('/api/purchase-order/detail.do', { params: { id } })).d
}

export async function createPo(v: PoInput, userId: number) {
  const res = await send<unknown>('/api/purchase-order/save.do', { form: poForm(v) })
  const r = (res.r ?? {}) as { id?: number; number?: string }
  if (!r.id) fail(502, 'Accurate tidak mengembalikan id PO.')
  await afterSave(r.id!, v, userId, true)
  return { id: r.id!, number: r.number ?? null, message: Array.isArray(res.d) ? String(res.d[0] ?? '') : '' }
}

export async function updatePo(id: number, v: PoInput, userId: number) {
  const current = await poDetail(id)
  if (Number(current.percentShipped ?? 0) > 0) fail(400, 'PO sudah ada penerimaan barang; ubah langsung di Accurate.')
  const lineIds = (current.detailItem ?? []).map((l) => Number(l.id)).filter(Boolean)
  const res = await send<unknown>('/api/purchase-order/save.do', { form: poForm(v, { id, lineIds }) })
  await afterSave(id, v, userId, false)
  return { id, number: ((res.r ?? {}) as { number?: string }).number ?? current.number }
}

async function afterSave(id: number, v: PoInput, userId: number, created: boolean) {
  await refreshPurchaseOrder(id)
  await db.query(`UPDATE accurate_purchase_orders SET ${created ? 'created_by' : 'updated_by'} = ? WHERE accurate_id = ?`, [userId, id])
  if (v.alamat) await db.query("INSERT INTO app_settings (`key`, value, updated_by) VALUES ('purchasing.po_address', ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)", [v.alamat, userId])
}

export async function deletePo(id: number) {
  const current = await poDetail(id)
  if (Number(current.percentShipped ?? 0) > 0) fail(400, 'PO sudah ada penerimaan barang dan tidak bisa dihapus. Tutup PO di Accurate bila sudah tidak berlaku.')
  await send('/api/purchase-order/delete.do', { method: 'DELETE', params: { id } })
  await db.query('DELETE FROM accurate_purchase_order_items WHERE po_accurate_id = ?', [id])
  await db.query('DELETE FROM accurate_purchase_orders WHERE accurate_id = ?', [id])
  return { number: current.number }
}

// PO untuk form ubah: dibaca langsung dari Accurate agar id baris & isian terbaru
export async function poForEdit(id: number) {
  const d = await poDetail(id)
  const name = (v: unknown) => (v && typeof v === 'object' ? String((v as { name?: string }).name ?? '') : '')
  const vendor = (d.vendor ?? {}) as { vendorNo?: string; name?: string; id?: number }
  return {
    id: d.id, number: d.number, status_name: d.statusName ?? null, percent_shipped: Number(d.percentShipped ?? 0),
    vendor_no: vendor.vendorNo ?? '', vendor_name: vendor.name ?? '',
    tanggal: fromAccurateDate(d.transDate) ?? '', ship_date: fromAccurateDate(d.shipDate) ?? '',
    payment_term: name(d.paymentTerm), fob: name(d.fob), shipment: name(d.shipment), alamat: String(d.toAddress ?? ''), keterangan: String(d.description ?? ''),
    taxable: d.taxable === true, inclusive_tax: d.inclusiveTax === true, disc_pct: d.cashDiscPercent === '' || d.cashDiscPercent == null ? '' : String(d.cashDiscPercent),
    cash_discount: Number(d.cashDiscount ?? 0), sub_total: Number(d.subTotal ?? 0), tax: Number(d.tax1Amount ?? 0), total: Number(d.totalAmount ?? 0),
    lines: (d.detailItem ?? []).map((l) => {
      const item = (l.item ?? {}) as { no?: string; name?: string }
      return {
        id: Number(l.id), item_no: item.no ?? '', nama: String(l.detailName ?? item.name ?? ''), quantity: String(l.quantity ?? ''), unit: name(l.itemUnit),
        unit_price: String(l.unitPrice ?? ''), disc_pct: l.itemDiscPercent === '' || l.itemDiscPercent == null ? '' : String(l.itemDiscPercent),
        catatan: String(l.detailNotes ?? ''), shipped: Number(l.shipQuantity ?? 0),
      }
    }),
  }
}

// ---------- Harga beli acuan barang (field "Harga Beli" di data barang Accurate) ----------
export async function updateItemPrice(itemId: number, price: number, note: string | null, userId: number) {
  const [[item]] = await db.query<RowDataPacket[]>('SELECT accurate_id, item_no, name, vendor_price FROM accurate_items WHERE accurate_id = ?', [itemId])
  if (!item) fail(404, 'Barang tidak ditemukan di data Accurate. Sinkron data barang dulu.')
  await send('/api/item/save.do', { form: { id: itemId, vendorPrice: price } })
  // Baca ulang dari Accurate agar nilai lokal sama dengan yang tersimpan
  const fresh = await send<{ vendorPrice?: number }>('/api/item/detail.do', { params: { id: itemId } })
  const saved = Number(fresh.d?.vendorPrice ?? price)
  await db.query('UPDATE accurate_items SET vendor_price = ? WHERE accurate_id = ?', [saved, itemId])
  await db.query('INSERT INTO purchase_price_logs (item_accurate_id, harga_lama, harga_baru, catatan, created_by) VALUES (?, ?, ?, ?, ?)', [itemId, item.vendor_price, saved, note, userId])
  return { item_no: item.item_no as string, name: item.name as string, vendor_price: saved, harga_lama: item.vendor_price === null ? null : Number(item.vendor_price) }
}

// ---------- Supplier (pemasok) ----------
export type VendorInput = { name: string; category: string | null; mobile_phone: string | null; work_phone: string | null; email: string | null; alamat: string | null; kota: string | null; npwp: string | null }
export function readVendorInput(body: Record<string, unknown>): VendorInput {
  const name = str(body.name, 255)
  if (!name) fail(400, 'Nama pemasok wajib diisi.')
  const email = str(body.email, 255)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Email tidak valid.')
  return {
    name, category: str(body.category, 150) || null, mobile_phone: str(body.mobile_phone, 80) || null, work_phone: str(body.work_phone, 80) || null,
    email: email || null, alamat: str(body.alamat, 500) || null, kota: str(body.kota, 150) || null, npwp: str(body.npwp, 40) || null,
  }
}

function vendorForm(v: VendorInput, id?: number) {
  // Saat ubah, kolom yang dikosongkan dikirim kosong agar ikut terhapus di Accurate
  const blank = id ? '' : null
  return {
    ...(id ? { id } : { transDate: toAccDate(todayWib()) }),
    name: v.name, categoryName: v.category, mobilePhone: v.mobile_phone ?? blank, workPhone: v.work_phone ?? blank, email: v.email ?? blank,
    billStreet: v.alamat ?? blank, billCity: v.kota ?? blank, npwpNo: v.npwp ?? blank,
  }
}

async function refreshVendor(id: number) {
  const d = (await send<Record<string, unknown>>('/api/vendor/detail.do', { params: { id } })).d
  const s = (v: unknown, max = 255) => (v === null || v === undefined || v === '' ? null : String(v).slice(0, max))
  await db.query(
    `INSERT INTO accurate_vendors (accurate_id, vendor_no, name, category, email, mobile_phone, work_phone, suspended) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE vendor_no = VALUES(vendor_no), name = VALUES(name), category = VALUES(category), email = VALUES(email),
       mobile_phone = VALUES(mobile_phone), work_phone = VALUES(work_phone), suspended = VALUES(suspended), synced_at = NOW()`,
    [id, s(d.vendorNo, 50), s(d.name) ?? '(tanpa nama)', s((d.category as { name?: string } | null)?.name, 150), s(d.email), s(d.mobilePhone, 80), s(d.workPhone, 80), d.suspended === true ? 1 : 0],
  )
  return d
}

export async function vendorForEdit(id: number) {
  const d = (await send<Record<string, unknown>>('/api/vendor/detail.do', { params: { id } })).d
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v))
  return {
    id, vendor_no: s(d.vendorNo), name: s(d.name), category: s((d.category as { name?: string } | null)?.name), mobile_phone: s(d.mobilePhone), work_phone: s(d.workPhone),
    email: s(d.email), alamat: s(d.billStreet), kota: s(d.billCity), npwp: s(d.npwpNo),
  }
}

export async function saveVendor(v: VendorInput, id?: number) {
  const res = await send<unknown>('/api/vendor/save.do', { form: vendorForm(v, id) })
  const newId = id ?? Number(((res.r ?? {}) as { id?: number }).id)
  if (!newId) fail(502, 'Accurate tidak mengembalikan id pemasok.')
  const d = await refreshVendor(newId)
  return { id: newId, vendor_no: String(d.vendorNo ?? ''), name: String(d.name ?? v.name) }
}

export async function deleteVendor(id: number) {
  const [[used]] = await db.query<RowDataPacket[]>(
    `SELECT (SELECT COUNT(*) FROM accurate_purchase_orders WHERE vendor_accurate_id = ?) + (SELECT COUNT(*) FROM accurate_purchase_invoices WHERE vendor_accurate_id = ?) AS n`,
    [id, id],
  )
  if (Number(used.n)) fail(400, 'Pemasok sudah punya PO / faktur dan tidak bisa dihapus. Nonaktifkan di Accurate bila tidak dipakai lagi.')
  await send('/api/vendor/delete.do', { method: 'DELETE', params: { id } })
  await db.query('DELETE FROM vendor_profiles WHERE vendor_accurate_id = ?', [id])
  await db.query('DELETE FROM accurate_vendors WHERE accurate_id = ?', [id])
}

export async function vendorCategories() {
  try {
    const res = await accurateList<{ id: number; name: string }>('vendor-category', { fields: 'id,name' })
    return (res.d ?? []).map((c) => c.name)
  } catch {
    const [rows] = await db.query<RowDataPacket[]>('SELECT DISTINCT category FROM accurate_vendors WHERE category IS NOT NULL ORDER BY category')
    return rows.map((r) => String(r.category))
  }
}
