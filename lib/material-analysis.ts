import type { RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageProduction, PRODUCTION_SO_MAX_AGE_DAYS } from '@/lib/production'
import type { UserProfile } from '@/lib/users'

// Analisis Bahan Baku: dari daftar produksi (rencana / realisasi MP / pesanan) dihitung kebutuhan setiap bahan
// lewat formula produksi (BOM) Accurate, nilainya (Rupiah), HPP bahan per produk, nilai jual, dan GPF (laba kotor
// = nilai jual - HPP bahan). Sama seperti hitungan Excel "Proyeksi Produksi" (komposisi HD/HD KW/PE/Kalsium x harga),
// tetapi komposisi diambil dari BOM Accurate dan harga dari Accurate / harga acuan yang diisi di SIMPAP.

export type Sumber = 'rencana' | 'realisasi' | 'pesanan'
export type HargaBasis = 'rata' | 'po'
export const SUMBER_LABEL: Record<Sumber, string> = { rencana: 'Rencana produksi', realisasi: 'Realisasi produksi (MP Accurate)', pesanan: 'Pesanan terbuka (SO Accurate)' }
export const PPN = 0.11

// Ubah harga acuan bahan: PPIC / GM / Kepala Produksi / Purchasing / admin
export const canEditMaterialPrice = (user: UserProfile) => canManageProduction(user) || user.role.isAdmin || user.division.code === 'purchasing'

type Row = RowDataPacket & Record<string, unknown>
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))
const sameUnit = (a: string | null, b: string | null) => !a || !b || a.trim().toLowerCase() === b.trim().toLowerCase()

type Line = {
  tanggal: string | null; item_accurate_id: number | null; item_no: string | null; item_name: string; customer: string | null; ref: string | null
  quantity: number; unit: string | null; sale_price: number | null; bom_id: number | null
}

// ---- Klasifikasi bahan ----
// Bahan baku = biji plastik (HD/PP/PE, ori/KW/recycle) & kalsium; selain itu bahan pendukung (tinta, mika, solven, dll.)
const BAKU = /biji|\b(hd|hdpe|pe|ldpe|lldpe|pp)\b|kalsium|calsium|caco|reycle|recycle|daur ulang|masterbatch|etilinas|polytam|elpro/i
export function materialJenis(name: string, category: string | null) {
  const n = name.toLowerCase()
  if (/kalsium|calsium|caco/.test(n)) return 'Kalsium'
  const kw = /\bkw\b/.test(n) ? ' KW' : /reycle|recycle|daur ulang/.test(n) ? ' Recycle' : ''
  if (/\b(hd|hdpe)\b/.test(n)) return `HD${kw}`
  if (/\bpp\b|polytam|elpro/.test(n)) return `PP${kw}`
  if (/\b(pe|ldpe|lldpe)\b|etilinas pe/.test(n)) return `PE${kw}`
  return BAKU.test(n) || /biji/i.test(category ?? '') ? 'Bahan baku lain' : 'Bahan pendukung'
}
const isBaku = (jenis: string) => jenis !== 'Bahan pendukung'

