// Faktur Produksi: faktur penjualan (sales-invoice) Accurate untuk pesanan (SO) yang produksinya sudah selesai.
// "Produksi selesai" = setiap barang SO bertanda Diproduksi sudah punya Penyelesaian Barang Jadi (FGS) sejak tanggal SO
// sebanyak kuantitas pesanan (Rencana Produksi Accurate tidak menyimpan nomor SO, jadi dicocokkan per barang).
// Faktur dibuat / diubah / dihapus langsung di Accurate; salinan ringkas ada di accurate_sales_invoices.
import type { RowDataPacket } from 'mysql2'
import { accurate, accurateList, AccurateError, fromAccurateDate } from '@/lib/accurate'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'
import { PERMISSIONS } from '@/lib/permissions'
import { can, type UserProfile } from '@/lib/users'

type Obj = Record<string, unknown>
type Row = RowDataPacket & Obj

export function requireFaktur(user: UserProfile) {
  if (!user.menus.includes('faktur-produksi' as never)) fail(403, 'Anda tidak punya akses ke menu Faktur Produksi.')
}
export const fakturCan = (user: UserProfile) => ({
  create: can(user, PERMISSIONS.fakturCreate), update: can(user, PERMISSIONS.fakturUpdate), delete: can(user, PERMISSIONS.fakturDelete),
})
export function requireFakturCan(user: UserProfile, key: keyof ReturnType<typeof fakturCan>, label: string) {
  if (!fakturCan(user)[key]) fail(403, `Anda tidak punya izin untuk ${label}. Atur di Manajemen Role / Manajemen User (modul Faktur Produksi).`)
}

async function send<T>(path: string, options: Parameters<typeof accurate>[1]) {
  try {
    return await accurate<T>(path, options)
  } catch (error) {
    if (error instanceof AccurateError) fail(400, error.message.replace(/^Accurate \(\d+\): /, 'Accurate: '))
    throw error
  }
}
const n = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))
const nameOf = (v: unknown) => (v && typeof v === 'object' ? String((v as Obj).name ?? '') : '')
const toAcc = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v)

// ---------- Pesanan siap difakturkan ----------
// SO terbuka (Menunggu / Sebagian diproses) dalam `days` hari terakhir + progres produksi per baris
export async function readyOrders(days = 120, onlyDone = true) {
  const [lines] = await db.query<Row[]>(
    `SELECT so.accurate_id AS so_id, so.number AS so_number, so.trans_date, so.ship_date, so.status, so.total_amount,
       c.name AS customer_name, c.customer_no, soi.line_id, soi.item_no, soi.item_name, soi.quantity, soi.unit, soi.unit_price,
       COALESCE(it.item_produced, 1) AS diproduksi,
       (SELECT COALESCE(SUM(fi.quantity), 0) FROM accurate_finished_good_slip_items fi JOIN accurate_finished_good_slips f ON f.accurate_id = fi.fgs_accurate_id
        WHERE fi.item_accurate_id = soi.item_accurate_id AND f.trans_date >= so.trans_date) AS diproduksi_qty,
       (SELECT MAX(f.trans_date) FROM accurate_finished_good_slip_items fi JOIN accurate_finished_good_slips f ON f.accurate_id = fi.fgs_accurate_id
        WHERE fi.item_accurate_id = soi.item_accurate_id AND f.trans_date >= so.trans_date) AS selesai_tanggal
     FROM accurate_sales_orders so
     JOIN accurate_sales_order_items soi ON soi.so_accurate_id = so.accurate_id
     LEFT JOIN accurate_items it ON it.accurate_id = soi.item_accurate_id
     LEFT JOIN customers c ON c.accurate_id = so.customer_accurate_id
     WHERE so.status IN ('Menunggu diproses', 'Sebagian diproses') AND so.trans_date >= CURDATE() - INTERVAL ? DAY
     ORDER BY so.trans_date DESC, so.accurate_id DESC, soi.line_id`,
    [days],
  )
  const orders = new Map<number, {
    so_id: number; so_number: string; tanggal: string; ship_date: string | null; status: string; total: number; customer_name: string | null; customer_no: string | null
    selesai_tanggal: string | null; lines: { item_no: string; item_name: string; quantity: number; unit: string | null; diproduksi: boolean; diproduksi_qty: number }[]
  }>()
  for (const l of lines) {
    const id = Number(l.so_id)
    const o = orders.get(id) ?? {
      so_id: id, so_number: String(l.so_number), tanggal: l.trans_date as string, ship_date: (l.ship_date as string) ?? null, status: String(l.status), total: Number(l.total_amount ?? 0),
      customer_name: (l.customer_name as string) ?? null, customer_no: (l.customer_no as string) ?? null, selesai_tanggal: null, lines: [],
    }
    const produced = !!Number(l.diproduksi)
    o.lines.push({ item_no: String(l.item_no ?? ''), item_name: String(l.item_name ?? ''), quantity: Number(l.quantity ?? 0), unit: (l.unit as string) ?? null, diproduksi: produced, diproduksi_qty: Number(l.diproduksi_qty ?? 0) })
    if (produced && l.selesai_tanggal && (!o.selesai_tanggal || String(l.selesai_tanggal) > String(o.selesai_tanggal))) o.selesai_tanggal = l.selesai_tanggal as string
    orders.set(id, o)
  }
  const list = [...orders.values()].map((o) => {
    const prod = o.lines.filter((l) => l.diproduksi)
    const done = prod.filter((l) => l.diproduksi_qty >= l.quantity).length
    return { ...o, produksi: !prod.length ? 'tanpa_produksi' : done === prod.length ? 'selesai' : done || prod.some((l) => l.diproduksi_qty > 0) ? 'sebagian' : 'belum', baris_selesai: done, baris_produksi: prod.length }
  })
  return { items: onlyDone ? list.filter((o) => o.produksi === 'selesai' || o.produksi === 'tanpa_produksi') : list, total: list.length }
}

