import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canEditMaterialPrice, materialInfo, materialJenis } from '@/lib/material-analysis'
import { calcProjection, materialKey, type ProjComp, type ProjItem, type ProjPrice } from '@/lib/projection-calc'
import type { UserProfile } from '@/lib/users'

// Riset & Proyeksi bahan baku: dokumen simulasi (produk rencana + komposisi + harga bahan) yang disimpan di SIMPAP.
// Buat / ubah / hapus: PPIC, Purchasing, Kepala Produksi, GM, admin. Semua yang bisa membuka menu boleh melihat.
export const canEditProjection = (user: UserProfile) => canEditMaterialPrice(user) || user.division.code === 'ppic'

type Row = RowDataPacket & Record<string, unknown>
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))
const parse = <T>(v: unknown, fallback: T): T => {
  try { return v ? (JSON.parse(String(v)) as T) : fallback } catch { return fallback }
}

const serializeItem = (r: Row): ProjItem & { id: number } => ({
  id: Number(r.id), item_accurate_id: num(r.item_accurate_id), item_no: (r.item_no as string) ?? null, nama: String(r.nama), satuan: (r.satuan as string) ?? null,
  quantity: Number(r.quantity), harga_jual: num(r.harga_jual), berat: Number(r.berat), waste: Number(r.waste),
  komposisi: parse<ProjComp[]>(r.komposisi, []), bom_number: (r.bom_number as string) ?? null, catatan: (r.catatan as string) ?? null,
})

// Stok Accurate saat ini untuk bahan yang dipakai (dibandingkan dengan kebutuhan)
async function stockFor(prices: ProjPrice[]) {
  const ids = prices.map((p) => p.item_accurate_id).filter((x): x is number => !!x)
  const out: Record<string, number | null> = {}
  if (!ids.length) return out
  const info = await materialInfo(ids)
  for (const p of prices) if (p.item_accurate_id) out[p.key] = info.get(p.item_accurate_id)?.stok ?? null
  return out
}

export async function listProjections() {
  const [heads] = await db.query<Row[]>(
    `SELECT p.id, p.kode, p.nama, DATE_FORMAT(p.tanggal_mulai, '%Y-%m-%d') AS tanggal_mulai, DATE_FORMAT(p.tanggal_selesai, '%Y-%m-%d') AS tanggal_selesai,
       p.catatan, p.harga_bahan, p.updated_at, u.name AS updated_by_name
     FROM material_projections p LEFT JOIN users u ON u.id = COALESCE(p.updated_by, p.created_by)
     ORDER BY p.updated_at DESC, p.id DESC LIMIT 500`,
  )
  const ids = heads.map((h) => Number(h.id))
  const [items] = ids.length ? await db.query<Row[]>('SELECT * FROM material_projection_items WHERE projection_id IN (?) ORDER BY projection_id, sort, id', [ids]) : [[] as Row[]]
  return heads.map((h) => {
    const list = items.filter((i) => Number(i.projection_id) === Number(h.id)).map(serializeItem)
    const calc = calcProjection(list, parse<ProjPrice[]>(h.harga_bahan, []))
    return {
      id: Number(h.id), kode: String(h.kode), nama: String(h.nama), tanggal_mulai: (h.tanggal_mulai as string) ?? null, tanggal_selesai: (h.tanggal_selesai as string) ?? null,
      catatan: (h.catatan as string) ?? null, updated_at: String(h.updated_at), updated_by_name: (h.updated_by_name as string) ?? null,
      produk: list.length, totals: calc.totals,
    }
  })
}

export async function loadProjection(id: number) {
  const [[h]] = await db.query<Row[]>(
    `SELECT p.*, DATE_FORMAT(p.tanggal_mulai, '%Y-%m-%d') AS tanggal_mulai, DATE_FORMAT(p.tanggal_selesai, '%Y-%m-%d') AS tanggal_selesai, u.name AS updated_by_name
     FROM material_projections p LEFT JOIN users u ON u.id = COALESCE(p.updated_by, p.created_by) WHERE p.id = ?`,
    [id],
  )
  if (!h) fail(404, 'Riset / proyeksi tidak ditemukan.')
  const [items] = await db.query<Row[]>(
    'SELECT mpi.*, ai.item_no FROM material_projection_items mpi LEFT JOIN accurate_items ai ON ai.accurate_id = mpi.item_accurate_id WHERE mpi.projection_id = ? ORDER BY mpi.sort, mpi.id',
    [id],
  )
  const prices = parse<ProjPrice[]>(h.harga_bahan, [])
  return {
    id: Number(h.id), kode: String(h.kode), nama: String(h.nama), tanggal_mulai: (h.tanggal_mulai as string) ?? null, tanggal_selesai: (h.tanggal_selesai as string) ?? null,
    catatan: (h.catatan as string) ?? null, updated_at: String(h.updated_at), updated_by_name: (h.updated_by_name as string) ?? null,
    items: items.map(serializeItem), prices, stock: await stockFor(prices),
  }
}

