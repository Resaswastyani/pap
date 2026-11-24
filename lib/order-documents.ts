// Dokumen Order tersimpan (tabel order_documents): Surat Order & Proforma Invoice yang dibuat dari SO Accurate
// atau manual, lalu bisa diubah dan dihapus tanpa mengubah SO di Accurate. Dicetak dengan tata letak yang sama
// (orderDocumentHtml di lib/so-document).
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { fail, int, str } from '@/lib/api'
import { db } from '@/lib/db'
import { loadSettings } from '@/lib/hpp'
import { type DocView, loadSoDocument, proformaTagihan, readSoJenis, soDocNomor, type SoJenis, todayWib } from '@/lib/so-document'
import { loadQuotation, loadQuotationItems } from '@/lib/quotations'
import { isManagement, type UserProfile } from '@/lib/users'
import { softDelete } from '@/lib/recycle-bin'

type Row = RowDataPacket & Record<string, unknown>
type PpnMode = 'none' | 'exclusive' | 'inclusive'
export type DocItem = { nama: string; qty: number; unit: string; harga: number; disc_pct: number | null; catatan: string | null }
export type DocExpense = { nama: string; amount: number }
export type DocInput = {
  jenis: SoJenis; jenis_order: 'polos' | 'custom'; nomor: string; tanggal: string; so_accurate_id: number | null; so_number: string | null
  // Quotation asal (Surat Order / Proforma dari Quotation yang diterima)
  quotation_id: number | null
  prospect_id: number | null; customer_id: number | null; ongkir_per_kg: number | null; berat_kg: number | null; diskon_persen: number | null
  kepada: string; customer_no: string | null; kontak: string | null; telepon: string | null; alamat: string | null; po_number: string | null
  ship_date: string | null; ekspedisi: string | null; items: DocItem[]; expenses: DocExpense[]
  diskon: number; ppn_mode: PpnMode; ppn_rate: number; terbayar: number; dp_persen: number | null
  catatan: string | null; rekening: string | null; penandatangan: string | null
}

const num = (v: unknown) => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v)
  return Number.isFinite(n) ? n : 0
}
const round2 = (v: number) => Math.round(v * 100) / 100
const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
const opt = (v: unknown, max = 255) => str(v, max) || null
const json = <T>(v: unknown, fallback: T): T => {
  if (v == null) return fallback
  if (typeof v !== 'string') return v as T
  try { return JSON.parse(v) as T } catch { return fallback }
}

export const lineTotal = (it: DocItem) => round2(it.qty * it.harga * (1 - (it.disc_pct ?? 0) / 100))

// Berat kiriman bawaan = jumlah barang bersatuan kg
export const kgFromItems = (items: DocItem[]) => round2(items.filter((it) => /^kg$/i.test(it.unit.trim())).reduce((t, it) => t + it.qty, 0))
// Ongkos kirim = tarif per kg x berat kiriman (berat kosong = dari barang bersatuan kg)
export const ongkirOf = (d: Pick<DocInput, 'items' | 'ongkir_per_kg' | 'berat_kg'>) =>
  d.ongkir_per_kg ? round2(d.ongkir_per_kg * (d.berat_kg ?? kgFromItems(d.items))) : 0

// Hitung ringkasan angka: subtotal, diskon (persen dari subtotal), PPN (di luar / termasuk), ongkir, total, sisa
export function docTotals(d: Pick<DocInput, 'items' | 'expenses' | 'diskon' | 'diskon_persen' | 'ppn_mode' | 'ppn_rate' | 'terbayar' | 'ongkir_per_kg' | 'berat_kg'>) {
  const subtotal = round2(d.items.reduce((t, it) => t + lineTotal(it), 0))
  const diskon = d.diskon_persen != null ? Math.round((subtotal * d.diskon_persen) / 100) : d.diskon
  const dasar = subtotal - diskon
  const ppn = d.ppn_mode === 'exclusive' ? Math.round((dasar * d.ppn_rate) / 100) : d.ppn_mode === 'inclusive' ? Math.round((dasar * d.ppn_rate) / (100 + d.ppn_rate)) : 0
  const ongkir = ongkirOf(d)
  const biaya = d.expenses.reduce((t, e) => t + e.amount, 0)
  const total = round2(dasar + (d.ppn_mode === 'exclusive' ? ppn : 0) + ongkir + biaya)
  return { subtotal, diskon, ppn, ongkir, total, sisa: Math.max(0, total - d.terbayar) }
}

