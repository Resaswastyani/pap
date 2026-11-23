// Form Checklist Order Custom: Marketing mengisi & memeriksa kelengkapan data order custom -> PPIC verifikasi & paraf
// -> Divisi Operasional (Produksi) terima & paraf -> selesai. Isian checklist disimpan sebagai JSON (kolom `isian`).
import type { RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'
import { notify } from '@/lib/notifications'
import { pushToUsers } from '@/lib/push'
import { isManagement, type UserProfile } from '@/lib/users'

export const OC_STATUS = { draft: 'Draft Marketing', ppic: 'Verifikasi PPIC', operasional: 'Diterima Operasional', selesai: 'Selesai' } as const
export type OcStatus = keyof typeof OC_STATUS

// Baris checklist ber-kotak centang + keterangan (garis titik-titik di formulir)
export const OC_PLASTIK = [
  { key: 'bentuk', label: 'Bentuk Plastik' },
  { key: 'ukuran_las', label: 'Detail Ukuran Plastik & Jarak Las' },
  { key: 'ketebalan', label: 'Ketebalan plastik' },
] as const
export const OC_CETAKAN = [
  { key: 'gambar_plastik', label: 'Gambar cetakan pada plastik' },
  { key: 'gambar_tabung', label: 'Gambar cetakan pada tabung' },
  { key: 'ukuran_cetakan', label: 'Detail ukuran cetakan' },
  { key: 'posisi_cetakan', label: 'Detail ukuran posisi cetakan atas bawah kiri kanan' },
] as const
export const OC_AKHIR = [
  { key: 'pantone', label: 'Pantone Warna' },
] as const
export const OC_KELENGKAPAN = { key: 'kelengkapan', label: 'Kelengkapan Data & Tidak ada perubahan' } as const
const LINE_KEYS = [...OC_PLASTIK, ...OC_CETAKAN, ...OC_AKHIR, OC_KELENGKAPAN].map((x) => x.key)
export type OcLineKey = (typeof LINE_KEYS)[number]
export type OcLine = { cek: boolean; ket: string }

export type OcIsian = {
  spek: '' | 'baru' | 'repeat'
  order_print: boolean
  order_polos: boolean
  jumlah_ukuran: string // Jumlah Ukuran & Jenis Plastik
  aksesoris: '' | 'ada' | 'tidak'
  aksesoris_lampiran: boolean
  aksesoris_ket: string
  jumlah_tabung: string
  jenis_cetakan: '' | 'continue' | 'fixed'
  gusset: '' | 'masuk' | 'tidak'
  lines: Record<OcLineKey, OcLine>
  desain: OcDesain[] // desain dari Master Data (Logo & Desain)
}
export type OcDesain = { id: string; name: string; mime: string; web_link: string | null }
export const emptyIsian = (): OcIsian => ({
  spek: '', order_print: false, order_polos: false, jumlah_ukuran: '', aksesoris: '', aksesoris_lampiran: false, aksesoris_ket: '',
  jumlah_tabung: '', jenis_cetakan: '', gusset: '', lines: Object.fromEntries(LINE_KEYS.map((k) => [k, { cek: false, ket: '' }])) as Record<OcLineKey, OcLine>, desain: [],
})

// Kelengkapan: item yang berlaku (bagian Desain Cetakan hanya untuk orderan Print)
export function ocProgress(i: OcIsian) {
  const checks: boolean[] = [
    !!i.spek, i.order_print || i.order_polos, !!i.jumlah_ukuran.trim(),
    ...OC_PLASTIK.map((x) => i.lines[x.key].cek),
    !!i.aksesoris, ...(i.aksesoris === 'ada' ? [i.aksesoris_lampiran] : []),
  ]
  if (i.order_print) checks.push(!!i.jumlah_tabung.trim(), !!i.jenis_cetakan, ...OC_CETAKAN.map((x) => i.lines[x.key].cek), !!i.gusset, i.lines.pantone.cek)
  checks.push(i.lines.kelengkapan.cek)
  return { done: checks.filter(Boolean).length, total: checks.length }
}

const MARKETING = (u: UserProfile) => u.division.code === 'marketing' || u.division.code.startsWith('marketing_')
export function requireOrderCustom(user: UserProfile) {
  if (!user.role.isAdmin && !user.menus.includes('order-custom' as never)) fail(403, 'Anda tidak punya akses ke Checklist Order Custom.')
}
export const canMarketing = (u: UserProfile) => u.role.isAdmin || isManagement(u) || MARKETING(u)
export const canPpic = (u: UserProfile) => u.role.isAdmin || isManagement(u) || u.division.code === 'ppic'
export const canOperasional = (u: UserProfile) => u.role.isAdmin || isManagement(u) || u.division.code === 'produksi'

type Row = RowDataPacket & Record<string, unknown>
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))

