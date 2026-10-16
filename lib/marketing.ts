import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { fail, int, str } from '@/lib/api'
import { db } from '@/lib/db'
import type { UserProfile } from '@/lib/users'

// Divisi marketing sesuai Guidance PT PAP (divisi "marketing" lama = kepala / marketing umum)
export const MARKETING_DIVISIONS = ['marketing', 'marketing_digital', 'marketing_development', 'marketing_maintenance'] as const
export const isMarketing = (user: UserProfile) => (MARKETING_DIVISIONS as readonly string[]).includes(user.division.code)

// Pipeline prospek: Marketing Digital mencari lead -> Marketing Development follow-up, visit, penawaran
// -> order pertama -> diserahkan (handover) ke Marketing Maintenance
export const PROSPECT_STATUS = {
  baru: 'Lead baru',
  dihubungi: 'Dihubungi',
  janji_temu: 'Janji temu',
  visit: 'Sudah visit',
  penawaran: 'Penawaran',
  order_pertama: 'Order pertama',
  handover: 'Handover',
  gagal: 'Gagal',
} as const
export type ProspectStatus = keyof typeof PROSPECT_STATUS
export const PIPELINE: ProspectStatus[] = ['baru', 'dihubungi', 'janji_temu', 'visit', 'penawaran', 'order_pertama', 'handover']
export const CLOSED_STATUS: ProspectStatus[] = ['handover', 'gagal']

export const PROSPECT_SOURCES = ['Instagram', 'Facebook', 'TikTok', 'Google Maps', 'Website', 'Marketplace', 'WhatsApp', 'Referensi', 'Pameran', 'Kunjungan langsung', 'Lainnya']

export const ACTIVITY_TYPES = { whatsapp: 'WhatsApp', telepon: 'Telepon', email: 'Email', visit: 'Visit', meeting: 'Meeting', catatan: 'Catatan' } as const
export type ActivityType = keyof typeof ACTIVITY_TYPES

export const VISIT_STATUS = { terjadwal: 'Terjadwal', selesai: 'Selesai', tidak_bertemu: 'Tidak bertemu', batal: 'Batal' } as const
export const VISIT_TYPES = { visit: 'Visit lokasi', janji_temu: 'Janji temu di kantor', online: 'Meeting online' } as const
export type VisitStatus = keyof typeof VISIT_STATUS

// Foto check-in dikompres di browser (JPEG ±1280px); batas tetap di bawah limit request Vercel 4,5 MB
export const VISIT_PHOTO_MAX_BYTES = 2 * 1024 * 1024

// Supervisor melihat & membagi semua prospek/visit: admin, GM, Lead divisi marketing,
// dan Marketing Digital (yang mencari lead lalu membagikannya ke sales)
export const canSupervise = (user: UserProfile) =>
  user.role.isAdmin || user.division.code === 'general_manager' || user.division.code === 'marketing_digital' || (isMarketing(user) && user.role.code === 'lead')

export function requireMarketing(user: UserProfile, menu: 'prospek' | 'visit') {
  if (!user.menus.includes(menu)) fail(403, 'Anda tidak punya akses ke menu ini.')
}

// Prospek yang boleh dilihat staff: miliknya (sales / maintenance / pembuat)
export function prospectScope(user: UserProfile, alias = 'p') {
  if (canSupervise(user)) return { sql: '1 = 1', params: [] as number[] }
  return { sql: `(${alias}.assigned_to = ? OR ${alias}.maintenance_to = ? OR ${alias}.created_by = ?)`, params: [user.id, user.id, user.id] }
}

export const PROSPECT_SELECT = `SELECT p.*, ua.name AS assigned_name, um.name AS maintenance_name, uc.name AS created_name,
  c.name AS customer_name, c.customer_no,
  (SELECT COUNT(*) FROM marketing_activities a WHERE a.prospect_id = p.id) AS activity_count,
  (SELECT MIN(v.jadwal) FROM visits v WHERE v.prospect_id = p.id AND v.status = 'terjadwal' AND v.jadwal >= NOW() - INTERVAL 1 DAY) AS next_visit
  FROM prospects p
  LEFT JOIN users ua ON ua.id = p.assigned_to
  LEFT JOIN users um ON um.id = p.maintenance_to
  LEFT JOIN users uc ON uc.id = p.created_by
  LEFT JOIN customers c ON c.id = p.customer_id`