// ---------- Form faktur ----------
export type InvoiceLine = { id: number | null; item_no: string; nama: string; quantity: number; unit: string | null; unit_price: number; disc_pct: number | null; so_number: string | null; catatan: string | null }
export type InvoiceExpense = { id: number | null; account_no: string; nama: string; amount: number; so_number: string | null }
export type InvoiceInput = {
  customer_no: string; tanggal: string; nomor: string | null; ship_date: string | null; payment_term: string | null; po_number: string | null
  alamat: string | null; keterangan: string | null; taxable: boolean; inclusive_tax: boolean; lines: InvoiceLine[]; expenses: InvoiceExpense[]
}

const money = (v: unknown, label: string, min = 0) => {
  const x = Number(String(v ?? '').replace(',', '.'))
  if (v === '' || v === null || v === undefined || !Number.isFinite(x) || x < min || x > 1e13) fail(400, `${label} tidak valid.`)
  return x
}

export function readInvoiceInput(body: Obj): InvoiceInput {
  const customer_no = str(body.customer_no, 50)
  if (!customer_no) fail(400, 'Pilih pelanggan.')
  const tanggal = str(body.tanggal, 10)
  if (!isDate(tanggal)) fail(400, 'Tanggal faktur tidak valid.')
  const ship = str(body.ship_date, 10)
  if (ship && !isDate(ship)) fail(400, 'Tanggal kirim tidak valid.')
  const lines = ((Array.isArray(body.lines) ? body.lines : []) as Obj[]).filter((l) => str(l.item_no, 80)).map((l, i): InvoiceLine => {
    const disc = l.disc_pct === '' || l.disc_pct == null ? null : money(l.disc_pct, `Diskon baris ${i + 1}`)
    if (disc !== null && disc > 100) fail(400, `Diskon baris ${i + 1} maksimal 100%.`)
    return {
      id: Number(l.id) || null, item_no: str(l.item_no, 80), nama: str(l.nama, 255), quantity: money(l.quantity, `Kuantitas baris ${i + 1}`, 0.0001), unit: str(l.unit, 40) || null,
      unit_price: money(l.unit_price, `Harga baris ${i + 1}`), disc_pct: disc, so_number: str(l.so_number, 80) || null, catatan: str(l.catatan, 1000) || null,
    }
  })
  if (!lines.length) fail(400, 'Tambahkan minimal satu barang.')
  if (lines.length > 150) fail(400, 'Maksimal 150 barang per faktur.')
  const expenses = ((Array.isArray(body.expenses) ? body.expenses : []) as Obj[]).filter((e) => str(e.account_no, 50) && e.amount !== '').map((e, i): InvoiceExpense => ({
    id: Number(e.id) || null, account_no: str(e.account_no, 50), nama: str(e.nama, 255), amount: money(e.amount, `Biaya baris ${i + 1}`), so_number: str(e.so_number, 80) || null,
  }))
  return {
    customer_no, tanggal, nomor: str(body.nomor, 50) || null, ship_date: ship || null, payment_term: str(body.payment_term, 100) || null, po_number: str(body.po_number, 80) || null,
    alamat: str(body.alamat, 1000) || null, keterangan: str(body.keterangan, 2000) || null,
    taxable: body.taxable === true, inclusive_tax: body.taxable === true && body.inclusive_tax === true, lines, expenses,
  }
}