function parseIsian(v: unknown): OcIsian {
  const base = emptyIsian()
  let raw: Partial<OcIsian> = {}
  try { raw = v ? (JSON.parse(String(v)) as Partial<OcIsian>) : {} } catch {}
  return { ...base, ...raw, lines: { ...base.lines, ...(raw.lines ?? {}) }, desain: Array.isArray(raw.desain) ? raw.desain : [] }
}

const SELECT = `SELECT o.*, DATE_FORMAT(o.tanggal, '%Y-%m-%d') AS tanggal, p.nama_usaha AS prospect_name, cu.customer_no, cp.kode AS product_kode, od.nomor AS order_doc_nomor, od.jenis AS order_doc_jenis,
    uc.name AS created_name, um.name AS marketing_name, up.name AS ppic_name, uo.name AS operasional_name,
    (SELECT COUNT(*) FROM note_attachments na WHERE na.owner_type = 'order_custom' AND na.owner_id = o.id) AS lampiran
  FROM order_custom_checklists o LEFT JOIN prospects p ON p.id = o.prospect_id
  LEFT JOIN customers cu ON cu.id = o.customer_id LEFT JOIN customer_products cp ON cp.id = o.product_id
  LEFT JOIN order_documents od ON od.id = o.order_document_id
  LEFT JOIN users uc ON uc.id = o.created_by LEFT JOIN users um ON um.id = o.marketing_oleh
  LEFT JOIN users up ON up.id = o.ppic_oleh LEFT JOIN users uo ON uo.id = o.operasional_oleh`

export function serializeChecklist(r: Row) {
  const isian = parseIsian(r.isian)
  return {
    id: Number(r.id), nomor: String(r.nomor), status: String(r.status) as OcStatus, tanggal: String(r.tanggal),
    prospect_id: num(r.prospect_id), prospect_name: (r.prospect_name as string | null) ?? null,
    customer_id: num(r.customer_id), customer_no: (r.customer_no as string | null) ?? null, product_id: num(r.product_id), product_kode: (r.product_kode as string | null) ?? null,
    order_document_id: num(r.order_document_id), order_doc_nomor: (r.order_doc_nomor as string | null) ?? null, order_doc_jenis: (r.order_doc_jenis as string | null) ?? null,
    nama_customer: String(r.nama_customer), nama_produk: String(r.nama_produk), referensi: (r.referensi as string | null) ?? null,
    isian, progress: ocProgress(isian), catatan: (r.catatan as string | null) ?? null, alasan_kembali: (r.alasan_kembali as string | null) ?? null,
    marketing_oleh: num(r.marketing_oleh), marketing_name: (r.marketing_name as string | null) ?? null, marketing_at: r.marketing_at ? String(r.marketing_at) : (null as string | null),
    ppic_oleh: num(r.ppic_oleh), ppic_name: (r.ppic_name as string | null) ?? null, ppic_at: r.ppic_at ? String(r.ppic_at) : (null as string | null),
    operasional_oleh: num(r.operasional_oleh), operasional_name: (r.operasional_name as string | null) ?? null, operasional_at: r.operasional_at ? String(r.operasional_at) : (null as string | null),
    lampiran: Number(r.lampiran) || 0,
    created_by: num(r.created_by), created_name: (r.created_name as string | null) ?? null, created_at: String(r.created_at), updated_at: String(r.updated_at),
  }
}
export type OrderChecklist = ReturnType<typeof serializeChecklist>

// Formulir kosong (cetak lalu dicentang manual dengan pena)
export const blankChecklist = (): OrderChecklist => ({
  id: 0, nomor: '', status: 'draft', tanggal: '', prospect_id: null, prospect_name: null, customer_id: null, customer_no: null, product_id: null, product_kode: null, order_document_id: null, order_doc_nomor: null, order_doc_jenis: null, nama_customer: '', nama_produk: '', referensi: null,
  isian: emptyIsian(), progress: { done: 0, total: 0 }, catatan: null, alasan_kembali: null,
  marketing_oleh: null, marketing_name: null, marketing_at: null, ppic_oleh: null, ppic_name: null, ppic_at: null,
  operasional_oleh: null, operasional_name: null, operasional_at: null, lampiran: 0, created_by: null, created_name: null, created_at: '', updated_at: '',
})

