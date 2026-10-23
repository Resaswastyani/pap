// Dokumen Order: Surat Order (konfirmasi pesanan) & Proforma Invoice langsung dari Sales Order Accurate.
// Isi (barang, harga, PPN, uang muka) dibaca dari detail SO; tata letak sama dengan dokumen dari Quotation
// (kelas pap-sheet-*), dipakai halaman cetak /cetak/sales-order/[id] dan ekspor Word.
import type { RowDataPacket } from 'mysql2'
import { accurate, AccurateError, fromAccurateDate } from '@/lib/accurate'
import { fail } from '@/lib/api'
import { db } from '@/lib/db'
import { loadSettings } from '@/lib/hpp'
import { parseShipNote } from '@/lib/logistik'
import type { UserProfile } from '@/lib/users'

type Obj = Record<string, unknown>
type Row = RowDataPacket & Obj

export type SoJenis = 'order' | 'proforma'
export const readSoJenis = (raw: string | null | undefined): SoJenis => (raw === 'proforma' ? 'proforma' : 'order')
const JUDUL: Record<SoJenis, string> = { order: 'SURAT ORDER (KONFIRMASI PESANAN)', proforma: 'PROFORMA INVOICE' }

export function requireDokumenOrder(user: UserProfile) {
  if (!user.menus.includes('dokumen-order' as never)) fail(403, 'Anda tidak punya akses ke menu Dokumen Order.')
}

const n = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0)
const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Obj) : {})
// "Pembayaran = DP 50%" di keterangan SO
export const dpFromText = (text: string | null | undefined) => {
  const m = String(text ?? '').match(/\bDP\s*:?\s*(\d{1,3})(?:[.,]\d+)?\s*%/i)
  const v = m ? Number(m[1]) : null
  return v && v > 0 && v <= 100 ? v : null
}

// Detail SO dari Accurate + data customer lokal
export async function loadSoDocument(id: number) {
  if (!Number.isInteger(id) || id <= 0) fail(404, 'Sales order tidak ditemukan.')
  let d: Obj
  try {
    d = (await accurate<Obj>('/api/sales-order/detail.do', { params: { id } })).d
  } catch (error) {
    if (error instanceof AccurateError) fail(400, error.message.replace(/^Accurate \(\d+\): /, 'Accurate: '))
    throw error
  }
  if (!d?.number) fail(404, 'Sales order tidak ditemukan di Accurate.')
  const customer = obj(d.customer)
  const custId = Number(customer.id ?? d.customerId)
  const [[c]] = await db.query<Row[]>('SELECT name, customer_no, mobile_phone, work_phone FROM customers WHERE accurate_id = ?', [custId])
  const items = ((d.detailItem ?? []) as Obj[]).map((l) => {
    const item = obj(l.item)
    return {
      nama: String(l.detailName ?? item.name ?? ''), item_no: (item.no as string) ?? null, qty: n(l.quantity), unit: (obj(l.itemUnit).name as string) ?? '',
      harga: n(l.unitPrice), disc_pct: n(l.itemDiscPercent) || null, disc: n(l.itemCashDiscount), total: n(l.totalPrice), catatan: (l.detailNotes as string) || null,
    }
  })
  const expenses = ((d.detailExpense ?? []) as Obj[]).map((e) => ({ nama: String(e.expenseName ?? obj(e.account).name ?? 'Biaya'), amount: n(e.expenseAmount) })).filter((e) => e.amount)
  const description = (d.description as string) || ''
  const ship = parseShipNote(description)
  const terbayar = n(d.totalDownPayment)
  const total = n(d.totalAmount)
  return {
    id: Number(d.id), nomor: String(d.number), tanggal: fromAccurateDate(d.transDate) ?? '', ship_date: fromAccurateDate(d.shipDate), status: (d.statusName as string) ?? null,
    po_number: (d.poNumber as string) || null, payment_term: (obj(d.paymentTerm).name as string) || null,
    customer_name: String(customer.name ?? c?.name ?? ''), customer_no: (customer.customerNo as string) ?? (c?.customer_no as string) ?? null,
    kontak: (customer.contactName as string) || null, telepon: (c?.mobile_phone as string) || (c?.work_phone as string) || (customer.mobilePhone as string) || (customer.workPhone as string) || null,
    alamat: (d.toAddress as string) || null, keterangan: description,
    ekspedisi: ship ? `${ship.nama}${ship.tarif_per_kg ? ` (Rp ${ship.tarif_per_kg.toLocaleString('id-ID')}/kg)` : ''}` : null,
    items, expenses, subtotal: n(d.subTotal), diskon: n(d.cashDiscount), taxable: d.taxable === true, inclusive: d.inclusiveTax === true,
    ppn_rate: n(d.tax1Rate), ppn: n(d.tax1Amount), total, terbayar, sisa: Math.max(0, total - terbayar), dp_persen: dpFromText(description),
  }
}
export type SoDocument = Awaited<ReturnType<typeof loadSoDocument>>

