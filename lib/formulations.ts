// Formulasi Produk = Bill of Material (Formula Produksi) Accurate.
// Data utama di Accurate: barang jadi + bahan (barang bertanda Bahan Baku) dengan jumlah per satuan hasil.
// PAP-MS menyimpan salinannya (sinkron) ditambah data PPIC: jenis plastik, tingkat kualitas, catatan proses, arsip.
// Formulasi baru / perubahan bahan disimpan ke Accurate dulu, lalu salinan diperbarui dari balasan Accurate.
import type { RowDataPacket } from 'mysql2'
import { accurate, accurateDateTime, accurateEnabled } from '@/lib/accurate'
import { storeBomDetail } from '@/lib/accurate-sync'
import { fail, int, str } from '@/lib/api'
import { db } from '@/lib/db'
import { isManagement, type UserProfile } from '@/lib/users'

export const PLASTIC_TYPES = ['HD', 'PP', 'PE', 'LLDPE', 'Mika rigid', 'Lainnya'] as const

export const canViewFormulations = (user: UserProfile) => user.menus.includes('formulasi')
export function requireFormulations(user: UserProfile) {
  if (!canViewFormulations(user)) fail(403, 'Anda tidak punya akses ke menu Formulasi Produk.')
}
// Dikelola PPIC (Guidance: PPIC update formulasi bahan untuk produksi), GM, admin
export const canManageFormulations = (user: UserProfile) => isManagement(user) || user.division.code === 'ppic'

export type FormulaItem = { item_accurate_id: number | null; item_no: string | null; nama: string; quantity: number; unit: string | null; per_unit: number; persentase: number; stok: number | null; line_id?: number }
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
const fmt = (v: number, digits = 4) => v.toLocaleString('id-ID', { maximumFractionDigits: digits })

// "HD 0,935 kg · PE 0,033 kg (per 1 kg hasil)"
export const compositionText = (items: Pick<FormulaItem, 'nama' | 'per_unit' | 'unit'>[], unit: string | null) =>
  items.length ? `${items.map((i) => `${i.nama} ${fmt(i.per_unit)} ${i.unit ?? ''}`.trim()).join(' · ')} (per 1 ${unit ?? 'satuan'} hasil)` : ''

type BomRow = RowDataPacket & {
  accurate_id: number; number: string | null; trans_date: string | null; description: string | null; item_accurate_id: number | null; item_no: string | null
  item_name: string | null; quantity: number | string | null; unit: string | null; suspended: number; synced_at: string
  f_id: number | null; jenis_plastik: string | null; tingkat_kualitas: string | null; catatan: string | null; f_status: 'aktif' | 'arsip' | null
  product_id: number | null; customer_name: string | null; dipakai_aktif: number | string; dipakai_total: number | string
}
type MatRow = RowDataPacket & { bom_accurate_id: number; line_id: number; seq: number | null; item_accurate_id: number | null; item_no: string | null; item_name: string | null; quantity: number | string | null; unit: string | null; stok: number | string | null }

const BOM_SELECT = `SELECT b.accurate_id, b.number, b.trans_date, b.description, b.item_accurate_id, b.item_no, b.item_name, b.quantity, b.unit, b.suspended, b.synced_at,
  f.id AS f_id, f.jenis_plastik, f.tingkat_kualitas, f.catatan, f.status AS f_status,
  p.id AS product_id, c.name AS customer_name,
  (SELECT COUNT(*) FROM production_jobs j WHERE j.formulasi_id = f.id AND j.status IN ('menunggu', 'dijadwalkan', 'berjalan')) AS dipakai_aktif,
  (SELECT COUNT(*) FROM production_jobs j WHERE j.formulasi_id = f.id) AS dipakai_total
  FROM accurate_boms b
  LEFT JOIN formulations f ON f.bom_accurate_id = b.accurate_id
  LEFT JOIN customer_products p ON p.accurate_item_id = b.item_accurate_id
  LEFT JOIN customers c ON c.id = p.customer_id`