// Validasi isian form
export async function readDocInput(body: Record<string, unknown>): Promise<DocInput> {
  const jenis = readSoJenis(str(body.jenis, 20))
  const nomor = str(body.nomor, 60)
  if (!nomor) fail(400, 'Nomor dokumen wajib diisi.')
  const tanggal = date(body.tanggal) ?? fail(400, 'Tanggal dokumen tidak valid.')
  const kepada = str(body.kepada, 255)
  if (!kepada) fail(400, 'Nama customer (Kepada) wajib diisi.')
  const items = (Array.isArray(body.items) ? body.items : [])
    .map((x) => {
      const r = (x ?? {}) as Record<string, unknown>
      const disc = num(r.disc_pct)
      return { nama: str(r.nama, 500), qty: num(r.qty), unit: str(r.unit, 40), harga: num(r.harga), disc_pct: disc > 0 ? Math.min(disc, 100) : null, catatan: opt(r.catatan, 500) }
    })
    .filter((it) => it.nama)
  if (!items.length) fail(400, 'Isi minimal satu barang.')
  if (items.some((it) => it.qty <= 0)) fail(400, 'Jumlah setiap barang harus lebih dari 0.')
  if (items.some((it) => it.harga < 0)) fail(400, 'Harga barang tidak boleh negatif.')
  const expenses = (Array.isArray(body.expenses) ? body.expenses : [])
    .map((x) => { const r = (x ?? {}) as Record<string, unknown>; return { nama: str(r.nama, 150), amount: round2(num(r.amount)) } })
    .filter((e) => e.nama && e.amount)
  const ppn_mode = (['none', 'exclusive', 'inclusive'] as const).find((m) => m === body.ppn_mode) ?? 'none'
  const ppn_rate = num(body.ppn_rate)
  if (ppn_mode !== 'none' && (ppn_rate <= 0 || ppn_rate > 100)) fail(400, 'Tarif PPN tidak valid.')
  const dp = num(body.dp_persen)
  const soId = int(body.so_accurate_id)
  // Untuk prospek atau customer (Accurate)
  const prospectId = int(body.prospect_id)
  const customerId = int(body.customer_id)
  if (prospectId) {
    const [[p]] = await db.query<Row[]>('SELECT id FROM prospects WHERE id = ?', [prospectId])
    if (!p) fail(400, 'Prospek tidak ditemukan.')
  }
  if (customerId) {
    const [[c]] = await db.query<Row[]>('SELECT id FROM customers WHERE id = ?', [customerId])
    if (!c) fail(400, 'Customer tidak ditemukan.')
  }
  // Ongkir per kg (opsional) x berat kiriman (kosong = jumlah barang bersatuan kg)
  const ongkir = num(body.ongkir_per_kg)
  if (ongkir < 0) fail(400, 'Ongkos kirim per kg tidak valid.')
  const beratRaw = body.berat_kg === '' || body.berat_kg == null ? null : num(body.berat_kg)
  if (beratRaw !== null && beratRaw < 0) fail(400, 'Berat kiriman tidak valid.')
  // Diskon dalam persen dari subtotal
  const diskonPct = body.diskon_persen === '' || body.diskon_persen == null ? null : num(body.diskon_persen)
  if (diskonPct !== null && (diskonPct < 0 || diskonPct > 100)) fail(400, 'Diskon harus 0–100%.')
  const subtotal = round2(items.reduce((t, it) => t + lineTotal(it), 0))
  return {
    jenis, jenis_order: body.jenis_order === 'custom' ? 'custom' : 'polos', nomor, tanggal, so_accurate_id: soId && soId > 0 ? soId : null, so_number: opt(body.so_number, 60), quotation_id: int(body.quotation_id) || null,
    prospect_id: prospectId && !customerId ? prospectId : null, customer_id: customerId || null,
    ongkir_per_kg: ongkir > 0 ? round2(ongkir) : null, berat_kg: ongkir > 0 && beratRaw !== null ? Math.round(beratRaw * 1000) / 1000 : null,
    diskon_persen: diskonPct ? Math.round(diskonPct * 10000) / 10000 : null,
    kepada, customer_no: opt(body.customer_no, 60), kontak: opt(body.kontak, 150), telepon: opt(body.telepon, 100), alamat: opt(body.alamat, 2000),
    po_number: opt(body.po_number, 100), ship_date: date(body.ship_date), ekspedisi: opt(body.ekspedisi, 255), items, expenses,
    // Diskon persen (diskon_persen) atau nominal Rupiah (diskon), maksimal subtotal
    diskon: diskonPct ? Math.round((subtotal * diskonPct) / 100) : Math.min(subtotal, Math.max(0, round2(num(body.diskon)))), ppn_mode, ppn_rate: ppn_rate > 0 ? ppn_rate : 11, terbayar: Math.max(0, round2(num(body.terbayar))),
    dp_persen: jenis === 'proforma' && dp > 0 && dp < 100 ? dp : null,
    catatan: opt(body.catatan, 5000), rekening: jenis === 'proforma' ? opt(body.rekening, 2000) : null, penandatangan: opt(body.penandatangan, 150),
  }
}