// ---- Sumber data produksi ----
async function loadLines(sumber: Sumber, from: string, to: string): Promise<Line[]> {
  if (sumber === 'rencana') {
    const [rows] = await db.query<Row[]>(
      `SELECT DATE_FORMAT(tanggal, '%Y-%m-%d') AS tanggal, item_accurate_id, item_no, item_name, customer_name, so_number, quantity, unit, unit_price
       FROM production_plan_entries WHERE tanggal BETWEEN ? AND ? ORDER BY tanggal, shift, id`,
      [from, to],
    )
    return rows.map((r) => ({
      tanggal: r.tanggal as string, item_accurate_id: num(r.item_accurate_id), item_no: (r.item_no as string) ?? null, item_name: String(r.item_name),
      customer: (r.customer_name as string) ?? null, ref: (r.so_number as string) ?? 'Rencana', quantity: Number(r.quantity), unit: (r.unit as string) ?? null,
      sale_price: num(r.unit_price), bom_id: null,
    }))
  }
  if (sumber === 'realisasi') {
    const [rows] = await db.query<Row[]>(
      `SELECT DATE_FORMAT(COALESCE(l.start_date, mo.trans_date), '%Y-%m-%d') AS tanggal, l.item_accurate_id, l.item_no, l.item_name, mo.number, l.quantity, l.unit, l.bom_accurate_id
       FROM accurate_manufacture_order_items l JOIN accurate_manufacture_orders mo ON mo.accurate_id = l.mo_accurate_id
       WHERE COALESCE(l.start_date, mo.trans_date) BETWEEN ? AND ? AND l.quantity > 0 ORDER BY tanggal, mo.accurate_id, l.seq`,
      [from, to],
    )
    return rows.map((r) => ({
      tanggal: r.tanggal as string, item_accurate_id: num(r.item_accurate_id), item_no: (r.item_no as string) ?? null, item_name: String(r.item_name ?? '(tanpa nama)'),
      customer: null, ref: (r.number as string) ?? null, quantity: Number(r.quantity), unit: (r.unit as string) ?? null, sale_price: null, bom_id: num(r.bom_accurate_id),
    }))
  }
  const [rows] = await db.query<Row[]>(
    `SELECT DATE_FORMAT(j.due_date, '%Y-%m-%d') AS tanggal, j.item_accurate_id, i.item_no, j.item_name, c.name AS customer, j.so_number, j.quantity, j.unit, soi.unit_price
     FROM production_jobs j
     JOIN accurate_sales_orders so ON so.accurate_id = j.so_accurate_id
     LEFT JOIN accurate_sales_order_items soi ON soi.so_accurate_id = j.so_accurate_id AND soi.line_id = j.line_id
     LEFT JOIN accurate_items i ON i.accurate_id = j.item_accurate_id
     LEFT JOIN customers c ON c.id = j.customer_id
     WHERE so.status <> 'Terproses' AND j.status NOT IN ('selesai', 'batal') AND so.trans_date >= CURDATE() - INTERVAL ${Number(PRODUCTION_SO_MAX_AGE_DAYS)} DAY
       AND j.due_date BETWEEN ? AND ? AND j.quantity > 0
     ORDER BY j.due_date, j.id`,
    [from, to],
  )
  return rows.map((r) => ({
    tanggal: r.tanggal as string, item_accurate_id: num(r.item_accurate_id), item_no: (r.item_no as string) ?? null, item_name: String(r.item_name),
    customer: (r.customer as string) ?? null, ref: (r.so_number as string) ?? null, quantity: Number(r.quantity), unit: (r.unit as string) ?? null,
    sale_price: num(r.unit_price), bom_id: null,
  }))
}

// Harga jual terakhir per barang dari pesanan Accurate (untuk realisasi MP yang tidak punya harga)
async function lastSalePrices(itemIds: number[]) {
  const out = new Map<number, number>()
  if (!itemIds.length) return out
  const [rows] = await db.query<Row[]>(
    `SELECT soi.item_accurate_id, soi.unit_price FROM accurate_sales_order_items soi JOIN accurate_sales_orders so ON so.accurate_id = soi.so_accurate_id
     WHERE soi.item_accurate_id IN (?) AND soi.unit_price > 0 ORDER BY so.trans_date DESC, so.accurate_id DESC`,
    [itemIds],
  )
  for (const r of rows) if (!out.has(Number(r.item_accurate_id))) out.set(Number(r.item_accurate_id), Number(r.unit_price))
  return out
}

type Bom = { id: number; number: string | null; quantity: number; unit: string | null; materials: { item_accurate_id: number | null; item_no: string | null; name: string; quantity: number; unit: string | null }[] }

