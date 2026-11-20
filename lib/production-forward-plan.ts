import type { RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageProduction, PRODUCTION_SO_MAX_AGE_DAYS } from '@/lib/production'
import { isLeadOf, type UserProfile } from '@/lib/users'

// Rencana Produksi ke depan (CRUD): tanggal + Shift 1/2/3 + produk + jumlah + nilai.
// Produk diambil dari pesanan Accurate yang belum terproses, atau langsung dari produk Accurate (barang "Diproduksi").
// Diatur PPIC / GM / Kepala Produksi; yang lain hanya melihat. Data Accurate tidak diubah.
export const SHIFTS = [1, 2, 3] as const
export const canPlanProduction = (user: UserProfile) => canManageProduction(user) || isLeadOf(user, 'produksi')

type Row = RowDataPacket & Record<string, unknown>
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export const todayWib = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)

// Pesanan yang masih harus diproduksi: SO belum terproses, job tidak selesai/batal, SO dibuat N hari terakhir
const OPEN = `so.status <> 'Terproses' AND j.status NOT IN ('selesai', 'batal') AND so.trans_date >= CURDATE() - INTERVAL ${Number(PRODUCTION_SO_MAX_AGE_DAYS)} DAY`
const JOB_SELECT = `SELECT j.id, j.so_number, DATE_FORMAT(so.trans_date, '%Y-%m-%d') AS so_date, DATE_FORMAT(j.due_date, '%Y-%m-%d') AS due_date,
    j.item_accurate_id, j.item_name, i.item_no, j.quantity, j.unit, j.prioritas, soi.unit_price, c.name AS customer
  FROM production_jobs j
  JOIN accurate_sales_orders so ON so.accurate_id = j.so_accurate_id
  LEFT JOIN accurate_sales_order_items soi ON soi.so_accurate_id = j.so_accurate_id AND soi.line_id = j.line_id
  LEFT JOIN accurate_items i ON i.accurate_id = j.item_accurate_id
  LEFT JOIN customers c ON c.id = j.customer_id`

export type Sumber = 'pesanan' | 'produk' | 'sample'
// Satuan pilihan di form (dropdown): satuan barang Accurate + yang umum dipakai
export const PLAN_UNITS = ['kg', 'Pcs', 'Lmbr', 'Roll', 'Pak', 'Bal', 'Rim', 'Lusin']
function readUnit(v: unknown) {
  const u = str(v, 40)
  return u || null
}
// Request sample yang masih perlu dibuat (belum selesai / dikirim / disetujui / batal), satu baris per produk sample
const SAMPLE_SELECT = `SELECT s.id, s.nomor, s.status, DATE_FORMAT(s.tenggat, '%Y-%m-%d') AS tenggat, DATE_FORMAT(s.jadwal_produksi, '%Y-%m-%d') AS jadwal_produksi,
    COALESCE(c.name, p.nama_usaha) AS customer, i.id AS item_id, COALESCE(i.nama_produk, s.nama_produk) AS nama,
    COALESCE(i.jumlah, s.jumlah) AS jumlah, CONCAT_WS(' · ', COALESCE(i.jenis, s.jenis), COALESCE(i.ukuran, s.ukuran), COALESCE(i.ketebalan, s.ketebalan), COALESCE(i.bahan, s.bahan), COALESCE(i.warna_cetak, s.warna_cetak)) AS spek
  FROM sample_requests s
  LEFT JOIN sample_request_items i ON i.sample_id = s.id
  LEFT JOIN prospects p ON p.id = s.prospect_id
  LEFT JOIN customers c ON c.id = s.customer_id`
export const SAMPLE_OPEN = "s.status IN ('diajukan', 'dijadwalkan', 'diproduksi', 'revisi')"