function fromRow(r: Row) {
  const items = json<DocItem[]>(r.items, []).map((it) => ({ ...it, qty: num(it.qty), harga: num(it.harga), disc_pct: it.disc_pct ? num(it.disc_pct) : null, catatan: it.catatan ?? null, unit: it.unit ?? '' }))
  const input: DocInput = {
    jenis: readSoJenis(r.jenis as string), jenis_order: r.jenis_order === 'custom' ? 'custom' : 'polos', nomor: String(r.nomor), tanggal: String(r.tanggal), so_accurate_id: r.so_accurate_id == null ? null : Number(r.so_accurate_id), so_number: (r.so_number as string) ?? null, quotation_id: r.quotation_id == null ? null : Number(r.quotation_id),
    prospect_id: r.prospect_id == null ? null : Number(r.prospect_id), customer_id: r.customer_id == null ? null : Number(r.customer_id),
    ongkir_per_kg: r.ongkir_per_kg == null ? null : num(r.ongkir_per_kg), berat_kg: r.berat_kg == null ? null : num(r.berat_kg),
    diskon_persen: r.diskon_persen == null ? null : num(r.diskon_persen),
    kepada: String(r.kepada), customer_no: (r.customer_no as string) ?? null, kontak: (r.kontak as string) ?? null, telepon: (r.telepon as string) ?? null, alamat: (r.alamat as string) ?? null,
    po_number: (r.po_number as string) ?? null, ship_date: (r.ship_date as string) ?? null, ekspedisi: (r.ekspedisi as string) ?? null,
    items, expenses: json<DocExpense[]>(r.expenses, []).map((e) => ({ nama: String(e.nama), amount: num(e.amount) })),
    diskon: num(r.diskon), ppn_mode: (r.ppn_mode as PpnMode) ?? 'none', ppn_rate: num(r.ppn_rate), terbayar: num(r.terbayar), dp_persen: r.dp_persen == null ? null : num(r.dp_persen),
    catatan: (r.catatan as string) ?? null, rekening: (r.rekening as string) ?? null, penandatangan: (r.penandatangan as string) ?? null,
  }
  return { id: Number(r.id), ...input, created_by: Number(r.created_by), created_by_name: (r.created_by_name as string) ?? null, updated_by_name: (r.updated_by_name as string) ?? null, updated_at: (r.updated_at as string) ?? null }
}
export type OrderDocument = ReturnType<typeof fromRow>

const SELECT = `SELECT d.*, DATE_FORMAT(d.tanggal, '%Y-%m-%d') AS tanggal, DATE_FORMAT(d.ship_date, '%Y-%m-%d') AS ship_date, DATE_FORMAT(d.updated_at, '%Y-%m-%d %H:%i') AS updated_at,
  cu.name AS created_by_name, uu.name AS updated_by_name
  FROM order_documents d LEFT JOIN users cu ON cu.id = d.created_by LEFT JOIN users uu ON uu.id = d.updated_by`