// BOM: yang tertulis di MP, kalau tidak ada BOM terbaru (tidak nonaktif) untuk barang tersebut
async function loadBoms(lines: Line[]) {
  const itemIds = [...new Set(lines.filter((l) => !l.bom_id && l.item_accurate_id).map((l) => l.item_accurate_id!))]
  const latest = new Map<number, number>()
  if (itemIds.length) {
    const [rows] = await db.query<Row[]>(
      'SELECT accurate_id, item_accurate_id FROM accurate_boms WHERE item_accurate_id IN (?) AND suspended = 0 ORDER BY trans_date DESC, accurate_id DESC',
      [itemIds],
    )
    for (const r of rows) if (!latest.has(Number(r.item_accurate_id))) latest.set(Number(r.item_accurate_id), Number(r.accurate_id))
  }
  const ids = [...new Set([...lines.map((l) => l.bom_id).filter((x): x is number => !!x), ...latest.values()])]
  const boms = new Map<number, Bom>()
  if (ids.length) {
    const [[heads], [mats]] = await Promise.all([
      db.query<Row[]>('SELECT accurate_id, number, quantity, unit FROM accurate_boms WHERE accurate_id IN (?)', [ids]),
      db.query<Row[]>('SELECT bom_accurate_id, item_accurate_id, item_no, item_name, quantity, unit FROM accurate_bom_materials WHERE bom_accurate_id IN (?) ORDER BY bom_accurate_id, seq, line_id', [ids]),
    ])
    for (const h of heads) boms.set(Number(h.accurate_id), { id: Number(h.accurate_id), number: (h.number as string) ?? null, quantity: Number(h.quantity) || 1, unit: (h.unit as string) ?? null, materials: [] })
    for (const m of mats) {
      boms.get(Number(m.bom_accurate_id))?.materials.push({
        item_accurate_id: num(m.item_accurate_id), item_no: (m.item_no as string) ?? null, name: String(m.item_name ?? '(tanpa nama)'), quantity: Number(m.quantity) || 0, unit: (m.unit as string) ?? null,
      })
    }
  }
  return { boms, bomFor: (l: Line) => boms.get(l.bom_id ?? (l.item_accurate_id ? latest.get(l.item_accurate_id) ?? -1 : -1)) ?? null }
}

// Harga bahan: harga acuan SIMPAP > (harga pokok rata-rata Accurate | harga beli terakhir PO) [+ PPN 11%]
async function materialInfo(ids: number[]) {
  const info = new Map<number, { item_no: string | null; name: string; unit: string | null; category: string | null; stok: number | null; rata: number | null; po: number | null; po_tanggal: string | null; acuan: number | null; acuan_catatan: string | null; acuan_at: string | null }>()
  if (!ids.length) return info
  const [[items], [pos], [overrides]] = await Promise.all([
    db.query<Row[]>('SELECT accurate_id, item_no, name, unit, category, quantity_on_hand, NULLIF(unit_cost, 0) AS unit_cost FROM accurate_items WHERE accurate_id IN (?)', [ids]),
    db.query<Row[]>(
      `SELECT poi.item_accurate_id, poi.unit_price, DATE_FORMAT(po.trans_date, '%Y-%m-%d') AS tanggal FROM accurate_purchase_order_items poi
       JOIN accurate_purchase_orders po ON po.accurate_id = poi.po_accurate_id
       WHERE poi.item_accurate_id IN (?) AND poi.unit_price > 0 ORDER BY po.trans_date DESC, po.accurate_id DESC`,
      [ids],
    ),
    db.query<Row[]>("SELECT item_accurate_id, harga, catatan, DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i') AS updated_at FROM production_material_prices WHERE item_accurate_id IN (?)", [ids]),
  ])
  const po = new Map<number, Row>()
  for (const r of pos) if (!po.has(Number(r.item_accurate_id))) po.set(Number(r.item_accurate_id), r)
  const ov = new Map(overrides.map((r) => [Number(r.item_accurate_id), r]))
  for (const i of items) {
    const id = Number(i.accurate_id)
    info.set(id, {
      item_no: (i.item_no as string) ?? null, name: String(i.name), unit: (i.unit as string) ?? null, category: (i.category as string) ?? null,
      stok: num(i.quantity_on_hand), rata: num(i.unit_cost), po: num(po.get(id)?.unit_price), po_tanggal: (po.get(id)?.tanggal as string) ?? null,
      acuan: num(ov.get(id)?.harga), acuan_catatan: (ov.get(id)?.catatan as string) ?? null, acuan_at: (ov.get(id)?.updated_at as string) ?? null,
    })
  }
  return info
}

export type AnalysisOptions = { sumber: Sumber; from: string; to: string; harga: HargaBasis; ppn: boolean }

