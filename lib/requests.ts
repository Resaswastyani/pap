import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { fail, int, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canSupervise, isMarketing, loadProspect } from '@/lib/marketing'
import { notify, type NotificationType } from '@/lib/notifications'
import { pushToUsers } from '@/lib/push'
import type { UserProfile } from '@/lib/users'

// ---------- Peran ----------
const isGM = (user: UserProfile) => user.division.code === 'general_manager'
export const isPPIC = (user: UserProfile) => user.role.isAdmin || user.division.code === 'ppic'
export const isProduksi = (user: UserProfile) => user.role.isAdmin || user.division.code === 'produksi'
export const isDesigner = (user: UserProfile) => user.role.isAdmin || user.division.code === 'tim_desain'
export const canRequest = (user: UserProfile) => user.role.isAdmin || isGM(user) || isMarketing(user)

export function requireRequestMenu(user: UserProfile, menu: 'sample' | 'desain') {
  if (!user.menus.includes(menu)) fail(403, 'Anda tidak punya akses ke menu ini.')
}

// Staff marketing hanya melihat request miliknya; PPIC/Produksi/Tim Desain/Lead/GM/admin melihat semua
export function sampleScope(user: UserProfile) {
  if (isPPIC(user) || isProduksi(user) || canSupervise(user) || isGM(user)) return { sql: '1 = 1', params: [] as number[] }
  return { sql: 's.requested_by = ?', params: [user.id] }
}
export function designScope(user: UserProfile) {
  if (isDesigner(user) || canSupervise(user) || isGM(user)) return { sql: '1 = 1', params: [] as number[] }
  return { sql: '(d.requested_by = ? OR d.designer_id = ?)', params: [user.id, user.id] }
}

// ---------- Status ----------
export const SAMPLE_STATUS = {
  diajukan: 'Diajukan',
  dijadwalkan: 'Dijadwalkan PPIC',
  diproduksi: 'Diproduksi',
  selesai: 'Selesai produksi',
  dikirim: 'Dikirim ke customer',
  disetujui: 'Disetujui customer',
  revisi: 'Revisi spek',
  batal: 'Batal',
} as const
export type SampleStatus = keyof typeof SAMPLE_STATUS

export const DESIGN_STATUS = {
  diajukan: 'Diajukan',
  dikerjakan: 'Dikerjakan',
  review: 'Review customer',
  revisi: 'Revisi',
  disetujui: 'Disetujui',
  batal: 'Batal',
} as const
export type DesignStatus = keyof typeof DESIGN_STATUS

// ---------- Penerima notifikasi ----------
export async function divisionUsers(codes: string[]) {
  if (!codes.length) return []
  const [rows] = await db.query<(RowDataPacket & { id: number })[]>(
    'SELECT u.id FROM users u JOIN divisions d ON d.id = u.division_id WHERE u.is_active = 1 AND d.code IN (?)',
    [codes],
  )
  return rows.map((r) => r.id)
}

export async function notifyRequest(
  recipients: (number | null | undefined)[],
  actorId: number,
  input: { type: NotificationType; title: string; body?: string | null; sampleId?: number; designId?: number; refKey: string },
) {
  const ids = [...new Set(recipients.filter((id): id is number => !!id && id !== actorId))]
  if (!ids.length) return
  await pushToUsers(await notify(ids, input))
}

export async function logRequest(input: { sampleId?: number; designId?: number; userId: number; from?: string | null; to?: string | null; catatan?: string | null }) {
  await db.query('INSERT INTO request_logs (sample_id, design_id, user_id, status_from, status_to, catatan) VALUES (?, ?, ?, ?, ?, ?)', [
    input.sampleId ?? null, input.designId ?? null, input.userId, input.from ?? null, input.to ?? null, input.catatan ?? null,
  ])
}