// Daftar formulasi dari BOM Accurate: ?q (nomor, barang jadi, bahan), status aktif/arsip, cocok barang tertentu dulu
export async function loadFormulations(opts: { q?: string; status?: string; itemAccurateId?: number | null; bomId?: number; limit?: number; offset?: number; withTotal?: { total: number } }) {
  const where: string[] = []
  const args: unknown[] = []
  if (opts.bomId) where.push('b.accurate_id = ?'), args.push(opts.bomId)
  if (opts.status === 'aktif') where.push("b.suspended = 0 AND COALESCE(f.status, 'aktif') = 'aktif'")
  else if (opts.status === 'arsip') where.push("(b.suspended = 1 OR f.status = 'arsip')")
  if (opts.q) {
    where.push(`(b.number LIKE ? OR b.item_name LIKE ? OR b.item_no LIKE ? OR f.jenis_plastik LIKE ? OR c.name LIKE ?
      OR EXISTS (SELECT 1 FROM accurate_bom_materials m WHERE m.bom_accurate_id = b.accurate_id AND (m.item_name LIKE ? OR m.item_no LIKE ?)))`)
    args.push(...Array(7).fill(`%${opts.q}%`))
  }
  const [boms] = await db.query<BomRow[]>(
    `${BOM_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY ${opts.itemAccurateId ? '(b.item_accurate_id = ?) DESC, ' : ''}b.trans_date DESC, b.accurate_id DESC LIMIT ? OFFSET ?`,
    [...args, ...(opts.itemAccurateId ? [opts.itemAccurateId] : []), opts.limit ?? 100, opts.offset ?? 0],
  )
  if (opts.withTotal) {
    const [[{ count }]] = await db.query<(RowDataPacket & { count: number })[]>(`SELECT COUNT(*) AS count FROM accurate_boms b LEFT JOIN formulations f ON f.bom_accurate_id = b.accurate_id LEFT JOIN customer_products p ON p.accurate_item_id = b.item_accurate_id LEFT JOIN customers c ON c.id = p.customer_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`, args)
    opts.withTotal.total = Number(count)
  }
  const ids = boms.map((b) => b.accurate_id)
  const [mats] = ids.length
    ? await db.query<MatRow[]>(
      `SELECT m.bom_accurate_id, m.line_id, m.seq, m.item_accurate_id, m.item_no, COALESCE(i.name, m.item_name) AS item_name, m.quantity, m.unit,
         COALESCE(i.quantity_on_hand, i.quantity) AS stok
       FROM accurate_bom_materials m LEFT JOIN accurate_items i ON i.accurate_id = m.item_accurate_id
       WHERE m.bom_accurate_id IN (?) ORDER BY m.bom_accurate_id, m.seq, m.line_id`,
      [ids],
    )
    : [[] as MatRow[]]
  return boms.map((b) => {
    const hasil = Number(b.quantity ?? 1) || 1
    const lines = mats.filter((m) => m.bom_accurate_id === b.accurate_id)
    const total = lines.reduce((sum, m) => sum + Number(m.quantity ?? 0), 0)
    const items: FormulaItem[] = lines.map((m) => ({
      line_id: m.line_id, item_accurate_id: m.item_accurate_id, item_no: m.item_no, nama: m.item_name ?? m.item_no ?? '(tanpa nama)',
      quantity: Number(m.quantity ?? 0), unit: m.unit, per_unit: Number(m.quantity ?? 0) / hasil,
      // Porsi bahan dalam campuran (dari total jumlah bahan), untuk batang komposisi
      persentase: total > 0 ? Math.round((Number(m.quantity ?? 0) / total) * 10000) / 100 : 0,
      stok: n(m.stok),
    }))
    return {
      key: `bom-${b.accurate_id}`, sumber: 'accurate' as const, id: b.f_id, bom_accurate_id: b.accurate_id,
      kode: b.number ?? `BOM ${b.accurate_id}`, nama: b.item_name ?? '(barang jadi)', item_accurate_id: b.item_accurate_id, item_no: b.item_no,
      hasil, unit: b.unit, tanggal: b.trans_date, deskripsi: b.description,
      jenis_plastik: b.jenis_plastik, tingkat_kualitas: b.tingkat_kualitas, catatan: b.catatan,
      status: (b.suspended ? 'arsip' : b.f_status ?? 'aktif') as 'aktif' | 'arsip', suspended: !!b.suspended,
      product_id: b.product_id, customer_name: b.customer_name, synced_at: b.synced_at,
      dipakai_aktif: Number(b.dipakai_aktif), dipakai_total: Number(b.dipakai_total),
      items, total_bahan: Math.round(total * 10000) / 10000, komposisi: compositionText(items, b.unit),
    }
  })
}
export type Formulation = Awaited<ReturnType<typeof loadFormulations>>[number]