export async function loadProspect(id: number, user: UserProfile) {
  const scope = prospectScope(user)
  const [rows] = await db.query<RowDataPacket[]>(`${PROSPECT_SELECT} WHERE p.id = ? AND ${scope.sql} LIMIT 1`, [id, ...scope.params])
  return rows[0] ?? fail(404, 'Prospek tidak ditemukan atau bukan milik Anda.')
}

// Staff hanya boleh mengubah prospek miliknya; supervisor semua
export const canEditProspect = (user: UserProfile, p: { assigned_to: number | null; maintenance_to: number | null; created_by: number }) =>
  canSupervise(user) || [p.assigned_to, p.maintenance_to, p.created_by].includes(user.id)

// "2026-10-15T09:30" / "2026-10-15 09:30" -> "2026-10-15 09:30:00" (WIB, sama dengan zona sesi DB)
export function parseDateTime(value: unknown, label: string, required = false) {
  const text = str(value, 30).replace('T', ' ')
  if (!text) return required ? fail(400, `${label} wajib diisi.`) : null
  const m = text.match(/^(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2})(?::\d{2})?)?$/)
  if (!m) fail(400, `Format ${label.toLowerCase()} tidak valid.`)
  return `${m![1]} ${m![2] ?? '09:00'}:00`
}