type AccInvoice = Obj & { id: number; number: string; detailItem?: Obj[]; detailExpense?: Obj[]; primeReceipt?: number; status?: string }
async function invoiceRaw(id: number) {
  return (await send<AccInvoice>('/api/sales-invoice/detail.do', { params: { id } })).d
}

// Isian save.do. Ubah: id + id baris lama; baris yang dibuang dikirim _status=delete.
function invoiceForm(v: InvoiceInput, old?: { id: number; lineIds: number[]; expenseIds: number[] }) {
  const blank = old ? '' : null
  const form: Record<string, string | number | boolean | null> = {
    customerNo: v.customer_no, transDate: toAcc(v.tanggal), number: v.nomor, shipDate: v.ship_date ? toAcc(v.ship_date) : null,
    paymentTermName: v.payment_term, poNumber: v.po_number ?? blank, toAddress: v.alamat ?? blank, description: v.keterangan ?? blank,
    taxable: v.taxable, inclusiveTax: v.inclusive_tax,
  }
  if (old) form.id = old.id
  v.lines.forEach((l, i) => {
    const p = `detailItem[${i}].`
    if (old && l.id && old.lineIds.includes(l.id)) form[`${p}id`] = l.id
    form[`${p}itemNo`] = l.item_no
    form[`${p}detailName`] = l.nama || null
    form[`${p}quantity`] = l.quantity
    form[`${p}itemUnitName`] = l.unit
    form[`${p}unitPrice`] = l.unit_price
    form[`${p}itemDiscPercent`] = l.disc_pct ?? blank
    form[`${p}detailNotes`] = l.catatan ?? blank
    if (l.so_number) form[`${p}salesOrderNumber`] = l.so_number
    form[`${p}useTax1`] = v.taxable
  })
  v.expenses.forEach((e, i) => {
    const p = `detailExpense[${i}].`
    if (old && e.id && old.expenseIds.includes(e.id)) form[`${p}id`] = e.id
    form[`${p}accountNo`] = e.account_no
    form[`${p}expenseName`] = e.nama || null
    form[`${p}expenseAmount`] = e.amount
    if (e.so_number) form[`${p}salesOrderNumber`] = e.so_number
  })
  if (old) {
    const keepL = new Set(v.lines.map((l) => l.id))
    old.lineIds.filter((x) => !keepL.has(x)).forEach((x, j) => { form[`detailItem[${v.lines.length + j}].id`] = x; form[`detailItem[${v.lines.length + j}]._status`] = 'delete' })
    const keepE = new Set(v.expenses.map((e) => e.id))
    old.expenseIds.filter((x) => !keepE.has(x)).forEach((x, j) => { form[`detailExpense[${v.expenses.length + j}].id`] = x; form[`detailExpense[${v.expenses.length + j}]._status`] = 'delete' })
  }
  return form
}

// Salinan ringkas faktur di PAP-MS diperbarui dari detail Accurate
async function storeInvoice(d: AccInvoice, userCol?: 'created_by' | 'updated_by', userId?: number) {
  const customer = (d.customer ?? {}) as Obj
  await db.query(
    `INSERT INTO accurate_sales_invoices (accurate_id, number, trans_date, due_date, customer_accurate_id, total_amount, owing, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE number = VALUES(number), trans_date = VALUES(trans_date), due_date = VALUES(due_date), customer_accurate_id = VALUES(customer_accurate_id),
       total_amount = VALUES(total_amount), owing = VALUES(owing), status = VALUES(status), synced_at = NOW()`,
    [d.id, String(d.number ?? '').slice(0, 80), fromAccurateDate(d.transDate), fromAccurateDate(d.dueDate), n(customer.id ?? d.customerId), n(d.totalAmount), n(d.primeOwing), String(d.statusName ?? d.status ?? '').slice(0, 80)],
  )
  if (userCol && userId) await db.query(`UPDATE accurate_sales_invoices SET ${userCol} = ? WHERE accurate_id = ?`, [userId, d.id])
}