const serializeEntry = (e: Row) => {
  const quantity = Number(e.quantity)
  const price = num(e.unit_price)
  return {
    id: Number(e.id), tanggal: String(e.tanggal), shift: Number(e.shift), sumber: String(e.sumber) as Sumber, job_id: num(e.job_id),
    sample_id: num(e.sample_id), sample_item_id: num(e.sample_item_id),
    item_accurate_id: num(e.item_accurate_id), item_no: (e.item_no as string) ?? null, item_name: String(e.item_name),
    customer_name: (e.customer_name as string) ?? null, so_number: (e.so_number as string) ?? null, due_date: (e.due_date as string) ?? null,
    quantity, unit: (e.unit as string) ?? null, unit_price: price, nilai: price === null ? null : quantity * price, catatan: (e.catatan as string) || null,
    capacity_id: num(e.capacity_id), mesin: (e.mesin as string) ?? null,
  }
}

// Data halaman: rencana mulai hari ini + pesanan (tanggal kirim hari ini / ke depan) beserta jumlah yang sudah direncanakan
export async function loadForwardPlan() {
  const today = todayWib()
  const [[entries], [jobs]] = await Promise.all([
    db.query<Row[]>(
      `SELECT e.*, DATE_FORMAT(e.tanggal, '%Y-%m-%d') AS tanggal, DATE_FORMAT(j.due_date, '%Y-%m-%d') AS due_date, ${MESIN_SQL} AS mesin
       FROM production_plan_entries e LEFT JOIN production_jobs j ON j.id = e.job_id LEFT JOIN production_capacities m ON m.id = e.capacity_id
       WHERE e.tanggal >= ? ORDER BY e.tanggal, e.shift, e.id LIMIT 3000`,
      [today],
    ),
    db.query<Row[]>(
      `${JOB_SELECT}
       WHERE ${OPEN} AND (j.due_date IS NULL OR j.due_date >= ? OR EXISTS (SELECT 1 FROM production_plan_entries f WHERE f.job_id = j.id AND f.tanggal >= ?))
       ORDER BY j.due_date IS NULL, j.due_date, j.prioritas = 'tinggi' DESC, j.id LIMIT 1000`,
      [today, today],
    ),
  ])
  const ids = jobs.map((j) => Number(j.id))
  const [planned] = ids.length
    ? await db.query<Row[]>('SELECT job_id, SUM(quantity) AS qty FROM production_plan_entries WHERE job_id IN (?) GROUP BY job_id', [ids])
    : [[] as Row[]]
  const plannedBy = new Map(planned.map((p) => [Number(p.job_id), Number(p.qty)]))
  // Request sample yang masih perlu dibuat + jumlah yang sudah direncanakan per produk sample
  const [samples] = await db.query<Row[]>(`${SAMPLE_SELECT} WHERE ${SAMPLE_OPEN} ORDER BY s.tenggat IS NULL, s.tenggat, s.id, i.sort_order, i.id LIMIT 500`)
  const [samplePlanned] = await db.query<Row[]>('SELECT sample_id, sample_item_id, SUM(quantity) AS qty, COUNT(*) AS n FROM production_plan_entries WHERE sample_id IS NOT NULL GROUP BY sample_id, sample_item_id')
  const spKey = (sid: unknown, iid: unknown) => `${Number(sid)}:${iid === null || iid === undefined ? 0 : Number(iid)}`
  const spBy = new Map(samplePlanned.map((r) => [spKey(r.sample_id, r.sample_item_id), { qty: Number(r.qty), n: Number(r.n) }]))
  const [unitRows] = await db.query<Row[]>("SELECT DISTINCT unit FROM accurate_items WHERE unit IS NOT NULL AND unit <> '' LIMIT 50")
  // Satuan Accurate dulu (urutan), penulisan mengikuti PLAN_UNITS bila sama (roll -> Roll)
  const units = [...new Map([...unitRows.map((r) => String(r.unit)), ...PLAN_UNITS].map((u) => [u.toLowerCase(), u])).values()]
  // Daftar mesin dari menu Kapasitas Produksi (pilihan wajib di form)
  const [machines] = await db.query<Row[]>('SELECT id, mesin, jenis_plastik, jumlah_mesin, lebar_min_cm, lebar_maks_cm FROM production_capacities ORDER BY urut, id')
  return {
    today,
    units,
    samples: samples.map((s) => ({
      id: Number(s.id), item_id: num(s.item_id), nomor: (s.nomor as string) ?? null, status: String(s.status), tenggat: (s.tenggat as string) ?? null,
      jadwal_produksi: (s.jadwal_produksi as string) ?? null, customer: (s.customer as string) ?? null, nama: String(s.nama), jumlah: (s.jumlah as string) ?? null,
      spek: (s.spek as string) || null, terjadwal: spBy.get(spKey(s.id, s.item_id))?.qty ?? 0, rencana: spBy.get(spKey(s.id, s.item_id))?.n ?? 0,
    })),
    machines: machines.map((m) => ({ id: Number(m.id), mesin: String(m.mesin), jenis_plastik: String(m.jenis_plastik), jumlah_mesin: Number(m.jumlah_mesin), lebar_min_cm: num(m.lebar_min_cm), lebar_maks_cm: num(m.lebar_maks_cm) })),
    entries: entries.map(serializeEntry),
    jobs: jobs.map((j) => {
      const price = num(j.unit_price)
      const quantity = num(j.quantity) ?? 0
      return {
        id: Number(j.id), so_number: (j.so_number as string) ?? null, so_date: (j.so_date as string) ?? null, due_date: (j.due_date as string) ?? null,
        item_accurate_id: num(j.item_accurate_id), item_name: String(j.item_name), item_no: (j.item_no as string) ?? null, customer: (j.customer as string) ?? null,
        quantity, unit: (j.unit as string) ?? null, unit_price: price, nilai: price === null ? null : quantity * price, prioritas: String(j.prioritas),
        terjadwal: plannedBy.get(Number(j.id)) ?? 0,
      }
    }),
  }
}