export const canDeleteDoc = (user: UserProfile, doc: { created_by: number }) => doc.created_by === user.id || isManagement(user)

export async function listOrderDocuments(q: string, jenis: string) {
  const where: string[] = []
  const args: unknown[] = []
  if (jenis === 'order' || jenis === 'proforma') { where.push('d.jenis = ?'); args.push(jenis) }
  if (q) { where.push('(d.nomor LIKE ? OR d.kepada LIKE ? OR d.so_number LIKE ? OR d.customer_no LIKE ?)'); args.push(...Array(4).fill(`%${q}%`)) }
  const [rows] = await db.query<Row[]>(`${SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY d.tanggal DESC, d.id DESC LIMIT 1000`, args)
  return rows.map(fromRow).map((d) => ({ ...d, ...docTotals(d) }))
}

export async function loadOrderDocument(id: number) {
  const [[row]] = await db.query<Row[]>(`${SELECT} WHERE d.id = ?`, [id])
  if (!row) fail(404, 'Dokumen order tidak ditemukan.')
  return fromRow(row)
}

const COLS = ['jenis', 'jenis_order', 'nomor', 'tanggal', 'so_accurate_id', 'so_number', 'quotation_id', 'prospect_id', 'customer_id', 'kepada', 'customer_no', 'kontak', 'telepon', 'alamat', 'po_number', 'ship_date', 'ekspedisi',
  'ongkir_per_kg', 'berat_kg', 'items', 'expenses', 'diskon', 'diskon_persen', 'ppn_mode', 'ppn_rate', 'terbayar', 'dp_persen', 'catatan', 'rekening', 'penandatangan'] as const
const values = (d: DocInput) => COLS.map((c) => (c === 'items' || c === 'expenses' ? JSON.stringify(d[c]) : d[c]))

const duplicate = (error: unknown, d: DocInput) => {
  if ((error as { code?: string }).code === 'ER_DUP_ENTRY') fail(400, `Nomor ${d.nomor} sudah dipakai ${d.jenis === 'order' ? 'Surat Order' : 'Proforma'} lain.`)
  throw error
}

export async function createOrderDocument(user: UserProfile, d: DocInput) {
  try {
    const [res] = await db.query<ResultSetHeader>(`INSERT INTO order_documents (${COLS.join(', ')}, created_by) VALUES (${COLS.map(() => '?').join(', ')}, ?)`, [...values(d), user.id])
    return res.insertId
  } catch (error) {
    return duplicate(error, d)
  }
}

export async function updateOrderDocument(user: UserProfile, id: number, d: DocInput) {
  await loadOrderDocument(id)
  try {
    await db.query(`UPDATE order_documents SET ${COLS.map((c) => `${c} = ?`).join(', ')}, updated_by = ? WHERE id = ?`, [...values(d), user.id, id])
  } catch (error) {
    duplicate(error, d)
  }
}

export async function deleteOrderDocument(user: UserProfile, id: number) {
  const doc = await loadOrderDocument(id)
  if (!canDeleteDoc(user, doc)) fail(403, 'Hanya pembuat dokumen atau manajemen yang bisa menghapus.')
  await softDelete({ table: 'order_documents', id, modul: 'Dokumen Order', user })
}