export async function loadLogs(column: 'sample_id' | 'design_id', id: number) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT l.id, l.status_from, l.status_to, l.catatan, l.created_at, u.name AS user_name, dv.name AS division_name
     FROM request_logs l JOIN users u ON u.id = l.user_id JOIN divisions dv ON dv.id = u.division_id
     WHERE l.${column} = ? ORDER BY l.id DESC`,
    [id],
  )
  return rows
}

// ---------- Target (prospek / customer) & produk acuan ----------
export async function readTarget(body: Record<string, unknown>, user: UserProfile) {
  let prospectId: number | null = null
  let customerId: number | null = null
  if (int(body.prospect_id)) {
    const p = await loadProspect(int(body.prospect_id)!, user)
    prospectId = p.id
    customerId = p.customer_id ?? null
  } else if (int(body.customer_id)) {
    const [[c]] = await db.query<(RowDataPacket & { id: number })[]>('SELECT id FROM customers WHERE id = ?', [int(body.customer_id)])
    customerId = c?.id ?? fail(400, 'Customer tidak ditemukan.')
  } else {
    fail(400, 'Pilih prospek atau customer.')
  }
  let productId: number | null = null
  if (int(body.product_id)) {
    const [[p]] = await db.query<(RowDataPacket & { id: number })[]>('SELECT id FROM customer_products WHERE id = ?', [int(body.product_id)])
    productId = p?.id ?? fail(400, 'Produk acuan tidak ditemukan.')
  }
  return { prospectId, customerId, productId }
}

export const optDate = (value: unknown, label: string) => {
  const text = str(value, 10)
  if (!text) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) fail(400, `Format ${label} tidak valid.`)
  return text
}

// ---------- Sample ----------
export const SAMPLE_SELECT = `SELECT s.*, ur.name AS requested_name, COALESCE(p.nama_usaha, c.name) AS target_name, c.customer_no,
  cp.nama AS product_name, (SELECT COUNT(*) FROM sample_request_items i WHERE i.sample_id = s.id) AS item_count
  FROM sample_requests s
  JOIN users ur ON ur.id = s.requested_by
  LEFT JOIN prospects p ON p.id = s.prospect_id
  LEFT JOIN customers c ON c.id = s.customer_id
  LEFT JOIN customer_products cp ON cp.id = s.product_id`

export async function loadSample(id: number, user: UserProfile) {
  const scope = sampleScope(user)
  const [rows] = await db.query<RowDataPacket[]>(`${SAMPLE_SELECT} WHERE s.id = ? AND ${scope.sql} LIMIT 1`, [id, ...scope.params])
  return rows[0] ?? fail(404, 'Request sample tidak ditemukan.')
}

// Satu request sample berisi 1..20 produk; spek tiap produk opsional (hanya nama yang wajib)
export type SampleItem = {
  product_id: number | null; nama_produk: string; jenis: string | null; ukuran: string | null; ketebalan: string | null
  bahan: string | null; warna_cetak: string | null; jumlah: string | null; catatan: string | null
}

export function readSampleRequest(body: Record<string, unknown>) {
  const rawItems = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : []
  if (!rawItems.length) fail(400, 'Tambahkan minimal satu produk sample.')
  if (rawItems.length > 20) fail(400, 'Maksimal 20 produk per request sample.')
  const items: SampleItem[] = rawItems.map((raw, i) => {
    const opt = (key: string, max = 255) => str(raw?.[key], max) || null
    const nama_produk = str(raw?.nama_produk, 255) || fail(400, `Nama produk sample ke-${i + 1} wajib diisi.`)
    return {
      product_id: int(raw?.product_id),
      nama_produk,
      jenis: opt('jenis', 80),
      ukuran: opt('ukuran', 150),
      ketebalan: opt('ketebalan', 80),
      bahan: opt('bahan', 255),
      warna_cetak: opt('warna_cetak', 255),
      jumlah: opt('jumlah', 80),
      catatan: opt('catatan', 1000),
    }
  })
  return {
    items,
    // Ringkasan untuk daftar & notifikasi
    nama_produk: (items.length > 1 ? `${items[0].nama_produk} (+${items.length - 1} produk)` : items[0].nama_produk).slice(0, 255),
    spesifikasi: str(body.spesifikasi, 5000) || null,
    special_request: str(body.special_request, 5000) || null,
    tenggat: optDate(body.tenggat, 'tenggat'),
  }
}

export async function saveSampleItems(sampleId: number, items: SampleItem[]) {
  const ids = items.map((i) => i.product_id).filter((id): id is number => !!id)
  const valid = new Set<number>()
  if (ids.length) {
    const [rows] = await db.query<(RowDataPacket & { id: number })[]>('SELECT id FROM customer_products WHERE id IN (?)', [ids])
    for (const r of rows) valid.add(r.id)
  }
  await db.query('DELETE FROM sample_request_items WHERE sample_id = ?', [sampleId])
  await db.query(
    'INSERT INTO sample_request_items (sample_id, product_id, nama_produk, jenis, ukuran, ketebalan, bahan, warna_cetak, jumlah, catatan, sort_order) VALUES ?',
    [items.map((it, i) => [sampleId, it.product_id && valid.has(it.product_id) ? it.product_id : null, it.nama_produk, it.jenis, it.ukuran, it.ketebalan, it.bahan, it.warna_cetak, it.jumlah, it.catatan, i + 1])],
  )
  await db.query('UPDATE sample_requests SET product_id = ? WHERE id = ?', [items[0].product_id && valid.has(items[0].product_id) ? items[0].product_id : null, sampleId])
}

export async function loadSampleItems(sampleId: number) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT i.*, cp.nama AS product_name FROM sample_request_items i LEFT JOIN customer_products cp ON cp.id = i.product_id
     WHERE i.sample_id = ? ORDER BY i.sort_order, i.id`,
    [sampleId],
  )
  return rows
}