// Cari produk Accurate (barang "Diproduksi"); harga bawaan = harga jual terakhir di pesanan, kalau belum ada harga pokok
export async function searchPlanProducts(q: string) {
  const like = `%${q}%`
  const [rows] = await db.query<Row[]>(
    `SELECT i.accurate_id, i.item_no, i.name, i.unit, NULLIF(i.unit_cost, 0) AS unit_cost,
       (SELECT soi.unit_price FROM accurate_sales_order_items soi JOIN accurate_sales_orders so ON so.accurate_id = soi.so_accurate_id
        WHERE soi.item_accurate_id = i.accurate_id AND soi.unit_price > 0 ORDER BY so.trans_date DESC, so.accurate_id DESC LIMIT 1) AS last_price
     FROM accurate_items i
     WHERE i.item_produced = 1 AND i.suspended = 0 ${q ? 'AND (i.name LIKE ? OR i.item_no LIKE ?)' : ''}
     ORDER BY i.name LIMIT 30`,
    q ? [like, like] : [],
  )
  return rows.map((r) => ({
    id: Number(r.accurate_id), item_no: (r.item_no as string) ?? null, name: String(r.name), unit: (r.unit as string) ?? null,
    price: num(r.last_price) ?? num(r.unit_cost), price_source: r.last_price !== null ? 'harga jual terakhir' : r.unit_cost !== null ? 'harga pokok' : null,
  }))
}

type EntryInput = {
  tanggal: string; shift: number; quantity: number; sumber: Sumber; job_id: number | null; sample_id: number | null; sample_item_id: number | null; item_accurate_id: number | null
  item_no: string | null; item_name: string; customer_name: string | null; so_number: string | null; unit: string | null; unit_price: number | null; catatan: string | null
  capacity_id: number
}
// Nama mesin untuk tampilan: "2 Mesin Blow PP Kecil (PP)"
const MESIN_SQL = "CONCAT(IF(m.jumlah_mesin > 1, CONCAT(m.jumlah_mesin, ' '), ''), m.mesin, ' (', m.jenis_plastik, ')')"