// Nomor proforma mengikuti nomor SO: SO.2026.10.00060 -> PI.2026.10.00060
export const soDocNomor = (so: SoDocument, jenis: SoJenis) => (jenis === 'order' ? so.nomor : /^SO/i.test(so.nomor) ? so.nomor.replace(/^SO/i, 'PI') : `PI-${so.nomor}`)

// Tagihan proforma: sisa (bila sudah ada uang muka) atau DP x% atau total
export function proformaTagihan(so: SoDocument, dp: number | null) {
  if (so.terbayar > 0) return { label: 'SISA TAGIHAN', amount: so.sisa }
  if (dp && dp < 100) return { label: `DP ${dp}% YANG HARUS DIBAYAR`, amount: Math.round((so.total * dp) / 100) }
  return { label: 'TAGIHAN', amount: so.total }
}

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const tanggal = (v: string | null) => (v ? `${Number(v.slice(8, 10))} ${MONTHS[Number(v.slice(5, 7)) - 1]} ${v.slice(0, 4)}` : '')
const rp = (v: number, digits = 0) => `Rp ${v.toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)

export async function soDocumentHtml(so: SoDocument, jenis: SoJenis, logoSrc: string, opts: { dp?: number | null; tanggalDok?: string | null } = {}) {
  const doc = await loadSettings('doc.')
  const perusahaan = doc.nama || 'PT. Pandawa Amerta Packindo'
  const telepon = String(doc.telepon || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const dp = opts.dp === undefined ? so.dp_persen : opts.dp
  const tagihan = jenis === 'proforma' ? proformaTagihan(so, dp) : null
  const sign = (title: string, name: string, org: string) => `<td><p>${esc(title)}</p><div class="space">&nbsp;</div><p><b>${esc(name)}</b></p><p>${esc(org)}</p></td>`
  const total = (label: string, value: string, grand = false) => `<tr${grand ? ' class="grand"' : ''}><td colspan="4" class="r">${esc(label)}</td><td class="r">${esc(value)}</td></tr>`
  const pembuka = jenis === 'order'
    ? 'Terima kasih atas kepercayaan Anda. Berikut konfirmasi pesanan yang akan kami produksi:'
    : 'Berikut tagihan sementara (proforma) atas pesanan Anda:'
  // Keterangan SO dicetak apa adanya (catatan ukuran, packing, pengiriman, pembayaran)
  const catatan = so.keterangan.replace(/\n\s*\n+/g, '\n').trim()
  const rekening = jenis === 'proforma' ? doc.rekening : null
  const dpp = so.inclusive ? so.subtotal - so.diskon - so.ppn : so.subtotal - so.diskon

  return `<div class="pap-sheet">
<table class="pap-sheet-head"><tbody><tr>
  <td class="logo"><img src="${esc(logoSrc)}" alt="" width="120"></td>
  <td><h1>${esc(perusahaan)}</h1><p>Flexible Plastic Packaging Manufacture</p>${doc.alamat ? `<p>${esc(doc.alamat)}</p>` : ''}${telepon.length ? `<p>Telp/WA: ${telepon.map(esc).join(' · ')}</p>` : ''}${doc.email ? `<p>${esc(doc.email)}</p>` : ''}</td>
</tr></tbody></table>
<h2 class="pap-sheet-title">${JUDUL[jenis]}</h2>
<table class="pap-sheet-meta"><tbody>
  <tr><td>Nomor</td><td>: ${esc(soDocNomor(so, jenis))}</td><td>Tanggal</td><td>: ${tanggal(opts.tanggalDok ?? (jenis === 'proforma' ? new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10) : so.tanggal))}</td></tr>
  <tr><td>Kepada</td><td>: <b>${esc(so.customer_name)}</b></td><td>${jenis === 'order' ? 'No. PO' : 'Ref. SO'}</td><td>: ${esc(jenis === 'order' ? so.po_number || '-' : so.nomor)}</td></tr>
  ${so.kontak ? `<tr><td>Up.</td><td colspan="3">: ${esc(so.kontak)}</td></tr>` : ''}
  ${so.telepon ? `<tr><td>Telepon</td><td colspan="3">: ${esc(so.telepon)}</td></tr>` : ''}
  ${so.alamat ? `<tr><td>Alamat kirim</td><td colspan="3">: ${esc(so.alamat.replace(/\s*\n\s*/g, ', '))}</td></tr>` : ''}
  ${so.ship_date ? `<tr><td>Rencana kirim</td><td colspan="3">: ${tanggal(so.ship_date)}${so.ekspedisi ? ` · via ${esc(so.ekspedisi)}` : ''}</td></tr>` : ''}
  ${so.payment_term ? `<tr><td>Pembayaran</td><td colspan="3">: ${esc(so.payment_term)}</td></tr>` : ''}