// Tahap yang perlu ditindaklanjuti oleh user ini (untuk filter "Perlu tindakan saya")
export function sampleTodoSql(user: UserProfile) {
  const parts: string[] = []
  const params: number[] = []
  if (isPPIC(user)) parts.push("s.status = 'diajukan'")
  if (isProduksi(user)) parts.push("s.status IN ('dijadwalkan', 'diproduksi')")
  if (canRequest(user)) {
    parts.push("(s.requested_by = ? AND s.status IN ('selesai', 'dikirim', 'revisi'))")
    params.push(user.id)
  }
  return parts.length ? { sql: `(${parts.join(' OR ')})`, params } : { sql: '0 = 1', params }
}

// ---------- Desain ----------
export const DESIGN_SELECT = `SELECT d.*, ur.name AS requested_name, ud.name AS designer_name, COALESCE(p.nama_usaha, c.name) AS target_name,
  c.customer_no, cp.nama AS product_name,
  (SELECT COUNT(*) FROM design_request_files f WHERE f.design_id = d.id AND f.kind = 'desain') AS design_count
  FROM design_requests d
  JOIN users ur ON ur.id = d.requested_by
  LEFT JOIN users ud ON ud.id = d.designer_id
  LEFT JOIN prospects p ON p.id = d.prospect_id
  LEFT JOIN customers c ON c.id = d.customer_id
  LEFT JOIN customer_products cp ON cp.id = d.product_id`

export async function loadDesign(id: number, user: UserProfile) {
  const scope = designScope(user)
  const [rows] = await db.query<RowDataPacket[]>(`${DESIGN_SELECT} WHERE d.id = ? AND ${scope.sql} LIMIT 1`, [id, ...scope.params])
  const row = rows[0] ?? fail(404, 'Request desain tidak ditemukan.')
  return { ...row, design_count: Number(row.design_count) } as RowDataPacket
}