// Isian awal form: salinan SO Accurate (?so=ID) atau dokumen kosong
export async function draftOrderDocument(jenis: SoJenis, soId: number | null): Promise<DocInput> {
  const doc = await loadSettings('doc.')
  const base = { rekening: jenis === 'proforma' ? doc.rekening || null : null, penandatangan: doc.penandatangan || null }
  if (!soId) {
    const prefix = jenis === 'order' ? 'SO' : 'PI'
    const ym = todayWib().slice(0, 7).replace('-', '.')
    const [[r]] = await db.query<Row[]>('SELECT COUNT(*) AS n FROM order_documents WHERE jenis = ? AND nomor LIKE ?', [jenis, `${prefix}-M.${ym}.%`])
    return {
      jenis, jenis_order: 'polos', nomor: `${prefix}-M.${ym}.${String(Number(r.n) + 1).padStart(4, '0')}`, tanggal: todayWib(), so_accurate_id: null, so_number: null, quotation_id: null,
      prospect_id: null, customer_id: null, ongkir_per_kg: null, berat_kg: null, diskon_persen: null,
      kepada: '', customer_no: null, kontak: null, telepon: null, alamat: null, po_number: null, ship_date: null, ekspedisi: null,
      items: [{ nama: '', qty: 1, unit: 'pcs', harga: 0, disc_pct: null, catatan: null }], expenses: [], diskon: 0, ppn_mode: 'none', ppn_rate: 11, terbayar: 0, dp_persen: jenis === 'proforma' ? 50 : null,
      catatan: null, ...base,
    }
  }
  const so = await loadSoDocument(soId)
  const [[cust]] = so.customer_no ? await db.query<Row[]>('SELECT id FROM customers WHERE customer_no = ? LIMIT 1', [so.customer_no]) : [[undefined]]
  // Diskon SO (Rupiah) diubah ke persen dari subtotal
  const soSub = so.subtotal || 0
  return {
    jenis, jenis_order: 'polos', nomor: soDocNomor(so, jenis), tanggal: jenis === 'proforma' ? todayWib() : so.tanggal, so_accurate_id: so.id, so_number: so.nomor, quotation_id: null,
    prospect_id: null, customer_id: cust ? Number(cust.id) : null, ongkir_per_kg: null, berat_kg: null,
    diskon_persen: so.diskon && soSub ? Math.round((so.diskon / soSub) * 1000000) / 10000 : null,
    kepada: so.customer_name, customer_no: so.customer_no, kontak: so.kontak, telepon: so.telepon, alamat: so.alamat, po_number: so.po_number,
    ship_date: so.ship_date, ekspedisi: so.ekspedisi,
    items: so.items.map((it) => {
      const item: DocItem = { nama: it.nama, qty: it.qty, unit: it.unit, harga: it.harga, disc_pct: it.disc_pct, catatan: it.catatan }
      // Potongan tunai per baris di Accurate dilebur ke harga satuan agar jumlahnya sama
      return it.qty && Math.abs(lineTotal(item) - it.total) > 1 ? { ...item, harga: round2(it.total / it.qty), disc_pct: null } : item
    }),
    expenses: so.expenses, diskon: so.diskon, ppn_mode: so.taxable && so.ppn ? (so.inclusive ? 'inclusive' : 'exclusive') : 'none', ppn_rate: so.ppn_rate || 11,
    terbayar: so.terbayar, dp_persen: jenis === 'proforma' && !so.terbayar ? (so.dp_persen && so.dp_persen < 100 ? so.dp_persen : null) : null,
    catatan: so.keterangan.replace(/\n\s*\n+/g, '\n').trim() || null, ...base,
  }
}

// Dokumen yang sudah tersimpan untuk quotation ini (per jenis); null = belum ada
export async function quotationDocumentId(quotationId: number, jenis: SoJenis, nomor?: string | null) {
  const [[r]] = await db.query<Row[]>(
    'SELECT id FROM order_documents WHERE jenis = ? AND (quotation_id = ? OR (quotation_id IS NULL AND nomor = ?)) ORDER BY quotation_id IS NULL, id DESC LIMIT 1',
    [jenis, quotationId, nomor ?? ''],
  )
  return r ? Number(r.id) : null
}

