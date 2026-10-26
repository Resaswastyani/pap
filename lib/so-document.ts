// Dokumen Order: Surat Order (konfirmasi pesanan) & Proforma Invoice langsung dari Sales Order Accurate.
// Isi (barang, harga, PPN, uang muka) dibaca dari detail SO; tata letak sama dengan dokumen dari Quotation
// (kelas pap-sheet-*), dipakai halaman cetak /cetak/sales-order/[id] dan ekspor Word.
import type { RowDataPacket } from 'mysql2'
import { accurate, AccurateError, fromAccurateDate } from '@/lib/accurate'
import { fail } from '@/lib/api'
import { db } from '@/lib/db'
import { loadSettings } from '@/lib/hpp'
import { WORD_CSS } from '@/lib/quotation-document'
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

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const tanggal = (v: string | null) => (v ? `${Number(v.slice(8, 10))} ${MONTHS[Number(v.slice(5, 7)) - 1]} ${v.slice(0, 4)}` : '')
const rp = (v: number, digits = 0) => `Rp ${v.toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)

// Tagihan proforma: sisa (bila sudah ada uang muka) atau DP x% atau total
export function proformaTagihan(so: { total: number; terbayar: number; sisa: number }, dp: number | null) {
  if (so.terbayar > 0) return { label: 'SISA TAGIHAN', amount: so.sisa }
  if (dp && dp < 100) return { label: `DP ${dp}% YANG HARUS DIBAYAR`, amount: Math.round((so.total * dp) / 100) }
  return { label: 'TAGIHAN', amount: so.total }
}

// Isi dokumen yang siap dicetak: dari SO Accurate langsung (soToView) atau dari dokumen tersimpan (lib/order-documents)
export type DocView = {
  jenis: SoJenis; nomor: string; tanggal: string; ref: string | null
  customer_name: string; kontak: string | null; telepon: string | null; alamat: string | null; ship_date: string | null; ekspedisi: string | null
  items: { nama: string; qty: number; unit: string; harga: number; disc_pct: number | null; total: number; catatan: string | null }[]
  expenses: { nama: string; amount: number }[]
  subtotal: number; diskon: number; ppn_mode: 'none' | 'exclusive' | 'inclusive'; ppn_rate: number; ppn: number; total: number; terbayar: number
  tagihan: { label: string; amount: number } | null; catatan: string; rekening: string | null; penandatangan: string | null
}

export const todayWib = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)

export async function soToView(so: SoDocument, jenis: SoJenis, opts: { dp?: number | null; tanggalDok?: string | null } = {}): Promise<DocView> {
  const doc = await loadSettings('doc.')
  const dp = opts.dp === undefined ? so.dp_persen : opts.dp
  return {
    jenis, nomor: soDocNomor(so, jenis), tanggal: opts.tanggalDok ?? (jenis === 'proforma' ? todayWib() : so.tanggal),
    ref: jenis === 'order' ? so.po_number : so.nomor,
    customer_name: so.customer_name, kontak: so.kontak, telepon: so.telepon, alamat: so.alamat, ship_date: so.ship_date, ekspedisi: so.ekspedisi,
    items: so.items, expenses: so.expenses, subtotal: so.subtotal, diskon: so.diskon,
    ppn_mode: so.taxable && so.ppn ? (so.inclusive ? 'inclusive' : 'exclusive') : 'none', ppn_rate: so.ppn_rate, ppn: so.ppn, total: so.total, terbayar: so.terbayar,
    tagihan: jenis === 'proforma' ? proformaTagihan(so, dp) : null,
    // Keterangan SO dicetak apa adanya (catatan ukuran, packing, pengiriman, pembayaran)
    catatan: so.keterangan, rekening: jenis === 'proforma' ? doc.rekening || null : null, penandatangan: doc.penandatangan || null,
  }
}

export async function soDocumentHtml(so: SoDocument, jenis: SoJenis, logoSrc: string, opts: { dp?: number | null; tanggalDok?: string | null } = {}) {
  return orderDocumentHtml(await soToView(so, jenis, opts), logoSrc)
}

export async function orderDocumentHtml(v: DocView, logoSrc: string) {
  const doc = await loadSettings('doc.')
  const perusahaan = doc.nama || 'PT. Pandawa Amerta Packindo'
  const telepon = String(doc.telepon || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const total = (label: string, value: string, grand = false) => `<tr${grand ? ' class="grand"' : ''}><td colspan="4" class="r">${esc(label)}</td><td class="r">${esc(value)}</td></tr>`
  const pembuka = v.jenis === 'order'
    ? 'Terima kasih atas kepercayaan Anda. Berikut konfirmasi pesanan yang akan kami produksi:'
    : 'Berikut tagihan sementara (proforma) atas pesanan Anda:'
  const catatan = v.catatan.replace(/\n\s*\n+/g, '\n').trim()
  const dpp = v.ppn_mode === 'inclusive' ? v.subtotal - v.diskon - v.ppn : v.subtotal - v.diskon

  return `<div class="pap-sheet">