export async function createInvoice(v: InvoiceInput, userId: number) {
  const res = await send<unknown>('/api/sales-invoice/save.do', { form: invoiceForm(v) })
  const r = (res.r ?? {}) as { id?: number; number?: string }
  if (!r.id) fail(502, 'Accurate tidak mengembalikan id faktur.')
  await storeInvoice(await invoiceRaw(r.id!), 'created_by', userId)
  return { id: r.id!, number: r.number ?? '' }
}

export async function updateInvoice(id: number, v: InvoiceInput, userId: number) {
  const cur = await invoiceRaw(id)
  if (Number(cur.primeReceipt ?? 0) > 0) fail(400, 'Faktur sudah ada penerimaan pembayaran; ubah langsung di Accurate.')
  const old = { id, lineIds: (cur.detailItem ?? []).map((l) => Number(l.id)).filter(Boolean), expenseIds: (cur.detailExpense ?? []).map((e) => Number(e.id)).filter(Boolean) }
  await send('/api/sales-invoice/save.do', { form: invoiceForm(v, old) })
  await storeInvoice(await invoiceRaw(id), 'updated_by', userId)
  return { id, number: String(cur.number) }
}

export async function deleteInvoice(id: number) {
  const cur = await invoiceRaw(id)
  if (Number(cur.primeReceipt ?? 0) > 0) fail(400, 'Faktur sudah ada penerimaan pembayaran dan tidak bisa dihapus dari PAP-MS. Hapus penerimaannya dulu di Accurate.')
  await send('/api/sales-invoice/delete.do', { method: 'DELETE', params: { id } })
  await db.query('DELETE FROM accurate_sales_invoices WHERE accurate_id = ?', [id])
  return { number: String(cur.number) }
}

// Faktur lengkap untuk form ubah & cetak
export async function invoiceDetail(id: number) {
  const d = await invoiceRaw(id)
  const customer = (d.customer ?? {}) as Obj
  const term = (d.paymentTerm ?? {}) as Obj
  const items = (d.detailItem ?? []).map((l) => {
    const item = (l.item ?? {}) as Obj
    const so = (l.salesOrder ?? {}) as Obj
    const deliv = (l.deliveryOrder ?? {}) as Obj
    return {
      id: Number(l.id), item_no: String(item.no ?? ''), nama: String(l.detailName ?? item.name ?? ''), quantity: Number(l.quantity ?? 0), unit: nameOf(l.itemUnit),
      unit_price: Number(l.unitPrice ?? 0), disc_pct: l.itemDiscPercent === '' || l.itemDiscPercent == null ? null : Number(l.itemDiscPercent), total: Number(l.totalPrice ?? 0),
      so_number: so.number ? String(so.number) : null, do_number: deliv.number ? String(deliv.number) : null, catatan: (l.detailNotes as string) || null,
    }
  })
  const expenses = (d.detailExpense ?? []).map((e) => ({
    id: Number(e.id), account_no: String(((e.account ?? {}) as Obj).no ?? ''), nama: String(e.expenseName ?? e.detailName ?? ''), amount: Number(e.expenseAmount ?? e.amount ?? 0),
    so_number: ((e.salesOrder ?? {}) as Obj).number ? String(((e.salesOrder ?? {}) as Obj).number) : null,
  }))
  return {
    id: d.id, number: String(d.number ?? ''), tanggal: fromAccurateDate(d.transDate), due_date: fromAccurateDate(d.dueDate), ship_date: fromAccurateDate(d.shipDate),
    customer_no: String(customer.customerNo ?? ''), customer_name: String(customer.name ?? ''), alamat: String(d.toAddress ?? ''), keterangan: String(d.description ?? ''),
    po_number: (d.poNumber as string) || null, payment_term: nameOf(d.paymentTerm), tempo_hari: n(term.netDays) ?? 0,
    taxable: d.taxable === true, inclusive_tax: d.inclusiveTax === true, status: String(d.statusName ?? d.status ?? ''),
    sub_total: Number(d.subTotal ?? 0), discount: Number(d.cashDiscount ?? 0), tax: Number(d.tax1Amount ?? 0), expense_total: Number(d.totalExpense ?? 0), total: Number(d.totalAmount ?? 0),
    down_payment: Number(d.totalDownPayment ?? 0), owing: Number(d.primeOwing ?? 0), receipt: Number(d.primeReceipt ?? 0),
    so_numbers: [...new Set(items.map((l) => l.so_number).filter(Boolean))] as string[],
    do_numbers: [...new Set(items.map((l) => l.do_number).filter(Boolean))] as string[],
    created_by: (d.printUserName as string) || null,
    items, expenses,
  }
}