// Nomor WA dinormalisasi ke 62xxx agar bisa dibuka lewat wa.me dan dicek duplikat
export function normalizePhone(value: unknown) {
  let digits = str(value, 40).replace(/[^\d+]/g, '').replace(/^\+/, '')
  if (!digits) return null
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`
  else if (digits.startsWith('8')) digits = `62${digits}`
  return digits.slice(0, 20)
}

export type ProspectInput = {
  nama_usaha: string
  sektor: string | null
  kontak_nama: string | null
  kontak_jabatan: string | null
  telepon: string | null
  email: string | null
  alamat: string | null
  kota: string | null
  sumber: string | null
  kebutuhan: string | null
  estimasi_order: string | null
  catatan: string | null
}

export function readProspectInput(body: Record<string, unknown>): ProspectInput {
  const nama_usaha = str(body.nama_usaha, 200)
  if (!nama_usaha) fail(400, 'Nama usaha wajib diisi.')
  const email = str(body.email, 200)
  if (email && !/^\S+@\S+\.\S+$/.test(email)) fail(400, `Format email tidak valid (${nama_usaha}).`)
  const opt = (key: string, max = 255) => str(body[key], max) || null
  return {
    nama_usaha,
    sektor: opt('sektor', 120),
    kontak_nama: opt('kontak_nama', 150),
    kontak_jabatan: opt('kontak_jabatan', 120),
    telepon: normalizePhone(body.telepon),
    email: email || null,
    alamat: opt('alamat', 500),
    kota: opt('kota', 120),
    sumber: opt('sumber', 60),
    kebutuhan: opt('kebutuhan', 500),
    estimasi_order: opt('estimasi_order', 150),
    catatan: opt('catatan', 5000),
  }
}

// User aktif yang boleh menerima prospek/visit (divisi marketing)
export async function requireMarketingUser(value: unknown, label: string) {
  const id = int(value)
  if (!id) return null
  const [[row]] = await db.query<(RowDataPacket & { id: number; name: string })[]>(
    `SELECT u.id, u.name FROM users u JOIN divisions d ON d.id = u.division_id
     WHERE u.id = ? AND u.is_active = 1 AND d.code IN (?)`,
    [id, [...MARKETING_DIVISIONS, 'general_manager']],
  )
  return row ?? fail(400, `${label} harus user aktif dari divisi Marketing.`)
}

export const VISIT_SELECT = `SELECT v.id, v.prospect_id, v.customer_id, v.sales_id, v.jenis, v.jadwal, v.tujuan, v.alamat, v.status,
  v.checkin_at, v.checkin_lat, v.checkin_lng, v.checkin_accuracy, (v.foto IS NOT NULL) AS has_foto, v.hasil, v.next_followup_at,
  v.created_by, v.created_at, uc.name AS created_name,
  (SELECT GROUP_CONCAT(su.name ORDER BY su.id = v.sales_id DESC, su.name SEPARATOR ', ') FROM visit_sales vs JOIN users su ON su.id = vs.user_id WHERE vs.visit_id = v.id) AS sales_name,
  (SELECT GROUP_CONCAT(vs.user_id ORDER BY vs.user_id = v.sales_id DESC, vs.user_id) FROM visit_sales vs WHERE vs.visit_id = v.id) AS sales_ids,
  COALESCE(p.nama_usaha, c.name) AS target_name, COALESCE(p.telepon, c.mobile_phone) AS target_phone,
  p.kontak_nama, p.status AS prospect_status, c.customer_no
  FROM visits v
  JOIN users uc ON uc.id = v.created_by
  LEFT JOIN prospects p ON p.id = v.prospect_id
  LEFT JOIN customers c ON c.id = v.customer_id`

export function visitScope(user: UserProfile) {
  if (canSupervise(user)) return { sql: '1 = 1', params: [] as number[] }
  return { sql: '(v.created_by = ? OR EXISTS (SELECT 1 FROM visit_sales vs WHERE vs.visit_id = v.id AND vs.user_id = ?))', params: [user.id, user.id] }
}

export async function loadVisit(id: number, user: UserProfile) {
  const scope = visitScope(user)
  const [rows] = await db.query<RowDataPacket[]>(`${VISIT_SELECT} WHERE v.id = ? AND ${scope.sql} LIMIT 1`, [id, ...scope.params])
  const row = rows[0] ?? fail(404, 'Jadwal visit tidak ditemukan.')
  return serializeVisit(row)
}

export type VisitRow = {
  id: number; prospect_id: number | null; customer_id: number | null; sales_id: number; jenis: string; jadwal: string; tujuan: string | null
  alamat: string | null; status: VisitStatus; checkin_at: string | null; checkin_lat: number | null; checkin_lng: number | null
  checkin_accuracy: number | null; has_foto: boolean; hasil: string | null; next_followup_at: string | null; created_by: number
  sales_name: string; sales_ids: number[]; target_name: string | null; prospect_status: string | null
}

export const serializeVisit = (v: RowDataPacket): VisitRow => ({
  ...v,
  has_foto: !!Number(v.has_foto),
  sales_ids: String(v.sales_ids ?? v.sales_id).split(',').map(Number).filter(Boolean),
  sales_name: v.sales_name ?? '',
  checkin_lat: v.checkin_lat === null ? null : Number(v.checkin_lat),
  checkin_lng: v.checkin_lng === null ? null : Number(v.checkin_lng),
}) as VisitRow

type Queryable = { query: typeof db.query }

// Catat aktivitas + perbarui waktu aktivitas terakhir / follow-up berikutnya di prospek
export async function logActivity(
  conn: Queryable,
  input: { prospectId?: number | null; customerId?: number | null; visitId?: number | null; userId: number; jenis: string; hasil?: string | null; statusFrom?: string | null; statusTo?: string | null },
) {
  const [result] = await conn.query<ResultSetHeader>(
    'INSERT INTO marketing_activities (prospect_id, customer_id, visit_id, user_id, jenis, hasil, status_from, status_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [input.prospectId ?? null, input.customerId ?? null, input.visitId ?? null, input.userId, input.jenis, input.hasil ?? null, input.statusFrom ?? null, input.statusTo ?? null],
  )
  if (input.prospectId) await conn.query('UPDATE prospects SET last_activity_at = NOW() WHERE id = ?', [input.prospectId])
  return result.insertId
}

// ---- Lampiran laporan visit: semua format file (maks 2 MB, diunggah satu per satu) dan link ----
export const VISIT_FILE_MAX_BYTES = 2 * 1024 * 1024

export function validVisitFile(value: unknown) {
  if (!(value instanceof File) || !value.size) return fail(400, 'File wajib dipilih.')
  if (value.size > VISIT_FILE_MAX_BYTES) fail(400, `${value.name}: ukuran maksimal 2 MB.`)
  return value
}

// Link laporan (Google Drive, katalog, foto online, ...): hanya http/https
export function readLink(url: unknown, name?: unknown) {
  const text = str(url, 1000)
  let parsed: URL
  try {
    parsed = new URL(text)
  } catch {
    return fail(400, `Link tidak valid: ${text || '(kosong)'}`)
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) fail(400, 'Link harus diawali http:// atau https://')
  return { url: parsed.toString(), name: str(name, 255) || parsed.hostname + parsed.pathname.replace(/\/$/, '') }
}

export async function loadVisitAttachments(visitId: number) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT a.id, a.kind, a.name, a.url, a.mime, a.size, a.uploaded_by, a.created_at, u.name AS uploaded_by_name
     FROM visit_attachments a JOIN users u ON u.id = a.uploaded_by WHERE a.visit_id = ? ORDER BY a.id`,
    [visitId],
  )
  return rows
}