// Isian awal Surat Order / Proforma Invoice dari Quotation yang sudah Diterima (data order: nomor, pengiriman, DP, ongkir)
export async function draftFromQuotation(jenis: SoJenis, quotationId: number, user: UserProfile): Promise<DocInput> {
  const q = await loadQuotation(quotationId, user) as Record<string, unknown>
  if (!q.order_nomor) fail(400, 'Surat order belum dibuat. Buka penawaran yang sudah Diterima lalu isi data order.')
  const [items, doc] = await Promise.all([loadQuotationItems(quotationId), loadSettings('doc.')])
  const n = (v: unknown) => (v == null || v === '' ? null : Number(v))
  const via = q.pengiriman === 'driver_pap' ? `Armada PT. Pandawa Amerta Packindo${q.driver_nama ? ` (${q.driver_nama})` : ''}`
    : q.expedition_name ? String(q.expedition_name) : q.pengiriman === 'ambil' ? 'Diambil sendiri oleh customer' : null
  const ongkirPerKg = q.pakai_ongkir ? n(q.ongkir_per_kg) : null
  const ongkirLain = n(q.ongkir) ?? 0
  const dp = n(q.dp_persen)
  const terbayar = n(q.terbayar) ?? 0
  return {
    jenis, jenis_order: 'polos', nomor: String(jenis === 'order' ? q.order_nomor : q.proforma_nomor || q.order_nomor),
    tanggal: jenis === 'proforma' ? todayWib() : String(q.order_at ?? q.tanggal ?? todayWib()).slice(0, 10), so_accurate_id: null, so_number: null, quotation_id: quotationId,
    prospect_id: q.customer_id ? null : n(q.prospect_id), customer_id: n(q.customer_id),
    ongkir_per_kg: ongkirPerKg && ongkirPerKg > 0 ? ongkirPerKg : null, berat_kg: ongkirPerKg ? n(q.ongkir_berat_kg) : null,
    diskon_persen: q.pakai_diskon && q.diskon_tipe === 'persen' ? n(q.diskon_nilai) : null,
    kepada: String(q.kepada ?? ''), customer_no: (q.customer_no as string) ?? null, kontak: (q.kontak as string) ?? null,
    telepon: (q.telepon as string) || (q.whatsapp as string) || null, alamat: (q.alamat as string) ?? null, po_number: null,
    ship_date: q.tanggal_kirim ? String(q.tanggal_kirim).slice(0, 10) : null, ekspedisi: via,
    items: items.map((it) => ({ nama: it.nama_produk, qty: it.qty, unit: it.satuan, harga: it.harga_satuan, disc_pct: null, catatan: it.spesifikasi || null })),
    expenses: ongkirLain > 0 ? [{ nama: 'Ongkos kirim', amount: ongkirLain }] : [],
    diskon: q.pakai_diskon && q.diskon_tipe !== 'persen' ? Number(q.diskon ?? 0) : 0,
    ppn_mode: q.pakai_ppn ? 'exclusive' : 'none', ppn_rate: n(q.ppn_persen) || 11, terbayar,
    dp_persen: jenis === 'proforma' && !terbayar && dp && dp < 100 ? dp : null,
    catatan: (q.catatan_order as string) || null,
    rekening: jenis === 'proforma' ? (q.rekening as string) || doc.rekening || null : null, penandatangan: doc.penandatangan || null,
  }
}

export function orderDocumentView(d: DocInput): DocView {
  const t = docTotals(d)
  return {
    jenis: d.jenis, nomor: d.nomor, tanggal: d.tanggal, ref: d.po_number, so_ref: d.jenis === 'proforma' ? d.so_number : null,
    customer_name: d.kepada, kontak: d.kontak, telepon: d.telepon, alamat: d.alamat, ship_date: d.ship_date, ekspedisi: d.ekspedisi,
    items: d.items.map((it) => ({ ...it, total: lineTotal(it) })),
    // Ongkir per kg dicetak sebagai baris biaya: "Ongkos kirim (Rp 1.500/kg x 100 kg)"
    expenses: [
      ...(t.ongkir ? [{ nama: `Ongkos kirim (Rp ${Number(d.ongkir_per_kg).toLocaleString('id-ID')}/kg × ${(d.berat_kg ?? kgFromItems(d.items)).toLocaleString('id-ID')} kg)`, amount: t.ongkir }] : []),
      ...d.expenses,
    ],
    subtotal: t.subtotal, diskon: t.diskon,
    ppn_mode: d.ppn_mode, ppn_rate: d.ppn_rate, ppn: t.ppn, total: t.total, terbayar: d.terbayar,
    tagihan: d.jenis === 'proforma' ? proformaTagihan({ total: t.total, terbayar: d.terbayar, sisa: t.sisa }, d.dp_persen) : null,
    catatan: d.catatan ?? '', rekening: d.jenis === 'proforma' ? d.rekening : null, penandatangan: d.penandatangan,
  }
}