// Validasi isian dokumen dari browser
export function readProjection(body: Record<string, unknown>) {
  const nama = str(body.nama, 200)
  if (!nama) fail(400, 'Isi nama riset / proyeksi.')
  const date = (v: unknown) => {
    const t = str(v, 10)
    if (!t) return null
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || Number.isNaN(Date.parse(t))) fail(400, 'Tanggal periode tidak valid.')
    return t
  }
  const tanggal_mulai = date(body.tanggal_mulai)
  const tanggal_selesai = date(body.tanggal_selesai)
  if (tanggal_mulai && tanggal_selesai && tanggal_mulai > tanggal_selesai) fail(400, 'Tanggal mulai harus sebelum tanggal selesai.')
  const rawItems = Array.isArray(body.items) ? (body.items as unknown[]) : []
  if (rawItems.length > 200) fail(400, 'Maksimal 200 produk per riset.')
  const items = rawItems.map((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>
    const label = `Produk ${i + 1}: `
    const n = (v: unknown, name: string, { min = 0, max = 1e12, nullable = false } = {}) => {
      if (nullable && (v === null || v === undefined || v === '')) return null
      const x = Number(v)
      if (!Number.isFinite(x) || x < min || x > max) fail(400, `${label}${name} tidak valid.`)
      return x
    }
    const komposisi = (Array.isArray(r.komposisi) ? (r.komposisi as unknown[]) : []).slice(0, 30).map((c) => {
      const k = (c ?? {}) as Record<string, unknown>
      const name = str(k.name, 255)
      if (!name) fail(400, `${label}nama bahan di komposisi kosong.`)
      const id = num(k.item_accurate_id)
      return { key: materialKey(id && Number.isInteger(id) ? id : null, name), item_accurate_id: id && Number.isInteger(id) ? id : null, name, persen: n(k.persen, 'persen komposisi', { max: 1000 })! }
    })
    const nama = str(r.nama, 255)
    if (!nama) fail(400, `${label}isi nama produk.`)
    const itemId = num(r.item_accurate_id)
    return {
      item_accurate_id: itemId && Number.isInteger(itemId) ? itemId : null, nama, satuan: str(r.satuan, 40) || 'kg',
      quantity: n(r.quantity, 'jumlah')!, harga_jual: n(r.harga_jual, 'harga jual', { nullable: true }),
      berat: n(r.berat, 'berat bahan per satuan', { max: 1e6 })!, waste: n(r.waste, 'waste', { max: 100 })!,
      komposisi, bom_number: str(r.bom_number, 80) || null, catatan: str(r.catatan, 255) || null,
    }
  })
  // Harga bahan: hanya bahan yang dipakai di komposisi
  const used = new Set(items.flatMap((i) => i.komposisi.map((k) => k.key)))
  const prices = (Array.isArray(body.prices) ? (body.prices as unknown[]) : []).map((raw) => {
    const p = (raw ?? {}) as Record<string, unknown>
    const id = num(p.item_accurate_id)
    const name = str(p.name, 255)
    const harga = p.harga === null || p.harga === undefined || p.harga === '' ? null : Number(p.harga)
    if (harga !== null && (!Number.isFinite(harga) || harga < 0 || harga > 1e12)) fail(400, `Harga bahan ${name} tidak valid.`)
    return { key: materialKey(id && Number.isInteger(id) ? id : null, name), item_accurate_id: id && Number.isInteger(id) ? id : null, name, unit: str(p.unit, 40) || 'kg', harga, sumber: str(p.sumber, 60) || null }
  }).filter((p) => p.name && used.has(p.key))
  return { nama, tanggal_mulai, tanggal_selesai, catatan: str(body.catatan, 3000) || null, items, prices }
}

async function nextKode() {
  const ym = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7).replace('-', '')
  const [[r]] = await db.query<Row[]>("SELECT MAX(CAST(SUBSTRING_INDEX(kode, '-', -1) AS UNSIGNED)) AS n FROM material_projections WHERE kode LIKE ?", [`RB-${ym}-%`])
  return `RB-${ym}-${String((Number(r.n) || 0) + 1).padStart(3, '0')}`
}