</tbody></table>
<p>Dengan hormat,<br>${pembuka}</p>
<table class="pap-sheet-items">
  <thead><tr><th>No</th><th>Produk &amp; spesifikasi</th><th>Jumlah</th><th>Harga satuan</th><th>Jumlah harga</th></tr></thead>
  <tbody>${so.items.map((it, i) => `<tr><td class="c">${i + 1}</td><td><b>${esc(it.nama)}</b>${it.disc_pct ? `<div class="spec">Diskon ${it.disc_pct}%</div>` : ''}${it.catatan ? `<div class="spec">${esc(it.catatan)}</div>` : ''}</td><td class="r">${it.qty.toLocaleString('id-ID')} ${esc(it.unit)}</td><td class="r">${rp(it.harga, it.harga % 1 ? 2 : 0)}</td><td class="r">${rp(it.total)}</td></tr>`).join('')}</tbody>
  <tfoot>
    ${total('Subtotal', rp(so.subtotal))}
    ${so.diskon ? total('Diskon', `- ${rp(so.diskon)}`) : ''}
    ${so.taxable && so.ppn ? (so.inclusive ? `${total('DPP', rp(dpp))}${total(`PPN ${so.ppn_rate}% (termasuk)`, rp(so.ppn))}` : total(`PPN ${so.ppn_rate}%`, rp(so.ppn))) : ''}
    ${so.expenses.map((e) => total(e.nama, rp(e.amount))).join('')}
    ${total('TOTAL', rp(so.total), true)}
    ${so.terbayar > 0 ? total('Uang muka diterima', `- ${rp(so.terbayar)}`) : ''}
    ${tagihan ? total(tagihan.label, rp(tagihan.amount), true) : ''}
  </tfoot>
</table>
${!so.taxable ? '<p class="pap-sheet-note">Harga belum termasuk PPN.</p>' : ''}
${catatan ? `<h3>Catatan pesanan</h3><p class="pre">${esc(catatan)}</p>` : ''}
${rekening ? `<h3>Pembayaran ke</h3><p class="pre">${esc(rekening)}</p><p>Mohon lakukan pembayaran ke rekening di atas dan kirimkan bukti transfer kepada kami.</p>` : ''}
<table class="pap-sheet-sign"><tbody><tr>
  ${jenis === 'order' ? sign('Disetujui pemesan,', so.kontak || '(.........................)', so.customer_name) : '<td>&nbsp;</td>'}
  ${sign('Hormat kami,', doc.penandatangan || '(.........................)', perusahaan)}
</tr></tbody></table>
</div>`
}

// ---------- Daftar SO (lokal, hasil sinkron Accurate) ----------
export async function listSalesOrders(periode: string, q: string, status: string) {
  const where: string[] = []
  const args: unknown[] = []
  if (q) {
    where.push('(so.number LIKE ? OR c.name LIKE ? OR c.customer_no LIKE ?)')
    args.push(`%${q}%`, `%${q}%`, `%${q}%`)
  } else {
    where.push("DATE_FORMAT(so.trans_date, '%Y-%m') = ?")
    args.push(periode)
  }
  if (status === 'terbuka') where.push("so.status IN ('Menunggu diproses', 'Sebagian diproses')")
  else if (status === 'selesai') where.push("so.status NOT IN ('Menunggu diproses', 'Sebagian diproses')")
  const [rows] = await db.query<Row[]>(
    `SELECT so.accurate_id AS id, so.number, DATE_FORMAT(so.trans_date, '%Y-%m-%d') AS tanggal, DATE_FORMAT(so.ship_date, '%Y-%m-%d') AS ship_date, so.status, so.total_amount,
       so.description, c.name AS customer_name, c.customer_no,
       (SELECT COUNT(*) FROM accurate_sales_order_items i WHERE i.so_accurate_id = so.accurate_id) AS baris
     FROM accurate_sales_orders so LEFT JOIN customers c ON c.accurate_id = so.customer_accurate_id
     WHERE ${where.join(' AND ')} ORDER BY so.trans_date DESC, so.accurate_id DESC LIMIT 1000`,
    args,
  )
  return rows.map((r) => ({
    id: Number(r.id), number: String(r.number), tanggal: String(r.tanggal), ship_date: (r.ship_date as string) ?? null, status: (r.status as string) ?? null,
    total: Number(r.total_amount ?? 0), customer_name: (r.customer_name as string) ?? null, customer_no: (r.customer_no as string) ?? null,
    baris: Number(r.baris), dp_persen: dpFromText(r.description as string), ekspedisi: parseShipNote(r.description as string)?.nama ?? null,
  }))
}