export function readOptions(params: URLSearchParams): AnalysisOptions {
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
  const date = (v: string | null, fallback: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : fallback)
  const sumber = (['rencana', 'realisasi', 'pesanan'] as const).find((s) => s === params.get('sumber')) ?? 'realisasi'
  const from = date(params.get('from'), `${today.slice(0, 7)}-01`)
  const to = date(params.get('to'), today)
  if (from > to) fail(400, 'Tanggal awal harus sebelum tanggal akhir.')
  if ((Date.parse(to) - Date.parse(from)) / 864e5 > 400) fail(400, 'Rentang analisis maksimal 400 hari.')
  return { sumber, from, to, harga: params.get('harga') === 'po' ? 'po' : 'rata', ppn: params.get('ppn') === '1' }
}

export async function analyzeMaterials(o: AnalysisOptions) {
  const lines = await loadLines(o.sumber, o.from, o.to)
  const { bomFor } = await loadBoms(lines)
  const sale = o.sumber === 'realisasi' ? await lastSalePrices([...new Set(lines.map((l) => l.item_accurate_id).filter((x): x is number => !!x))]) : new Map<number, number>()
  const matIds = new Set<number>()
  for (const l of lines) for (const m of bomFor(l)?.materials ?? []) if (m.item_accurate_id) matIds.add(m.item_accurate_id)
  const info = await materialInfo([...matIds])

  const priceOf = (id: number | null) => {
    const i = id ? info.get(id) : undefined
    if (!i) return { harga: null as number | null, sumber: null as string | null }
    if (i.acuan !== null) return { harga: i.acuan, sumber: 'acuan' }
    const base = o.harga === 'po' ? i.po ?? i.rata : i.rata ?? i.po
    const src = base === null ? null : o.harga === 'po' ? (i.po !== null ? 'po' : 'rata') : i.rata !== null ? 'rata' : 'po'
    return { harga: base === null ? null : base * (o.ppn ? 1 + PPN : 1), sumber: src }
  }

  type MatAgg = { id: string; item_accurate_id: number | null; item_no: string | null; name: string; unit: string | null; jenis: string; kebutuhan: number; nilai: number; produk: Set<string> }
  type ProdAgg = {
    key: string; item_accurate_id: number | null; item_no: string | null; name: string; unit: string | null; jenis: string; quantity: number; kg: number; baris: number
    hpp: number; nilai: number | null; nilai_lengkap: boolean; bom_number: string | null; komposisi: { name: string; jenis: string; per_unit: number; harga: number | null }[]; bom_qty: number; bom_unit: string | null
    masalah: Set<string>; refs: Set<string>; customers: Set<string>
  }
  const mats = new Map<string, MatAgg>()
  const prods = new Map<string, ProdAgg>()
  const days = new Map<string, { kg: number; hpp: number; nilai: number }>()
  const issues = { tanpa_bom: 0, satuan_beda: 0, tanpa_harga_bahan: 0, tanpa_harga_jual: 0 }

  for (const l of lines) {
    const bom = bomFor(l)
    const key = l.item_accurate_id ? `i${l.item_accurate_id}` : `n${l.item_name}`
    const salePrice = l.sale_price ?? (l.item_accurate_id ? sale.get(l.item_accurate_id) ?? null : null)
    let p = prods.get(key)
    if (!p) {
      const jenisBom = bom?.materials.slice().sort((a, b) => b.quantity - a.quantity)[0]
      p = {
        key, item_accurate_id: l.item_accurate_id, item_no: l.item_no, name: l.item_name, unit: l.unit, jenis: jenisBom ? materialJenis(jenisBom.name, null).replace(/ (KW|Recycle)$/, '') : '—',
        quantity: 0, kg: 0, baris: 0, hpp: 0, nilai: 0, nilai_lengkap: true, bom_number: bom?.number ?? null, bom_qty: bom?.quantity ?? 1, bom_unit: bom?.unit ?? null,
        komposisi: (bom?.materials ?? []).map((m) => ({ name: m.name, jenis: materialJenis(m.name, info.get(m.item_accurate_id ?? -1)?.category ?? null), per_unit: m.quantity / (bom?.quantity || 1), harga: priceOf(m.item_accurate_id).harga })),
        masalah: new Set(), refs: new Set(), customers: new Set(),
      }
      prods.set(key, p)
    }
    p.quantity += l.quantity
    p.baris++
    if (l.ref) p.refs.add(l.ref)
    if (l.customer) p.customers.add(l.customer)
    let lineHpp = 0
    let lineKg = 0
    if (!bom || !bom.materials.length) { p.masalah.add('tanpa_bom'); issues.tanpa_bom++ }
    else if (!sameUnit(bom.unit, l.unit)) { p.masalah.add('satuan_beda'); issues.satuan_beda++ }
    else {
      const factor = l.quantity / (bom.quantity || 1)
      for (const m of bom.materials) {
        const need = m.quantity * factor
        const { harga } = priceOf(m.item_accurate_id)
        if (harga === null) { p.masalah.add('tanpa_harga_bahan'); issues.tanpa_harga_bahan++ }
        const cost = need * (harga ?? 0)
        lineHpp += cost
        if (!m.unit || /^kg$/i.test(m.unit)) lineKg += need
        const mk = m.item_accurate_id ? `m${m.item_accurate_id}` : `n${m.name}`
        const meta = m.item_accurate_id ? info.get(m.item_accurate_id) : undefined
        const agg = mats.get(mk) ?? { id: mk, item_accurate_id: m.item_accurate_id, item_no: meta?.item_no ?? m.item_no, name: meta?.name ?? m.name, unit: meta?.unit ?? m.unit, jenis: materialJenis(meta?.name ?? m.name, meta?.category ?? null), kebutuhan: 0, nilai: 0, produk: new Set<string>() }
        agg.kebutuhan += need
        agg.nilai += cost
        agg.produk.add(key)
        mats.set(mk, agg)
      }
    }
    const kg = l.unit && /^kg$/i.test(l.unit) ? l.quantity : lineKg
    p.kg += kg
    p.hpp += lineHpp
    const lineNilai = salePrice === null ? null : l.quantity * salePrice
    if (lineNilai === null) { p.nilai_lengkap = false; issues.tanpa_harga_jual++ } else p.nilai = (p.nilai ?? 0) + lineNilai
    const d = l.tanggal ?? 'tanpa tanggal'
    const day = days.get(d) ?? { kg: 0, hpp: 0, nilai: 0 }
    day.kg += kg
    day.hpp += lineHpp
    day.nilai += lineNilai ?? 0
    days.set(d, day)
  }

  const materials = [...mats.values()].map((m) => {
    const i = m.item_accurate_id ? info.get(m.item_accurate_id) : undefined
    const pr = priceOf(m.item_accurate_id)
    return {
      id: m.id, item_accurate_id: m.item_accurate_id, item_no: m.item_no, name: m.name, unit: m.unit, jenis: m.jenis, kelompok: isBaku(m.jenis) ? 'baku' : 'pendukung',
      kebutuhan: m.kebutuhan, harga: pr.harga, harga_sumber: pr.sumber, nilai: m.nilai, produk: m.produk.size,
      stok: i?.stok ?? null, kurang: i?.stok === null || i?.stok === undefined ? null : Math.max(0, m.kebutuhan - Math.max(0, i.stok)),
      harga_rata: i?.rata ?? null, harga_po: i?.po ?? null, harga_po_tanggal: i?.po_tanggal ?? null,
      acuan: i?.acuan ?? null, acuan_catatan: i?.acuan_catatan ?? null, acuan_at: i?.acuan_at ?? null,
    }
  }).sort((a, b) => b.nilai - a.nilai || b.kebutuhan - a.kebutuhan)

  const products = [...prods.values()].map((p) => {
    const nilai = p.nilai_lengkap ? p.nilai : p.nilai || null
    return {
      key: p.key, item_accurate_id: p.item_accurate_id, item_no: p.item_no, name: p.name, unit: p.unit, jenis: p.jenis, quantity: p.quantity, kg: p.kg, baris: p.baris,
      bom_number: p.bom_number, bom_qty: p.bom_qty, bom_unit: p.bom_unit, komposisi: p.komposisi,
      hpp: p.hpp, hpp_per_unit: p.quantity ? p.hpp / p.quantity : null, hpp_per_kg: p.kg ? p.hpp / p.kg : null,
      nilai, harga_jual: nilai !== null && p.quantity ? nilai / p.quantity : null, nilai_lengkap: p.nilai_lengkap,
      gpf: nilai !== null && !p.masalah.has('tanpa_bom') && !p.masalah.has('satuan_beda') ? nilai - p.hpp : null,
      masalah: [...p.masalah], refs: [...p.refs].slice(0, 6), customers: [...p.customers].slice(0, 4),
    }
  }).map((p) => ({ ...p, margin: p.gpf !== null && p.nilai ? (p.gpf / p.nilai) * 100 : null }))
    .sort((a, b) => (b.nilai ?? b.hpp) - (a.nilai ?? a.hpp))

  // Ringkasan per jenis bahan (HD / HD KW / PE / PP / Kalsium / pendukung), seperti rekap bulanan di Excel
  const jenisMap = new Map<string, { jenis: string; kebutuhan: number; nilai: number; kelompok: string }>()
  for (const m of materials) {
    const j = jenisMap.get(m.jenis) ?? { jenis: m.jenis, kebutuhan: 0, nilai: 0, kelompok: m.kelompok }
    j.kebutuhan += m.unit && !/^kg$/i.test(m.unit) ? 0 : m.kebutuhan
    j.nilai += m.nilai
    jenisMap.set(m.jenis, j)
  }

  // Hanya produk yang HPP-nya lengkap & punya nilai jual yang masuk hitungan GPF
  const valid = products.filter((p) => p.gpf !== null)
  const hpp = products.reduce((a, p) => a + p.hpp, 0)
  const nilai = products.reduce((a, p) => a + (p.nilai ?? 0), 0)
  const gpf = valid.reduce((a, p) => a + (p.gpf ?? 0), 0)
  const nilaiValid = valid.reduce((a, p) => a + (p.nilai ?? 0), 0)
  const kg = products.reduce((a, p) => a + p.kg, 0)
  const bakuKg = materials.filter((m) => m.kelompok === 'baku' && (!m.unit || /^kg$/i.test(m.unit))).reduce((a, m) => a + m.kebutuhan, 0)

  return {
    options: o,
    totals: {
      baris: lines.length, produk: products.length, bahan: materials.length, produksi_kg: kg,
      bahan_baku_kg: bakuKg, nilai_bahan_baku: materials.filter((m) => m.kelompok === 'baku').reduce((a, m) => a + m.nilai, 0),
      nilai_bahan_pendukung: materials.filter((m) => m.kelompok === 'pendukung').reduce((a, m) => a + m.nilai, 0),
      hpp, nilai, gpf, margin: nilaiValid ? (gpf / nilaiValid) * 100 : null, hpp_per_kg: kg ? hpp / kg : null,
      kurang: materials.filter((m) => (m.kurang ?? 0) > 0).length,
    },
    issues,
    materials,
    products,
    jenis: [...jenisMap.values()].sort((a, b) => b.nilai - a.nilai),
    days: [...days.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([tanggal, d]) => ({ tanggal, ...d })),
  }
}

// Simpan / hapus harga acuan satu bahan (harga null = kembali pakai harga Accurate)
export async function saveMaterialPrice(body: Record<string, unknown>, userId: number) {
  const id = Number(body.item_accurate_id)
  if (!Number.isInteger(id) || id <= 0) fail(400, 'Bahan tidak valid.')
  const [[item]] = await db.query<Row[]>('SELECT accurate_id, name FROM accurate_items WHERE accurate_id = ?', [id])
  if (!item) fail(404, 'Bahan tidak ditemukan di data Accurate.')
  const raw = body.harga
  if (raw === null || raw === undefined || raw === '') {
    await db.query('DELETE FROM production_material_prices WHERE item_accurate_id = ?', [id])
    return { name: String(item.name), harga: null }
  }
  const harga = Number(raw)
  if (!Number.isFinite(harga) || harga < 0 || harga > 1e12) fail(400, 'Harga tidak valid.')
  const catatan = str(body.catatan, 255) || null
  await db.query(
    'INSERT INTO production_material_prices (item_accurate_id, harga, catatan, updated_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE harga = VALUES(harga), catatan = VALUES(catatan), updated_by = VALUES(updated_by)',
    [id, harga, catatan, userId],
  )
  return { name: String(item.name), harga }
}