const readDate = (v: unknown) => {
  const t = str(v, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || Number.isNaN(Date.parse(t))) fail(400, 'Isi tanggal rencana produksi.')
  return t
}
const readShift = (v: unknown, label = '') => {
  const s = Number(v)
  if (!SHIFTS.includes(s as 1)) fail(400, `${label}Pilih Shift 1, 2, atau 3.`)
  return s
}
const readQty = (v: unknown, label = '') => {
  const q = Number(v)
  if (!Number.isFinite(q) || q <= 0 || q > 1e12) fail(400, `${label}Jumlah harus lebih dari 0.`)
  return q
}

// Isian form -> data rencana. Produk & customer diambil dari pesanan / produk Accurate di server (bukan dari browser).
// rows: [{ shift, quantity }] untuk membuat beberapa shift sekaligus (hanya saat tambah).
export async function readEntry(body: Record<string, unknown>) {
  const sumber: Sumber = body.sumber === 'pesanan' ? 'pesanan' : body.sumber === 'sample' ? 'sample' : 'produk'
  const tanggal = readDate(body.tanggal)
  // Harga per satuan tidak diisi di form: otomatis harga jual pesanan / harga bawaan produk (untuk nilai rencana)
  let unitPrice: number | null = null
  // Mesin wajib, dari daftar Kapasitas Produksi
  const capacityId = Number(body.capacity_id)
  const [[machine]] = await db.query<Row[]>('SELECT id FROM production_capacities WHERE id = ?', [Number.isInteger(capacityId) ? capacityId : 0])
  if (!machine) fail(400, 'Pilih mesin (daftar mesin dari menu Kapasitas Produksi).')
  const unit = readUnit(body.unit)
  const base: Omit<EntryInput, 'tanggal' | 'shift' | 'quantity' | 'unit_price' | 'capacity_id'> = sumber === 'sample'
    ? await (async () => {
      // Pembuatan sample dari Request Sample (per produk sample bila request punya beberapa produk)
      const [[s]] = await db.query<Row[]>(`${SAMPLE_SELECT} WHERE s.id = ? AND (? = 0 OR i.id = ?) LIMIT 1`, [Number(body.sample_id) || 0, Number(body.sample_item_id) || 0, Number(body.sample_item_id) || 0])
      if (!s) fail(400, 'Pilih request sample yang akan dibuat.')
      return {
        sumber, job_id: null, sample_id: Number(s.id), sample_item_id: num(s.item_id), item_accurate_id: null, item_no: null, item_name: String(s.nama),
        customer_name: (s.customer as string) ?? null, so_number: (s.nomor as string) ?? null, unit: unit ?? 'Pcs', catatan: str(body.catatan, 255) || null,
      }
    })()
    : sumber === 'pesanan'
    ? await (async () => {
      const id = Number(body.job_id)
      const [[j]] = await db.query<Row[]>(`${JOB_SELECT} WHERE j.id = ?`, [Number.isInteger(id) ? id : 0])
      if (!j) fail(400, 'Pilih pesanan yang akan diproduksi.')
      if (unitPrice === null) unitPrice = num(j.unit_price)
      return {
        sumber, job_id: Number(j.id), sample_id: null, sample_item_id: null, item_accurate_id: num(j.item_accurate_id), item_no: (j.item_no as string) ?? null, item_name: String(j.item_name),
        customer_name: (j.customer as string) ?? null, so_number: (j.so_number as string) ?? null, unit: (j.unit as string) ?? null, catatan: str(body.catatan, 255) || null,
      }
    })()
    : await (async () => {
      const id = Number(body.item_accurate_id)
      const [[p]] = await db.query<Row[]>('SELECT accurate_id, item_no, name, unit FROM accurate_items WHERE accurate_id = ?', [Number.isInteger(id) ? id : 0])
      if (!p) fail(400, 'Pilih produk Accurate yang akan diproduksi.')
      if (unitPrice === null) unitPrice = (await searchPlanProducts(String(p.item_no ?? p.name))).find((x) => x.id === Number(p.accurate_id))?.price ?? null
      return {
        sumber, job_id: null, sample_id: null, sample_item_id: null, item_accurate_id: Number(p.accurate_id), item_no: (p.item_no as string) ?? null, item_name: String(p.name),
        customer_name: str(body.customer_name, 255) || null, so_number: null, unit: unit || (p.unit as string) || null, catatan: str(body.catatan, 255) || null,
      }
    })()
  const rows = Array.isArray(body.rows) && body.rows.length
    ? (body.rows as unknown[]).slice(0, 3).map((r, i) => {
      const x = (r ?? {}) as Record<string, unknown>
      return { shift: readShift(x.shift, `Baris ${i + 1}: `), quantity: readQty(x.quantity, `Baris ${i + 1}: `) }
    })
    : [{ shift: readShift(body.shift), quantity: readQty(body.quantity) }]
  if (new Set(rows.map((r) => r.shift)).size !== rows.length) fail(400, 'Setiap shift hanya boleh diisi sekali.')
  return rows.map((r): EntryInput => ({ ...base, tanggal, shift: r.shift, quantity: r.quantity, unit_price: unitPrice, capacity_id: capacityId }))
}