// Isi awal faktur dari SO (barang yang belum difakturkan + biaya SO)
export async function invoiceDraftFromSo(soId: number) {
  const s = (await send<Obj>('/api/sales-order/detail.do', { params: { id: soId } })).d
  const customer = (s.customer ?? {}) as Obj
  const lines = ((s.detailItem ?? []) as Obj[]).map((l) => {
    const item = (l.item ?? {}) as Obj
    const sisa = Number(l.availableQuantity ?? l.quantity ?? 0)
    return {
      id: null, item_no: String(item.no ?? ''), nama: String(l.detailName ?? item.name ?? ''), quantity: String(sisa > 0 ? sisa : l.quantity ?? ''), unit: nameOf(l.itemUnit),
      unit_price: String(l.unitPrice ?? ''), disc_pct: l.itemDiscPercent === '' || l.itemDiscPercent == null ? '' : String(l.itemDiscPercent), so_number: String(s.number ?? ''), catatan: (l.detailNotes as string) || '',
    }
  })
  const expenses = ((s.detailExpense ?? []) as Obj[]).map((e) => ({
    id: null, account_no: String(((e.account ?? {}) as Obj).no ?? ''), nama: String(e.expenseName ?? e.detailName ?? ''), amount: String(e.expenseAmount ?? e.amount ?? ''), so_number: String(s.number ?? ''),
  }))
  return {
    customer_no: String(customer.customerNo ?? ''), customer_name: String(customer.name ?? ''), so_number: String(s.number ?? ''), po_number: (s.poNumber as string) || String(s.number ?? ''),
    payment_term: nameOf(s.paymentTerm), alamat: String(s.toAddress ?? ''), keterangan: String(s.description ?? ''), taxable: s.taxable === true, inclusive_tax: s.inclusiveTax === true,
    ship_date: fromAccurateDate(s.shipDate) ?? '', lines, expenses,
  }
}

// Pilihan form: pelanggan, syarat bayar, akun biaya (dari faktur / SO yang pernah ada)
let termCache: { at: number; terms: { id: number; name: string }[] } | null = null
export async function invoiceOptions() {
  if (!termCache || Date.now() - termCache.at > 10 * 60e3) {
    const res = await accurateList<{ id: number; name: string; suspended?: boolean }>('payment-term', { fields: 'id,name,suspended' }).catch(() => null)
    termCache = { at: Date.now(), terms: (res?.d ?? []).filter((t) => !t.suspended).map((t) => ({ id: t.id, name: t.name })) }
  }
  const [customers] = await db.query<Row[]>('SELECT accurate_id AS id, customer_no, name FROM customers WHERE accurate_id IS NOT NULL AND customer_no IS NOT NULL AND suspended = 0 ORDER BY name')
  return { paymentTerms: termCache.terms, customers }
}

// Daftar faktur dari salinan Accurate: ?periode=YYYY-MM &q= &status=belum_lunas
export async function listInvoices(periode: string, q: string, status: string) {
  const where = ["si.trans_date >= CONCAT(?, '-01')", "si.trans_date < CONCAT(?, '-01') + INTERVAL 1 MONTH"]
  const args: unknown[] = [periode, periode]
  if (status === 'belum_lunas') where.splice(0, 2, "si.status = 'Belum Lunas'"), args.splice(0, 2)
  if (q) where.push('(si.number LIKE ? OR c.name LIKE ?)'), args.push(`%${q}%`, `%${q}%`)
  const [rows] = await db.query<Row[]>(
    `SELECT si.accurate_id AS id, si.number, si.trans_date, si.due_date, si.total_amount, si.owing, si.status, c.name AS customer_name, c.customer_no,
       uc.name AS created_name, uu.name AS updated_name
     FROM accurate_sales_invoices si LEFT JOIN customers c ON c.accurate_id = si.customer_accurate_id
     LEFT JOIN users uc ON uc.id = si.created_by LEFT JOIN users uu ON uu.id = si.updated_by
     WHERE ${where.join(' AND ')} ORDER BY si.trans_date DESC, si.accurate_id DESC LIMIT 500`,
    args,
  )
  return rows.map((r) => ({ ...r, total_amount: n(r.total_amount), owing: n(r.owing) }))
}
