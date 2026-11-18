// Kapasitas Produksi (dokumen "KAPASITAS PRODUKSI PAP – Non Mika"): kapasitas maksimal & efektif per mesin blow dan jenis plastik.
// Dipakai Marketing untuk menata order sesuai jenis plastik dan Produksi untuk pengaturan kerja & delivery.
import type { RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageProduction } from '@/lib/production'
import type { UserProfile } from '@/lib/users'

export function requireCapacity(user: UserProfile) {
  if (!user.menus.includes('kapasitas-produksi' as never)) fail(403, 'Anda tidak punya akses ke menu Kapasitas Produksi.')
}
// Diubah PPIC (kelola produksi), kepala Produksi, divisi Teknik (mesin & kapasitasnya), atau GM
export const canManageCapacity = (user: UserProfile) => canManageProduction(user) || (user.division.code === 'produksi' && user.role.code === 'lead') || user.division.code === 'teknik'

export type CapacityRow = {
  id: number; jenis_plastik: string; lebar_min_cm: number | null; lebar_maks_cm: number | null; kapasitas_maks_ton: number; efisiensi_pct: number; kapasitas_eff_ton: number
  mesin: string; jumlah_mesin: number; catatan: string | null; urut: number; updated_at: string; updated_name: string | null
}
export type CapacityInfo = { judul: string; tanggal: string | null; catatan: string; ttd: string[] }

const INFO_KEY = 'kapasitas.info'
const DEFAULT_INFO: CapacityInfo = { judul: 'KAPASITAS PRODUKSI PAP – Non Mika', tanggal: null, catatan: '', ttd: [] }
const round2 = (n: number) => Math.round(n * 100) / 100

export async function loadCapacities() {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT c.id, c.jenis_plastik, c.lebar_min_cm, c.lebar_maks_cm, c.kapasitas_maks_ton, c.efisiensi_pct, c.mesin, c.jumlah_mesin, c.catatan, c.urut, c.updated_at, u.name AS updated_name
     FROM production_capacities c LEFT JOIN users u ON u.id = c.updated_by ORDER BY c.urut, c.id`,
  )
  return rows.map((r): CapacityRow => {
    const maks = Number(r.kapasitas_maks_ton)
    const eff = Number(r.efisiensi_pct)
    return {
      id: r.id, jenis_plastik: r.jenis_plastik, lebar_min_cm: r.lebar_min_cm === null ? null : Number(r.lebar_min_cm), lebar_maks_cm: r.lebar_maks_cm === null ? null : Number(r.lebar_maks_cm), kapasitas_maks_ton: maks, efisiensi_pct: eff,
      kapasitas_eff_ton: round2((maks * eff) / 100), mesin: r.mesin, jumlah_mesin: Number(r.jumlah_mesin), catatan: r.catatan, urut: Number(r.urut),
      updated_at: r.updated_at, updated_name: r.updated_name,
    }
  })
}

// Total per jenis plastik + keseluruhan
export function capacityTotals(rows: CapacityRow[]) {
  const per = new Map<string, { jenis_plastik: string; maks: number; eff: number; mesin: number }>()
  for (const r of rows) {
    const cur = per.get(r.jenis_plastik) ?? { jenis_plastik: r.jenis_plastik, maks: 0, eff: 0, mesin: 0 }
    cur.maks = round2(cur.maks + r.kapasitas_maks_ton)
    cur.eff = round2(cur.eff + r.kapasitas_eff_ton)
    cur.mesin += r.jumlah_mesin
    per.set(r.jenis_plastik, cur)
  }
  return {
    maks: round2(rows.reduce((n, r) => n + r.kapasitas_maks_ton, 0)),
    eff: round2(rows.reduce((n, r) => n + r.kapasitas_eff_ton, 0)),
    mesin: rows.reduce((n, r) => n + r.jumlah_mesin, 0),
    per_jenis: [...per.values()],
  }
}

export async function loadCapacityInfo(): Promise<CapacityInfo> {
  const [[row]] = await db.query<(RowDataPacket & { value: string | null })[]>('SELECT value FROM app_settings WHERE `key` = ?', [INFO_KEY])
  try {
    return { ...DEFAULT_INFO, ...JSON.parse(row?.value ?? '{}') }
  } catch {
    return DEFAULT_INFO
  }
}

export async function saveCapacityInfo(body: Record<string, unknown>, userId: number) {
  const tanggal = str(body.tanggal, 10)
  const info: CapacityInfo = {
    judul: str(body.judul, 200) || DEFAULT_INFO.judul,
    tanggal: /^\d{4}-\d{2}-\d{2}$/.test(tanggal) ? tanggal : null,
    catatan: str(body.catatan, 2000),
    ttd: (Array.isArray(body.ttd) ? body.ttd : []).map((v) => str(v, 80)).filter(Boolean).slice(0, 5),
  }
  await db.query('INSERT INTO app_settings (`key`, value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)', [INFO_KEY, JSON.stringify(info), userId])
  return info
}

const decimal = (v: unknown, label: string, { min = 0, max = 1e6, required = false } = {}) => {
  if (v === null || v === undefined || v === '') return required ? fail(400, `${label} wajib diisi.`) : null
  const n = Number(String(v).replace(',', '.'))
  if (!Number.isFinite(n) || n < min || n > max) fail(400, `${label} tidak valid.`)
  return n
}

export function readCapacityInput(body: Record<string, unknown>) {
  const jenis = str(body.jenis_plastik, 60)
  const mesin = str(body.mesin, 255)
  if (!jenis) fail(400, 'Jenis plastik wajib diisi.')
  if (!mesin) fail(400, 'Nama mesin wajib diisi.')
  const lmin = decimal(body.lebar_min_cm, 'Lebar minimal', { max: 1000 })
  const lmaks = decimal(body.lebar_maks_cm, 'Lebar maksimal', { max: 1000 })
  if (lmin !== null && lmaks !== null && lmin > lmaks) fail(400, 'Lebar minimal tidak boleh lebih besar dari lebar maksimal.')
  return {
    jenis_plastik: jenis,
    lebar_min_cm: lmin,
    lebar_maks_cm: lmaks,
    kapasitas_maks_ton: decimal(body.kapasitas_maks_ton, 'Kapasitas maksimal', { required: true, max: 100000 }) as number,
    efisiensi_pct: decimal(body.efisiensi_pct ?? 70, 'Efisiensi', { required: true, min: 1, max: 100 }) as number,
    mesin,
    jumlah_mesin: Math.round(decimal(body.jumlah_mesin ?? 1, 'Jumlah mesin', { required: true, min: 1, max: 50 }) as number),
    catatan: str(body.catatan, 500) || null,
  }
}

// ---------- Kapasitas terpakai per bulan ----------
// Ton yang terpakai per mesin per bulan (diisi PPIC / Produksi / Teknik), dibandingkan dengan kapasitas efektif mesin itu.
export type UsageCell = { terpakai_ton: number; catatan: string | null; updated_name: string | null; updated_at: string }
export type UsageRow = { capacity_id: number; jenis_plastik: string; mesin: string; jumlah_mesin: number; kapasitas_eff_ton: number; bulan: Record<string, UsageCell> }

const PERIODE_RE = /^\d{4}-(0[1-9]|1[0-2])$/
export const validPeriode = (p: string) => PERIODE_RE.test(p)

export async function loadUsage(tahun: number, capacities?: CapacityRow[]) {
  const caps = capacities ?? (await loadCapacities())
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT x.capacity_id, x.periode, x.terpakai_ton, x.catatan, x.updated_at, u.name AS updated_name
     FROM production_capacity_usage x LEFT JOIN users u ON u.id = x.updated_by WHERE x.periode LIKE ?`,
    [`${tahun}-%`],
  )
  const items: UsageRow[] = caps.map((c) => ({ capacity_id: c.id, jenis_plastik: c.jenis_plastik, mesin: c.mesin, jumlah_mesin: c.jumlah_mesin, kapasitas_eff_ton: c.kapasitas_eff_ton, bulan: {} }))
  const byId = new Map(items.map((r) => [r.capacity_id, r]))
  for (const r of rows) {
    const row = byId.get(Number(r.capacity_id))
    if (row) row.bulan[r.periode] = { terpakai_ton: Number(r.terpakai_ton), catatan: r.catatan, updated_name: r.updated_name, updated_at: r.updated_at }
  }
  // Total per bulan: terpakai vs efektif seluruh mesin
  const eff = round2(caps.reduce((n, c) => n + c.kapasitas_eff_ton, 0))
  const bulan: Record<string, { terpakai: number; eff: number; pct: number | null; terisi: number }> = {}
  for (let m = 1; m <= 12; m++) {
    const p = `${tahun}-${String(m).padStart(2, '0')}`
    const filled = items.filter((r) => r.bulan[p])
    const terpakai = round2(filled.reduce((n, r) => n + r.bulan[p].terpakai_ton, 0))
    bulan[p] = { terpakai, eff, pct: filled.length && eff ? Math.round((terpakai / eff) * 1000) / 10 : null, terisi: filled.length }
  }
  return { tahun, items, total: bulan }
}