export function readDesignBrief(body: Record<string, unknown>) {
  const judul = str(body.judul, 255)
  if (!judul) fail(400, 'Nama produk / desain wajib diisi.')
  const brief = str(body.brief, 10000)
  if (!brief) fail(400, 'Brief desain wajib diisi.')
  const opt = (key: string, max = 255) => str(body[key], max) || null
  return { judul, brief, jenis: opt('jenis', 80), ukuran: opt('ukuran', 150), warna_cetak: opt('warna_cetak', 255), deadline: optDate(body.deadline, 'deadline') }
}

export function designTodoSql(user: UserProfile) {
  const parts: string[] = []
  const params: number[] = []
  if (isDesigner(user)) {
    parts.push("d.status = 'diajukan'", "(d.designer_id = ? AND d.status IN ('dikerjakan', 'revisi'))")
    params.push(user.id)
  }
  if (canRequest(user)) {
    parts.push("(d.requested_by = ? AND d.status = 'review')")
    params.push(user.id)
  }
  return parts.length ? { sql: `(${parts.join(' OR ')})`, params } : { sql: '0 = 1', params }
}

// Desain disetujui -> masuk ke Data Produk: lampirkan ke produk acuan, atau buat produk baru.
// Prospek yang belum jadi customer: produk dibuat tanpa customer, lalu dihubungkan saat prospek dijadikan customer.
export async function publishDesignToProduct(design: RowDataPacket, fileId: number, userId: number) {
  let productId: number | null = design.product_id ?? null
  if (!productId) {
    const spek = [design.ukuran && `Ukuran: ${design.ukuran}`, design.warna_cetak && `Warna cetak: ${design.warna_cetak}`].filter(Boolean).join('\n') || null
    const [result] = await db.query<ResultSetHeader>(
      `INSERT INTO customer_products (customer_id, nama, jenis, spesifikasi, keterangan, status, created_by) VALUES (?, ?, ?, ?, ?, 'aktif', ?)`,
      [design.customer_id ?? null, design.judul, design.jenis, spek, `Dari request desain ${design.nomor}${design.customer_id ? '' : ` (prospek: ${design.target_name})`}`, userId],
    )
    productId = result.insertId
  }
  await db.query(
    `INSERT INTO customer_product_files (product_id, name, mime, size, data, uploaded_by)
     SELECT ?, name, mime, size, data, uploaded_by FROM design_request_files WHERE id = ?`,
    [productId, fileId],
  )
  await db.query('UPDATE customer_products SET updated_by = ?, updated_at = NOW() WHERE id = ?', [userId, productId])
  await db.query('UPDATE design_requests SET product_id = ?, final_file_id = ? WHERE id = ?', [productId, fileId, design.id])
  return productId
}

// Dipanggil saat prospek dijadikan customer: request & produk hasil desain ikut terhubung ke customer
export async function attachRequestsToCustomer(prospectId: number, customerId: number) {
  await db.query('UPDATE sample_requests SET customer_id = ? WHERE prospect_id = ? AND customer_id IS NULL', [customerId, prospectId])
  await db.query('UPDATE design_requests SET customer_id = ? WHERE prospect_id = ? AND customer_id IS NULL', [customerId, prospectId])
  await db.query(
    `UPDATE customer_products cp JOIN design_requests d ON d.product_id = cp.id SET cp.customer_id = ?
     WHERE d.prospect_id = ? AND cp.customer_id IS NULL`,
    [customerId, prospectId],
  )
}

export async function setNomor(table: 'sample_requests' | 'design_requests' | 'quotations', prefix: string, id: number) {
  await db.query(`UPDATE ${table} SET nomor = CONCAT(?, DATE_FORMAT(NOW(), '%y%m'), '-', LPAD(id, 4, '0')) WHERE id = ?`, [`${prefix}-`, id])
  const [[row]] = await db.query<(RowDataPacket & { nomor: string })[]>(`SELECT nomor FROM ${table} WHERE id = ?`, [id])
  return row.nomor
}