export async function loadChecklist(id: number) {
  const [[r]] = await db.query<Row[]>(`${SELECT} WHERE o.id = ?`, [id])
  if (!r) fail(404, 'Checklist order custom tidak ditemukan.')
  return serializeChecklist(r!)
}

export async function listChecklists(params: URLSearchParams) {
  const where: string[] = []
  const args: unknown[] = []
  const status = params.get('status')
  if (status && status in OC_STATUS) where.push('o.status = ?'), args.push(status)
  const prospect = Number(params.get('prospect_id'))
  if (Number.isInteger(prospect) && prospect > 0) where.push('o.prospect_id = ?'), args.push(prospect)
  const docId = Number(params.get('order_document_id'))
  if (Number.isInteger(docId) && docId > 0) where.push('o.order_document_id = ?'), args.push(docId)
  const q = str(params.get('q'), 100)
  if (q) where.push('(o.nomor LIKE ? OR o.nama_produk LIKE ? OR o.nama_customer LIKE ? OR o.referensi LIKE ? OR od.nomor LIKE ?)'), args.push(...Array(5).fill(`%${q}%`))
  const [rows] = await db.query<Row[]>(
    `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY FIELD(o.status, 'ppic', 'operasional', 'draft', 'selesai'), o.updated_at DESC, o.id DESC LIMIT 500`,
    args,
  )
  const [counts] = await db.query<Row[]>('SELECT status, COUNT(*) AS n FROM order_custom_checklists GROUP BY status')
  return { items: rows.map(serializeChecklist), counts: Object.fromEntries(counts.map((c) => [String(c.status), Number(c.n)])) }
}

export async function nextChecklistNumber() {
  const year = new Date(Date.now() + 7 * 3600e3).getUTCFullYear()
  const prefix = `OC-${year}-`
  const [[r]] = await db.query<Row[]>('SELECT MAX(CAST(SUBSTRING(nomor, ?) AS UNSIGNED)) AS n FROM order_custom_checklists WHERE nomor LIKE ?', [prefix.length + 1, `${prefix}%`])
  return `${prefix}${String((Number(r?.n) || 0) + 1).padStart(4, '0')}`
}

const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | '' => (allowed.includes(v as T) ? (v as T) : '')

// Isian checklist dari body (semua opsional; kelengkapan dicek saat diserahkan)
export async function readIsian(raw: unknown): Promise<OcIsian> {
  const b = (raw ?? {}) as Record<string, unknown>
  const linesRaw = (b.lines ?? {}) as Record<string, Record<string, unknown> | undefined>
  const out = emptyIsian()
  for (const k of LINE_KEYS) out.lines[k] = { cek: linesRaw[k]?.cek === true, ket: str(linesRaw[k]?.ket, 500) }
  return {
    ...out,
    spek: pick(b.spek, ['baru', 'repeat'] as const), order_print: b.order_print === true, order_polos: b.order_polos === true,
    jumlah_ukuran: str(b.jumlah_ukuran, 255), aksesoris: pick(b.aksesoris, ['ada', 'tidak'] as const), aksesoris_lampiran: b.aksesoris === 'ada' && b.aksesoris_lampiran === true,
    aksesoris_ket: str(b.aksesoris_ket, 255), jumlah_tabung: str(b.jumlah_tabung, 60), jenis_cetakan: pick(b.jenis_cetakan, ['continue', 'fixed'] as const),
    gusset: pick(b.gusset, ['masuk', 'tidak'] as const), desain: await readDesain(b.desain),
  }
}

// Desain terpilih: hanya file yang terdaftar di Master Data (data diambil ulang dari database), maks 12
async function readDesain(raw: unknown): Promise<OcDesain[]> {
  const ids = [...new Set((Array.isArray(raw) ? raw : []).map((x) => str((x as Record<string, unknown>)?.id, 100)).filter(Boolean))].slice(0, 12)
  if (!ids.length) return []
  const [rows] = await db.query<Row[]>('SELECT id, name, mime, web_link FROM drive_files WHERE id IN (?)', [ids])
  const byId = new Map(rows.map((r) => [String(r.id), r]))
  return ids.filter((id) => byId.has(id)).map((id) => { const r = byId.get(id)!; return { id, name: String(r.name), mime: String(r.mime), web_link: (r.web_link as string | null) ?? null } })
}