// Jadwal produksi request sample = tanggal rencana paling awal (status sample tetap diatur di menu Request Sample)
export async function refreshSampleSchedule(sampleIds: (number | null)[]) {
  for (const id of new Set(sampleIds.filter((x): x is number => !!x))) {
    await db.query('UPDATE sample_requests SET jadwal_produksi = (SELECT MIN(e.tanggal) FROM production_plan_entries e WHERE e.sample_id = ?) WHERE id = ?', [id, id])
  }
}

// Status pesanan ikut rencana: ada rencana = dijadwalkan, tidak ada = menunggu (yang sudah berjalan dibiarkan)
export async function refreshJobStatus(jobIds: (number | null)[], userId: number) {
  for (const id of new Set(jobIds.filter((x): x is number => !!x))) {
    await db.query(
      `UPDATE production_jobs SET status = IF(EXISTS (SELECT 1 FROM production_plan_entries e WHERE e.job_id = ?), 'dijadwalkan', 'menunggu'), updated_by = ?
       WHERE id = ? AND status IN ('menunggu', 'dijadwalkan')`,
      [id, userId, id],
    )
  }
}

export async function loadEntry(id: number) {
  const [[e]] = await db.query<Row[]>(`SELECT e.*, DATE_FORMAT(e.tanggal, '%Y-%m-%d') AS tanggal, ${MESIN_SQL} AS mesin FROM production_plan_entries e LEFT JOIN production_capacities m ON m.id = e.capacity_id WHERE e.id = ?`, [id])
  return e ? serializeEntry(e) : fail(404, 'Rencana produksi tidak ditemukan.')
}

export const entryLabel = (e: { tanggal: string; shift: number; item_name: string; quantity: number; unit: string | null }) =>
  `${e.tanggal} Shift ${e.shift} · ${e.item_name} ${e.quantity.toLocaleString('id-ID')}${e.unit ? ` ${e.unit}` : ''}`

export const entryColumns = (e: EntryInput) => ({
  tanggal: e.tanggal, shift: e.shift, sumber: e.sumber, job_id: e.job_id, sample_id: e.sample_id, sample_item_id: e.sample_item_id, item_accurate_id: e.item_accurate_id, item_no: e.item_no, item_name: e.item_name,
  customer_name: e.customer_name, so_number: e.so_number, quantity: e.quantity, unit: e.unit, unit_price: e.unit_price, catatan: e.catatan, capacity_id: e.capacity_id,
})