export async function loadFormulation(bomId: number) {
  const [row] = await loadFormulations({ bomId, limit: 1 })
  return row ?? fail(404, 'Formulasi (BOM) tidak ditemukan. Jalankan sinkron Accurate dulu.')
}

// Baris formulasi PAP-MS untuk satu BOM (dibuat saat PPIC mengisi data tambahan atau memakai BOM di SPK)
export async function ensureFormulationRow(bomId: number, userId: number) {
  const bom = await loadFormulation(bomId)
  if (bom.id) return bom.id
  await db.query(
    "INSERT IGNORE INTO formulations (bom_accurate_id, kode, nama, versi, status, created_by) VALUES (?, ?, ?, 1, 'aktif', ?)",
    [bomId, bom.kode.slice(0, 30), bom.nama.slice(0, 200), userId],
  )
  const [[row]] = await db.query<(RowDataPacket & { id: number })[]>('SELECT id FROM formulations WHERE bom_accurate_id = ?', [bomId])
  return row.id
}

// ---------- Pilihan barang Accurate ----------
// kind=bahan: barang bertanda Bahan Baku (bahan murni dulu, lalu setengah jadi/BS); kind=jadi: barang bertanda Diproduksi
export async function searchItems(kind: 'bahan' | 'jadi', q: string) {
  const where = [kind === 'bahan' ? 'i.material_produced = 1' : 'i.item_produced = 1', 'i.suspended = 0']
  const args: unknown[] = []
  if (q) where.push('(i.name LIKE ? OR i.item_no LIKE ? OR i.category LIKE ?)'), args.push(...Array(3).fill(`%${q}%`))
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT i.accurate_id, i.item_no, i.name, i.unit, i.category, COALESCE(i.quantity_on_hand, i.quantity) AS stok, i.item_produced
     FROM accurate_items i WHERE ${where.join(' AND ')}
     ORDER BY ${kind === 'bahan' ? 'i.item_produced, ' : ''}i.name LIMIT ${kind === 'bahan' ? 300 : 30}`,
    args,
  )
  return rows.map((r) => ({ accurate_id: r.accurate_id, item_no: r.item_no, name: r.name, unit: r.unit, category: r.category, stok: n(r.stok), murni: !r.item_produced }))
}

// ---------- Simpan ke Accurate ----------
type LineInput = { line_id: number | null; item_accurate_id: number; quantity: number; unit: string | null }
export async function readBomInput(body: Record<string, unknown>, existing?: Formulation) {
  const itemId = existing?.item_accurate_id ?? int(body.item_accurate_id) ?? fail(400, 'Pilih barang jadi yang diproduksi.')
  const hasil = Number(String(body.hasil ?? existing?.hasil ?? 1).replace(',', '.'))
  if (!Number.isFinite(hasil) || hasil <= 0) fail(400, 'Jumlah hasil tidak valid.')
  const raw = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : []
  if (!raw.length) fail(400, 'Isi minimal satu bahan.')
  if (raw.length > 30) fail(400, 'Maksimal 30 bahan per formula.')
  const ids = [itemId, ...raw.map((r) => int(r.item_accurate_id) ?? 0)]
  const [items] = await db.query<(RowDataPacket & { accurate_id: number; item_no: string | null; name: string; unit: string | null; material_produced: number | null; item_produced: number | null })[]>(
    'SELECT accurate_id, item_no, name, unit, material_produced, item_produced FROM accurate_items WHERE accurate_id IN (?)',
    [ids],
  )
  const byId = new Map(items.map((i) => [i.accurate_id, i]))
  const product = byId.get(itemId) ?? fail(400, 'Barang jadi tidak ditemukan di data Accurate.')
  if (!product.item_no) fail(400, 'Barang jadi belum punya kode barang di Accurate.')
  const seen = new Set<number>()
  const lines: LineInput[] = raw.map((r, index) => {
    const id = int(r.item_accurate_id) ?? fail(400, `Pilih bahan pada baris ${index + 1}.`)
    const mat = byId.get(id) ?? fail(400, `Bahan baris ${index + 1} tidak ditemukan di data Accurate.`)
    if (!mat.item_no) fail(400, `Bahan ${mat.name} belum punya kode barang di Accurate.`)
    if (seen.has(id)) fail(400, `Bahan ${mat.name} dipilih lebih dari sekali.`)
    seen.add(id)
    const qty = Number(String(r.quantity ?? '').replace(',', '.'))
    if (!Number.isFinite(qty) || qty <= 0) fail(400, `Jumlah bahan ${mat.name} harus lebih dari 0.`)
    return { line_id: int(r.line_id), item_accurate_id: id, quantity: Math.round(qty * 1e6) / 1e6, unit: str(r.unit, 40) || mat.unit }
  })
  return { product, hasil, lines, byId, description: str(body.deskripsi, 500) || null }
}

// Simpan BOM ke Accurate (baru / ubah bahan), lalu ambil detail terbaru ke salinan PAP-MS
export async function saveBomToAccurate(input: Awaited<ReturnType<typeof readBomInput>>, existing?: Formulation) {
  if (!accurateEnabled()) fail(400, 'Integrasi Accurate belum dikonfigurasi, formulasi belum bisa disimpan ke Accurate.')
  const body: Record<string, unknown> = {
    itemNo: input.product.item_no,
    itemUnitName: existing?.unit ?? input.product.unit ?? undefined,
    quantity: input.hasil,
    description: input.description ?? undefined,
    detailMaterial: [
      ...input.lines.map((l) => ({
        ...(l.line_id ? { id: l.line_id } : {}),
        itemNo: input.byId.get(l.item_accurate_id)!.item_no,
        quantity: l.quantity,
        ...(l.unit ? { itemUnitName: l.unit } : {}),
      })),
      // Baris lama yang dihapus dari formula
      ...(existing?.items ?? []).filter((old) => old.line_id && !input.lines.some((l) => l.line_id === old.line_id)).map((old) => ({ id: old.line_id, _status: 'delete' })),
    ],
  }
  if (existing) body.id = existing.bom_accurate_id
  else body.transDate = accurateDateTime().slice(0, 10)
  let res
  try {
    res = await accurate<Record<string, unknown>>('/api/bill-of-material/save.do', { method: 'POST', body })
  } catch (error) {
    fail(502, `Gagal menyimpan formula ke Accurate: ${(error as Error).message}`)
  }
  const saved = (res!.r ?? res!.d) as Record<string, unknown>
  const bomId = Number(saved?.id ?? existing?.bom_accurate_id)
  if (!bomId) fail(502, 'Accurate tidak mengembalikan ID formula (BOM).')
  // Detail lengkap dari Accurate (nomor BOM, id baris bahan) disalin ke PAP-MS
  const detail = await accurate<Record<string, unknown>>('/api/bill-of-material/detail.do', { params: { id: bomId } })
  await storeBomDetail(detail.d, null)
  return bomId
}

// Data tambahan PPIC (tidak ada di Accurate)
export function readExtras(body: Record<string, unknown>) {
  return {
    jenis: str(body.jenis_plastik, 40) || null,
    kualitas: str(body.tingkat_kualitas, 100) || null,
    catatan: str(body.catatan, 5000) || null,
    status: body.status === 'arsip' ? 'arsip' : 'aktif',
  }
}
export async function saveExtras(bomId: number, extras: ReturnType<typeof readExtras>, userId: number) {
  const id = await ensureFormulationRow(bomId, userId)
  await db.query('UPDATE formulations SET jenis_plastik = ?, tingkat_kualitas = ?, catatan = ?, status = ?, updated_by = ? WHERE id = ?', [
    extras.jenis, extras.kualitas, extras.catatan, extras.status, userId, id,
  ])
  return id
}
