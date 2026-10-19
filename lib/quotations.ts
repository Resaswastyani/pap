import type { RowDataPacket } from 'mysql2'
import { fail, int, str } from '@/lib/api'
import { db } from '@/lib/db'
import { loadHppParams, toNumber } from '@/lib/hpp'
import { canSupervise, loadProspect, MARKETING_DIVISIONS } from '@/lib/marketing'
import { isLeadOf, isManagement, leadAndGmUsers, type UserProfile } from '@/lib/users'

export const QUOTATION_STATUS = { draft: 'Draft', dikirim: 'Dikirim', diterima: 'Diterima', ditolak: 'Ditolak', batal: 'Batal' } as const
export type QuotationStatus = keyof typeof QUOTATION_STATUS

// Persetujuan internal (db/031): penawaran buatan staff wajib disetujui Kepala Marketing atau GM sebelum dikirim.
// Penawaran buatan penyetuju sendiri tidak perlu diajukan.
export const canApproveQuotation = (user: UserProfile) => isManagement(user) || isLeadOf(user, ...MARKETING_DIVISIONS)
export const quotationApprovers = () => leadAndGmUsers([...MARKETING_DIVISIONS])

export function requireQuotation(user: UserProfile) {
  if (!user.menus.includes('quotation')) fail(403, 'Anda tidak punya akses ke Quotation.')
}

// Staff marketing melihat penawarannya sendiri; Lead/GM/Accounting/admin melihat semua
export const seesAllQuotations = (user: UserProfile) => canSupervise(user) || ['general_manager', 'accounting'].includes(user.division.code)
export const canWriteQuotation = (user: UserProfile) => user.role.isAdmin || user.division.code.startsWith('marketing') || user.division.code === 'general_manager'

export function quotationScope(user: UserProfile) {
  return seesAllQuotations(user) ? { sql: '1 = 1', params: [] as number[] } : { sql: 'q.created_by = ?', params: [user.id] }
}

export const QUOTATION_SELECT = `SELECT q.*, u.name AS created_name, ua.name AS approved_name, p.nama_usaha AS prospect_name, p.status AS prospect_status, c.customer_no,
  (SELECT COUNT(*) FROM quotation_items i WHERE i.quotation_id = q.id) AS item_count,
  DATE_ADD(q.tanggal, INTERVAL q.berlaku_hari DAY) AS berlaku_sampai,
  e.nama AS expedition_name, e.estimasi_hari AS expedition_estimasi,
  (SELECT COALESCE(SUM(pc.nominal), 0) FROM payment_confirmations pc WHERE pc.quotation_id = q.id AND pc.status = 'diterima') AS terbayar
  FROM quotations q JOIN users u ON u.id = q.created_by LEFT JOIN users ua ON ua.id = q.approved_by LEFT JOIN expeditions e ON e.id = q.expedition_id
  LEFT JOIN prospects p ON p.id = q.prospect_id LEFT JOIN customers c ON c.id = q.customer_id`

const toNumbers = (q: RowDataPacket): RowDataPacket => ({
  ...q,
  subtotal: Number(q.subtotal), ppn: Number(q.ppn), total: Number(q.total), ppn_persen: Number(q.ppn_persen),
  item_count: Number(q.item_count ?? 0), pakai_ppn: !!q.pakai_ppn,
  ongkir: q.ongkir === null || q.ongkir === undefined ? null : Number(q.ongkir), dp_persen: q.dp_persen === null || q.dp_persen === undefined ? null : Number(q.dp_persen),
  terbayar: Number(q.terbayar ?? 0),
}) as RowDataPacket

export async function loadQuotation(id: number, user: UserProfile) {
  const scope = quotationScope(user)
  const [rows] = await db.query<RowDataPacket[]>(`${QUOTATION_SELECT} WHERE q.id = ? AND ${scope.sql} LIMIT 1`, [id, ...scope.params])
  return toNumbers(rows[0] ?? fail(404, 'Quotation tidak ditemukan.'))
}
export const serializeQuotation = toNumbers

export async function loadQuotationItems(id: number) {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT id, product_id, nama_produk, spesifikasi, qty, satuan, harga_satuan, subtotal FROM quotation_items WHERE quotation_id = ? ORDER BY sort_order, id',
    [id],
  )
  return rows.map((r) => ({
    id: r.id, product_id: r.product_id, nama_produk: r.nama_produk, spesifikasi: r.spesifikasi, satuan: r.satuan,
    qty: Number(r.qty), harga_satuan: Number(r.harga_satuan), subtotal: Number(r.subtotal),
  }) as { id: number; product_id: number | null; nama_produk: string; spesifikasi: string | null; satuan: string; qty: number; harga_satuan: number; subtotal: number })
}