<table class="pap-sheet-head"><tbody><tr>
  <td class="logo"><img src="${esc(logoSrc)}" alt="" width="120"></td>
  <td><h1>${esc(perusahaan)}</h1><p>Flexible Plastic Packaging Manufacture</p>${doc.alamat ? `<p>${esc(doc.alamat)}</p>` : ''}${telepon.length ? `<p>Telp/WA: ${telepon.map(esc).join(' · ')}</p>` : ''}${doc.email ? `<p>${esc(doc.email)}</p>` : ''}</td>
</tr></tbody></table>
<h2 class="pap-sheet-title">${JUDUL[v.jenis]}</h2>
<table class="pap-sheet-meta"><tbody>
  <tr><td>Nomor</td><td>: ${esc(v.nomor)}</td><td>Tanggal</td><td>: ${tanggal(v.tanggal)}</td></tr>
  <tr><td>Kepada</td><td>: <b>${esc(v.customer_name)}</b></td><td>${v.jenis === 'order' ? 'No. PO' : 'Ref. SO'}</td><td>: ${esc(v.ref || '-')}</td></tr>
  ${v.kontak ? `<tr><td>Up.</td><td colspan="3">: ${esc(v.kontak)}</td></tr>` : ''}
  ${v.telepon ? `<tr><td>Telepon</td><td colspan="3">: ${esc(v.telepon)}</td></tr>` : ''}
  ${v.alamat ? `<tr><td>Alamat kirim</td><td colspan="3">: ${esc(v.alamat.replace(/\s*\n\s*/g, ', '))}</td></tr>` : ''}
  ${v.ship_date ? `<tr><td>Rencana kirim</td><td colspan="3">: ${tanggal(v.ship_date)}${v.ekspedisi ? ` · via ${esc(v.ekspedisi)}` : ''}</td></tr>` : ''}
</tbody></table>
<p>Dengan hormat,<br>${pembuka}</p>
<table class="pap-sheet-items">
  <thead><tr><th>No</th><th>Produk &amp; spesifikasi</th><th>Jumlah</th><th>Harga satuan</th><th>Jumlah harga</th></tr></thead>
  <tbody>${v.items.map((it, i) => `<tr><td class="c">${i + 1}</td><td><b>${esc(it.nama)}</b>${it.disc_pct ? `<div class="spec">Diskon ${it.disc_pct}%</div>` : ''}${it.catatan ? `<div class="spec">${esc(it.catatan)}</div>` : ''}</td><td class="r">${it.qty.toLocaleString('id-ID')} ${esc(it.unit)}</td><td class="r">${rp(it.harga, it.harga % 1 ? 2 : 0)}</td><td class="r">${rp(it.total)}</td></tr>`).join('')}</tbody>
  <tfoot>
    ${total('Subtotal', rp(v.subtotal))}
    ${v.diskon ? total('Diskon', `- ${rp(v.diskon)}`) : ''}
    ${v.ppn_mode !== 'none' && v.ppn ? (v.ppn_mode === 'inclusive' ? `${total('DPP', rp(dpp))}${total(`PPN ${v.ppn_rate}% (termasuk)`, rp(v.ppn))}` : total(`PPN ${v.ppn_rate}%`, rp(v.ppn))) : ''}
    ${v.expenses.map((e) => total(e.nama, rp(e.amount))).join('')}
    ${total('TOTAL', rp(v.total), true)}
    ${v.terbayar > 0 ? total('Uang muka diterima', `- ${rp(v.terbayar)}`) : ''}
    ${v.tagihan ? total(v.tagihan.label, rp(v.tagihan.amount), true) : ''}
  </tfoot>
</table>
${catatan ? `<h3>Catatan pesanan</h3><p class="pre">${esc(catatan)}</p>` : ''}
${v.rekening ? `<h3>Pembayaran ke</h3><p class="pre">${esc(v.rekening)}</p><p>Mohon lakukan pembayaran ke rekening di atas dan kirimkan bukti transfer kepada kami.</p>` : ''}
<table class="pap-sheet-sign"><tbody><tr>
  <td>&nbsp;</td>
  <td><p>Hormat kami,</p><div class="space">&nbsp;</div>${v.penandatangan ? `<p><b>${esc(v.penandatangan)}</b></p>` : ''}<p>${esc(perusahaan)}</p></td>
</tr></tbody></table>
</div>`
}

// Ekspor Word (.doc berformat HTML) untuk Surat Order / Proforma
export function wordResponse(nomor: string, body: string) {
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${esc(nomor)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>${WORD_CSS}</style></head><body>${body}</body></html>`
  return new Response(`﻿${html}`, {
    headers: {
      'Content-Type': 'application/msword; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nomor.replace(/[^\w.-]+/g, '_')}.doc"`,
      'Cache-Control': 'no-store',
    },
  })
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