// ---- Sales yang ikut visit (bisa lebih dari satu; sales pertama = PIC utama) ----
export const MAX_VISIT_SALES = 10

// Staff otomatis ikut sebagai PIC utama dan boleh mengajak sales lain; Lead/GM/admin bebas memilih.
export async function readVisitSales(body: Record<string, unknown>, user: UserProfile) {
  const raw = Array.isArray(body.sales_ids) ? body.sales_ids : body.sales_id !== undefined && body.sales_id !== '' ? [body.sales_id] : []
  const ids: number[] = []
  for (const value of raw.slice(0, MAX_VISIT_SALES)) {
    const sales = await requireMarketingUser(value, 'Sales')
    if (sales && !ids.includes(sales.id)) ids.push(sales.id)
  }
  if (!canSupervise(user)) return [user.id, ...ids.filter((id) => id !== user.id)].slice(0, MAX_VISIT_SALES)
  if (!ids.length) {
    if (isMarketing(user) || user.division.code === 'general_manager') return [user.id]
    fail(400, 'Pilih sales yang akan melakukan visit.')
  }
  return ids
}

export async function saveVisitSales(visitId: number, ids: number[]) {
  await db.query('DELETE FROM visit_sales WHERE visit_id = ?', [visitId])
  await db.query('INSERT INTO visit_sales (visit_id, user_id) VALUES ?', [ids.map((id) => [visitId, id])])
  await db.query('UPDATE visits SET sales_id = ? WHERE id = ?', [ids[0], visitId])
}

// ---- Produk diminati prospek: dari Data Produk (product_id) atau teks bebas ----
export type ProspectProduct = { product_id: number | null; label: string }

// body.products = [{ product_id, label }] (null = tidak dikirim, data lama tidak diubah)
export function readProspectProducts(body: Record<string, unknown>): ProspectProduct[] | null {
  if (!Array.isArray(body.products)) return null
  const list: ProspectProduct[] = []
  for (const raw of body.products.slice(0, 30) as { product_id?: unknown; label?: unknown }[]) {
    const label = str(raw?.label, 255)
    if (label && !list.some((p) => p.label.toLowerCase() === label.toLowerCase())) list.push({ product_id: int(raw?.product_id), label })
  }
  return list
}

export async function saveProspectProducts(prospectId: number, products: ProspectProduct[]) {
  await db.query('DELETE FROM prospect_products WHERE prospect_id = ?', [prospectId])
  if (!products.length) return
  // product_id yang tidak ada di Data Produk disimpan sebagai teks bebas
  const ids = products.map((p) => p.product_id).filter((id): id is number => !!id)
  const valid = new Set<number>()
  if (ids.length) {
    const [rows] = await db.query<(RowDataPacket & { id: number })[]>('SELECT id FROM customer_products WHERE id IN (?)', [ids])
    for (const r of rows) valid.add(r.id)
  }
  await db.query('INSERT INTO prospect_products (prospect_id, product_id, label, sort_order) VALUES ?', [
    products.map((p, i) => [prospectId, p.product_id && valid.has(p.product_id) ? p.product_id : null, p.label, i + 1]),
  ])
}

export async function loadProspectProducts(prospectId: number) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT pp.product_id, pp.label, cp.nama, cp.jenis, cp.spesifikasi, cp.bahan
     FROM prospect_products pp LEFT JOIN customer_products cp ON cp.id = pp.product_id
     WHERE pp.prospect_id = ? ORDER BY pp.sort_order, pp.id`,
    [prospectId],
  )
  return rows
}