export async function readHeader(body: Record<string, unknown>) {
  const nama_customer = str(body.nama_customer, 255) || fail(400, 'Isi nama customer.')
  const nama_produk = str(body.nama_produk, 255) || fail(400, 'Isi nama produk.')
  const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(String(body.tanggal ?? '')) ? String(body.tanggal) : new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
  // Sumber data: Customer (repeat order) atau Prospek (order baru); produk dari Data Produk bila customer
  const exists = async (table: string, id: number | null) => {
    if (!id) return null
    const [[x]] = await db.query<Row[]>(`SELECT id FROM ${table} WHERE id = ?`, [id])
    return x ? Number(x.id) : null
  }
  const customerId = await exists('customers', num(body.customer_id))
  const prospectId = customerId ? null : await exists('prospects', num(body.prospect_id))
  const productId = customerId ? await exists('customer_products', num(body.product_id)) : null
  return { nama_customer: nama_customer!, nama_produk: nama_produk!, tanggal, prospect_id: prospectId, customer_id: customerId, product_id: productId, referensi: str(body.referensi, 150) || null, catatan: str(body.catatan, 5000) || null }
}

// Syarat minimal diserahkan: "Keterangan Order Custom (Wajib Ada)"
export function assertWajib(i: OcIsian) {
  if (!i.spek) fail(400, 'Pilih Spek Plastik: Baru atau Repeat Order.')
  if (!i.order_print && !i.order_polos) fail(400, 'Centang Orderan: Print dan/atau Polos.')
}

async function usersOf(where: string) {
  const [rows] = await db.query<Row[]>(`SELECT u.id FROM users u JOIN divisions d ON d.id = u.division_id WHERE u.is_active = 1 AND (${where})`)
  return rows.map((r) => Number(r.id))
}
export const ppicUsers = () => usersOf("d.code = 'ppic'")
export const operasionalUsers = () => usersOf("d.code = 'produksi'")

// Semua dibuka ke menu "Form Order Custom" (menu Produksi "Checklist Order Custom" diarsipkan; diisi lewat Dokumen Order)
export async function notifyChecklist(userIds: (number | null)[], c: { id: number; nomor: string; nama_produk: string; nama_customer: string }, title: string, key: string, exclude?: number, marketing = false) {
  const users = [...new Set(userIds.filter((x): x is number => !!x && x !== exclude))]
  if (!users.length) return
  await pushToUsers(await notify(users, {
    type: 'order_custom', title, body: `${c.nomor} · ${c.nama_produk} · ${c.nama_customer}`,
    page: 'Form Order Custom', pageId: c.id, refKey: `oc:${c.id}:${key}`,
  }))
}

// ---- Dari form Dokumen Order: checklist per produk (dicocokkan per nama produk dalam dokumen) ----
// entries: body.custom = [{ nama_produk, isian }]. Checklist yang sudah diserahkan ke PPIC / selesai tidak diubah dari dokumen.
export async function syncOrderDocChecklists(
  docId: number,
  doc: { kepada: string; tanggal: string; nomor: string; po_number: string | null; prospect_id: number | null; customer_id: number | null },
  entries: unknown, user: UserProfile,
) {
  const out = { dibuat: 0, diperbarui: 0, dikunci: 0 }
  if (!Array.isArray(entries) || !entries.length || !canMarketing(user) || (!user.role.isAdmin && !user.menus.includes('order-custom' as never))) return out
  const [rows] = await db.query<Row[]>('SELECT id, nama_produk, status FROM order_custom_checklists WHERE order_document_id = ?', [docId])
  const existing = new Map(rows.map((r) => [String(r.nama_produk).trim().toLowerCase(), r]))
  for (const raw of entries.slice(0, 30) as Record<string, unknown>[]) {
    const nama = str(raw?.nama_produk, 255)
    if (!nama) continue
    const header = await readHeader({
      nama_customer: doc.kepada, nama_produk: nama, tanggal: doc.tanggal, referensi: doc.po_number || doc.nomor,
      prospect_id: doc.prospect_id, customer_id: doc.customer_id, product_id: raw?.product_id,
    })
    // Catatan checklist tidak ditimpa dari dokumen order
    const { catatan, ...h } = header
    void catatan
    const isian = JSON.stringify(await readIsian(raw?.isian))
    const cur = existing.get(nama.toLowerCase())
    if (cur) {
      if (cur.status !== 'draft') { out.dikunci++; continue }
      await db.query('UPDATE order_custom_checklists SET ?, isian = ?, updated_by = ? WHERE id = ?', [h, isian, user.id, cur.id])
      out.diperbarui++
    } else {
      await db.query('INSERT INTO order_custom_checklists SET ?', [{ ...h, order_document_id: docId, nomor: await nextChecklistNumber(), isian, created_by: user.id, updated_by: user.id }])
      out.dibuat++
    }
  }
  return out
}