// Simpan satu bulan sekaligus: items [{ capacity_id, terpakai_ton, catatan }]; terpakai kosong = hapus isian mesin itu
export async function saveUsage(body: Record<string, unknown>, userId: number) {
  const periode = str(body.periode, 7)
  if (!validPeriode(periode)) fail(400, 'Periode tidak valid.')
  const list = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : fail(400, 'Isian kapasitas terpakai kosong.')
  const [capRows] = await db.query<RowDataPacket[]>('SELECT id FROM production_capacities')
  const ids = new Set(capRows.map((r) => Number(r.id)))
  let saved = 0
  let removed = 0
  for (const it of list.slice(0, 200)) {
    const id = Number(it.capacity_id)
    if (!ids.has(id)) fail(400, 'Mesin kapasitas tidak ditemukan.')
    const ton = decimal(it.terpakai_ton, 'Kapasitas terpakai', { max: 100000 })
    if (ton === null) {
      const [res] = await db.query<import('mysql2').ResultSetHeader>('DELETE FROM production_capacity_usage WHERE capacity_id = ? AND periode = ?', [id, periode])
      removed += res.affectedRows
      continue
    }
    await db.query(
      `INSERT INTO production_capacity_usage (capacity_id, periode, terpakai_ton, catatan, updated_by) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE terpakai_ton = VALUES(terpakai_ton), catatan = VALUES(catatan), updated_by = VALUES(updated_by)`,
      [id, periode, ton, str(it.catatan, 500) || null, userId],
    )
    saved++
  }
  return { periode, saved, removed }
}

export async function deleteUsage(periode: string) {
  if (!validPeriode(periode)) fail(400, 'Periode tidak valid.')
  const [res] = await db.query<import('mysql2').ResultSetHeader>('DELETE FROM production_capacity_usage WHERE periode = ?', [periode])
  return res.affectedRows
}