export async function saveProjection(id: number | null, v: ReturnType<typeof readProjection>, userId: number) {
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    const head = { nama: v.nama, tanggal_mulai: v.tanggal_mulai, tanggal_selesai: v.tanggal_selesai, catatan: v.catatan, harga_bahan: JSON.stringify(v.prices), updated_by: userId }
    let projectionId = id
    let kode = ''
    if (id) {
      const [res] = await conn.query<ResultSetHeader>('UPDATE material_projections SET ? WHERE id = ?', [head, id])
      if (!res.affectedRows) fail(404, 'Riset / proyeksi tidak ditemukan.')
      await conn.query('DELETE FROM material_projection_items WHERE projection_id = ?', [id])
    } else {
      kode = await nextKode()
      const [res] = await conn.query<ResultSetHeader>('INSERT INTO material_projections SET ?', [{ ...head, kode, created_by: userId }])
      projectionId = res.insertId
    }
    if (v.items.length) {
      await conn.query(
        'INSERT INTO material_projection_items (projection_id, sort, item_accurate_id, nama, satuan, quantity, harga_jual, berat, waste, komposisi, bom_number, catatan) VALUES ?',
        [v.items.map((it, i) => [projectionId, i + 1, it.item_accurate_id, it.nama, it.satuan, it.quantity, it.harga_jual, it.berat, it.waste, JSON.stringify(it.komposisi), it.bom_number, it.catatan])],
      )
    }
    await conn.commit()
    return { id: projectionId!, kode }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

// Pilihan bahan untuk komposisi: biji plastik & bahan yang dipakai di BOM Accurate, dengan harga terkini
export async function searchMaterials(q: string) {
  const like = `%${q}%`
  const [rows] = await db.query<Row[]>(
    `SELECT i.accurate_id, i.name, i.category,
       (SELECT COUNT(DISTINCT m.bom_accurate_id) FROM accurate_bom_materials m WHERE m.item_accurate_id = i.accurate_id) AS dipakai
     FROM accurate_items i
     WHERE i.suspended = 0 AND (i.category LIKE '%BIJI%' OR EXISTS (SELECT 1 FROM accurate_bom_materials m WHERE m.item_accurate_id = i.accurate_id))
       ${q ? 'AND (i.name LIKE ? OR i.item_no LIKE ?)' : ''}
     ORDER BY dipakai DESC, i.name LIMIT 40`,
    q ? [like, like] : [],
  )
  const info = await materialInfo(rows.map((r) => Number(r.accurate_id)))
  return rows.map((r) => {
    const i = info.get(Number(r.accurate_id))
    return {
      item_accurate_id: Number(r.accurate_id), key: materialKey(Number(r.accurate_id), String(r.name)), name: String(r.name), item_no: i?.item_no ?? null, unit: i?.unit ?? 'kg',
      jenis: materialJenis(String(r.name), (r.category as string) ?? null), dipakai: Number(r.dipakai) || 0, stok: i?.stok ?? null,
      harga: i?.acuan ?? i?.rata ?? i?.po ?? null, harga_sumber: i?.acuan !== null && i?.acuan !== undefined ? 'Harga acuan' : i?.rata !== null && i?.rata !== undefined ? 'Rata-rata Accurate' : i?.po !== null && i?.po !== undefined ? 'PO terakhir' : null,
      harga_rata: i?.rata ?? null, harga_po: i?.po ?? null,
    }
  })
}

// Komposisi dari BOM Accurate terbaru sebuah produk: berat bahan per satuan + % per bahan + harga jual terakhir
export async function bomComposition(itemId: number) {
  const [[bom]] = await db.query<Row[]>(
    'SELECT accurate_id, number, quantity, unit FROM accurate_boms WHERE item_accurate_id = ? AND suspended = 0 ORDER BY trans_date DESC, accurate_id DESC LIMIT 1',
    [itemId],
  )
  const [[sale]] = await db.query<Row[]>(
    `SELECT soi.unit_price FROM accurate_sales_order_items soi JOIN accurate_sales_orders so ON so.accurate_id = soi.so_accurate_id
     WHERE soi.item_accurate_id = ? AND soi.unit_price > 0 ORDER BY so.trans_date DESC, so.accurate_id DESC LIMIT 1`,
    [itemId],
  )
  if (!bom) return { bom: null, harga_jual: num(sale?.unit_price) }
  const [mats] = await db.query<Row[]>('SELECT item_accurate_id, item_name, quantity, unit FROM accurate_bom_materials WHERE bom_accurate_id = ? ORDER BY seq, line_id', [bom.accurate_id])
  const total = mats.reduce((a, m) => a + (Number(m.quantity) || 0), 0)
  const info = await materialInfo(mats.map((m) => num(m.item_accurate_id)).filter((x): x is number => !!x))
  return {
    harga_jual: num(sale?.unit_price),
    bom: {
      number: (bom.number as string) ?? null, unit: (bom.unit as string) ?? null,
      // BOM Accurate biasanya sudah termasuk waste (mis. 0,63 + 0,315 + 0,053 + 0,053 = 1,051 kg per kg) -> waste 0%
      berat: total / (Number(bom.quantity) || 1),
      komposisi: mats.map((m) => {
        const id = num(m.item_accurate_id)
        const i = id ? info.get(id) : undefined
        const name = i?.name ?? String(m.item_name ?? '(tanpa nama)')
        return {
          key: materialKey(id, name), item_accurate_id: id, name, persen: total ? Math.round(((Number(m.quantity) || 0) / total) * 10000) / 100 : 0,
          unit: i?.unit ?? (m.unit as string) ?? 'kg', harga: i?.acuan ?? i?.rata ?? i?.po ?? null,
          harga_sumber: i?.acuan !== null && i?.acuan !== undefined ? 'Harga acuan' : i?.rata !== null && i?.rata !== undefined ? 'Rata-rata Accurate' : i?.po !== null && i?.po !== undefined ? 'PO terakhir' : null,
        }
      }),
    },
  }
}

export { calcProjection }