export const QUOTATION_UNITS = ['pcs', 'kg', 'pack', 'roll', 'lembar'] as const

// Baca isian form. Penawaran = template: produk, spesifikasi, jumlah, dan harga diisi manual (tanpa perhitungan HPP).
export async function readQuotationInput(body: Record<string, unknown>, user: UserProfile) {
  let prospectId: number | null = null
  let customerId: number | null = null
  if (int(body.prospect_id)) prospectId = (await loadProspect(int(body.prospect_id)!, user)).id
  if (int(body.customer_id)) {
    const [[c]] = await db.query<(RowDataPacket & { id: number })[]>('SELECT id FROM customers WHERE id = ?', [int(body.customer_id)])
    customerId = c?.id ?? fail(400, 'Customer tidak ditemukan.')
  }
  const kepada = str(body.kepada, 200) || fail(400, 'Isi nama penerima penawaran (usaha / customer).')
  const tanggal = str(body.tanggal, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) fail(400, 'Tanggal penawaran tidak valid.')
  const berlaku = Math.min(365, Math.max(1, int(body.berlaku_hari) ?? 14))

  const rawItems = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : []
  if (!rawItems.length) fail(400, 'Tambahkan minimal satu produk.')
  if (rawItems.length > 30) fail(400, 'Maksimal 30 produk per penawaran.')
  const params = await loadHppParams() // hanya untuk tarif PPN

  const items = rawItems.map((raw, i) => {
    const nama = str(raw.nama_produk, 255) || fail(400, `Nama produk baris ${i + 1} wajib diisi.`)
    const satuan = (QUOTATION_UNITS as readonly string[]).includes(String(raw.satuan)) ? String(raw.satuan) : 'pcs'
    const qty = toNumber(raw.qty) ?? 0
    if (qty <= 0) fail(400, `Jumlah produk baris ${i + 1} harus lebih dari 0.`)
    const harga = toNumber(raw.harga_satuan) ?? 0
    if (harga < 0) fail(400, `Harga baris ${i + 1} tidak valid.`)
    return {
      product_id: int(raw.product_id),
      nama_produk: nama,
      spesifikasi: str(raw.spesifikasi, 1000) || null,
      qty, satuan,
      harga_satuan: harga,
      subtotal: Math.round(qty * harga * 100) / 100,
    }
  })
  const subtotal = items.reduce((n, it) => n + it.subtotal, 0)
  const pakaiPpn = body.pakai_ppn !== false
  const ppnPersen = params.ppn_persen
  const ppn = pakaiPpn ? Math.round(subtotal * ppnPersen) / 100 : 0
  return {
    header: {
      prospect_id: prospectId, customer_id: customerId, kepada,
      kontak: str(body.kontak, 150) || null, telepon: str(body.telepon, 40) || null, alamat: str(body.alamat, 500) || null,
      tanggal, berlaku_hari: berlaku, pakai_ppn: pakaiPpn ? 1 : 0, ppn_persen: ppnPersen,
      subtotal, ppn, total: subtotal + ppn,
      syarat: str(body.syarat, 5000) || null, catatan: str(body.catatan, 5000) || null,
    },
    items,
  }
}

export async function saveQuotationItems(quotationId: number, items: Awaited<ReturnType<typeof readQuotationInput>>['items']) {
  const ids = items.map((i) => i.product_id).filter((id): id is number => !!id)
  const valid = new Set<number>()
  if (ids.length) {
    const [rows] = await db.query<(RowDataPacket & { id: number })[]>('SELECT id FROM customer_products WHERE id IN (?)', [ids])
    for (const r of rows) valid.add(r.id)
  }
  await db.query('DELETE FROM quotation_items WHERE quotation_id = ?', [quotationId])
  await db.query(
    `INSERT INTO quotation_items (quotation_id, product_id, nama_produk, spesifikasi, model, qty, satuan, harga_satuan, subtotal, sort_order) VALUES ?`,
    [items.map((it, i) => [
      quotationId, it.product_id && valid.has(it.product_id) ? it.product_id : null, it.nama_produk, it.spesifikasi, 'lainnya',
      it.qty, it.satuan, it.harga_satuan, it.subtotal, i + 1,
    ])],
  )
}
