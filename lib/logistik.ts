// Inventory & Logistik: ekspedisi (tarif & estimasi dari keterangan SO Accurate), pengiriman & surat jalan.
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { accurate, AccurateError, fromAccurateDate } from '@/lib/accurate'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'
import { KOTA_NAMES, KOTA_PROVINSI } from '@/lib/kota'
import { isManagement, type UserProfile } from '@/lib/users'

type Row = RowDataPacket & Record<string, unknown>
type Obj = Record<string, unknown>
export const LOGISTIK_MENUS = ['pengiriman', 'ekspedisi'] as const
export function requireLogistik(user: UserProfile, menu: (typeof LOGISTIK_MENUS)[number]) {
  if (!user.menus.includes(menu as never)) fail(403, 'Anda tidak punya akses ke menu ini.')
}
// Kelola pengiriman & ekspedisi: Inventory & Logistik, PPIC, management
export const canManageLogistik = (user: UserProfile) => isManagement(user) || ['inventory_logistik', 'ppic'].includes(user.division.code)

export const todayWib = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10)
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v)
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))

// ---------- Teks SO: "Pengiriman dengan SL CARGO Rp 1.000/kg estimasi 2-3 hari kerja" ----------
const GENERIC = /\b(CARGO|KARGO|EKSPEDISI|EXPEDISI|LOGISTIK|LOGISTICS?|EXPRESS|EKSPRES|PT\.?|CV\.?)\b/g
export const expeditionKey = (nama: string) => nama.toUpperCase().replace(GENERIC, ' ').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim() || nama.toUpperCase().trim()
const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(Sl|Sts|Psb|Jnt|Jne|Adex)\b/g, (w) => w.toUpperCase())

export function parseShipNote(text: string | null | undefined) {
  if (!text) return null
  const line = text.split(/\n/).find((l) => /(pengiriman|dikirim|kirim)\s+(dengan|via|pakai|lewat|menggunakan)/i.test(l))
  if (!line) return null
  const m = line.match(/(?:dengan|via|pakai|lewat|menggunakan)\s+(?:ekspedisi\s+)?(.+?)(?=\s+(?:rp|ongkir|ongkos|est\b|est\.|estimasi|\d|-\/\+)|\s*[,(:]|$)/i)
  const nama = m?.[1]?.replace(/\s+/g, ' ').trim()
  if (!nama || nama.length < 2 || /^(rp|est)/i.test(nama)) return null
  const tarif = line.match(/rp\.?\s*([\d.,]+)\s*(?:\/|per\s*)\s*kg/i)
  const est = line.match(/est(?:imasi)?\.?\s*(?:-\/\+\s*|±\s*)?(\d{1,2})(?:\s*(?:-|s\/d|sampai)\s*(\d{1,2}))?\s*hari/i)
  const tarifNum = tarif ? Number(tarif[1].replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.')) : null
  return {
    nama: titleCase(nama).slice(0, 120), key: expeditionKey(nama),
    tarif_per_kg: tarifNum && tarifNum > 0 && tarifNum < 100000 ? tarifNum : null,
    estimasi_min: est ? Number(est[1]) : null, estimasi_max: est ? Number(est[2] ?? est[1]) : null,
  }
}

const PROVINSI = ['Nanggroe Aceh Darussalam', 'Aceh', 'Sumatera Utara', 'Sumatera Barat', 'Sumatera Selatan', 'Riau', 'Kepulauan Riau', 'Jambi', 'Bengkulu', 'Lampung', 'Bangka Belitung',
  'DKI Jakarta', 'Jakarta', 'Jawa Barat', 'Banten', 'Jawa Tengah', 'Daerah Istimewa Yogyakarta', 'DI Yogyakarta', 'Yogyakarta', 'Jawa Timur', 'Bali', 'Nusa Tenggara Barat', 'Nusa Tenggara Timur', 'NTT', 'NTB',
  'Kalimantan Barat', 'Kalimantan Tengah', 'Kalimantan Selatan', 'Kalimantan Timur', 'Kalimantan Utara', 'Sulawesi Utara', 'Sulawesi Tengah', 'Sulawesi Selatan', 'Sulawesi Tenggara', 'Sulawesi Barat', 'Gorontalo',
  'Maluku Utara', 'Maluku', 'Papua Barat', 'Papua']
const PROV_NORMAL: Record<string, string> = { Aceh: 'Nanggroe Aceh Darussalam', Jakarta: 'DKI Jakarta', 'DI Yogyakarta': 'Daerah Istimewa Yogyakarta', Yogyakarta: 'Daerah Istimewa Yogyakarta', NTT: 'Nusa Tenggara Timur', NTB: 'Nusa Tenggara Barat' }
// Kota / kabupaten & provinsi dari alamat kirim (bila ada "DITERUSKAN KE", tujuan akhir yang dipakai)
export function parseDestination(address: string | null | undefined) {
  if (!address) return { kota: null, provinsi: null }
  const text = address.split(/diteruskan ke/i).at(-1)!.replace(/\s+/g, ' ')
  const provMatch = PROVINSI.find((p) => new RegExp(`\\b${p.replace(/ /g, '\\s+')}\\b`, 'i').test(text)) ?? null
  // 1) Nama kota yang dikenal (kemunculan terakhir di alamat = tujuan akhir)
  let best: { kota: string; at: number } | null = null
  for (const k of KOTA_NAMES) {
    const re = new RegExp(`\\b${k.replace(/ /g, '\\s*')}\\b`, 'gi')
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) if (!best || m.index > best.at || (m.index === best.at && k.length > best.kota.length)) best = { kota: k, at: m.index }
  }
  // 2) Pola "Kab. X" / "Kota X" untuk kota yang belum ada di daftar
  const kab = [...text.matchAll(/\b(?:Kabupaten|Kab\.?|Kota)\s+([A-Za-z][A-Za-z .'-]{2,30}?)(?=,|\.|\s+(?:Prov|Provinsi|Jawa|Daerah|DI\b|D\.I|Bali|Sumatera|Kalimantan|Sulawesi|Nusa|NTT|NTB|Papua|Banten|DKI|Lampung|Riau|Jambi|Bengkulu|Aceh|Gorontalo|Maluku|Kec\b|Kel\b|\d{5}|\()|$)/gi)].at(-1)
  const kota = best?.kota ?? (kab ? titleCase(kab[1].trim()) : null)
  // Provinsi dari kota yang dikenal lebih dulu (nama jalan seperti "Jl. Riau" bisa terbaca sebagai provinsi)
  const provinsi = (kota ? KOTA_PROVINSI[kota] : null) ?? (provMatch ? PROV_NORMAL[provMatch] ?? provMatch : null)
  return { kota: kota?.slice(0, 120) ?? null, provinsi }
}

async function accurateGet<T>(path: string, params: Record<string, string | number>) {
  try {
    return await accurate<T>(path, { params })
  } catch (error) {
    if (error instanceof AccurateError) fail(502, `Accurate: ${error.message.replace(/^Accurate \(\d+\): /, '')}`)
    throw error
  }
}

// Ambil keterangan & alamat SO dari Accurate (12 bulan), simpan ke SO lokal, lalu isi daftar ekspedisi per tujuan (tabel expeditions,
// sumber 'so') & riwayat tarif (expedition_rates). Baris ekspedisi isian manual tidak ditimpa.
export async function syncExpeditionsFromSo(months = 12) {
  const since = new Date(Date.now() - months * 30 * 86400e3)
  const p = (n: number) => String(n).padStart(2, '0')
  const sinceAcc = `${p(since.getUTCDate())}/${p(since.getUTCMonth() + 1)}/${since.getUTCFullYear()}`
  const listPage = (page: number) => accurateGet<Obj[]>('/api/sales-order/list.do', {
    fields: 'id,number,transDate,description,customer', 'sp.page': page, 'sp.pageSize': 100, 'sp.sort': 'transDate|desc', 'filter.transDate.op': 'GREATER_EQUAL_THAN', 'filter.transDate.val': sinceAcc,
  })
  // Halaman pertama memberi jumlah halaman; sisanya diambil paralel (4 sekaligus)
  const first = await listPage(1)
  const rows: Obj[] = [...(first.d ?? [])]
  const pages = Array.from({ length: Math.min(first.sp?.pageCount ?? 1, 40) - 1 }, (_, i) => i + 2)
  for (let i = 0; i < pages.length; i += 4) for (const res of await Promise.all(pages.slice(i, i + 4).map(listPage))) rows.push(...(res.d ?? []))
  for (let i = 0; i < rows.length; i += 200) {
    const part = rows.slice(i, i + 200)
    await db.query(
      `UPDATE accurate_sales_orders SET description = CASE accurate_id ${part.map(() => 'WHEN ? THEN ?').join(' ')} ELSE description END WHERE accurate_id IN (?)`,
      [...part.flatMap((r) => [r.id, str(r.description, 2000) || null]), part.map((r) => r.id)],
    )
  }
  // Tujuan: alamat customer di Accurate (alamat kirim SO hanya ada di detail SO)
  const custIds = [...new Set(rows.map((r) => Number((r.customer as Obj | undefined)?.id)).filter(Boolean))]
  const [custs] = custIds.length ? await db.query<Row[]>('SELECT accurate_id, bill_street, bill_city, bill_province FROM customers WHERE accurate_id IN (?)', [custIds]) : [[] as Row[]]
  const addrOf = new Map(custs.map((c) => [Number(c.accurate_id), [c.bill_street, c.bill_city, c.bill_province].filter(Boolean).join(', ')]))
  // Nama tampilan per ekspedisi = penulisan yang paling sering
  const parsed = rows.map((r) => ({ r, note: parseShipNote(r.description as string), dest: parseDestination(addrOf.get(Number((r.customer as Obj | undefined)?.id)) ?? null) })).filter((x) => x.note)
  const nameCount = new Map<string, Map<string, number>>()
  for (const { note } of parsed) {
    const m = nameCount.get(note!.key) ?? new Map<string, number>()
    m.set(note!.nama, (m.get(note!.nama) ?? 0) + 1)
    nameCount.set(note!.key, m)
  }
  const displayName = (key: string) => [...nameCount.get(key)!.entries()].sort((a, b) => b[1] - a[1])[0][0]
  // SO terbaru lebih dulu: baris rute memakai tarif & estimasi terbaru
  const routeId = new Map<string, number>()
  const rateRows: unknown[][] = []
  for (const { r, note, dest } of parsed) {
    const tujuan = (dest.kota ?? dest.provinsi ?? 'Tujuan lain').slice(0, 255)
    const routeKey = `${note!.key}|${tujuan}`
    if (!routeId.has(routeKey)) {
      const est = note!.estimasi_min ? `${note!.estimasi_min}${note!.estimasi_max && note!.estimasi_max !== note!.estimasi_min ? `-${note!.estimasi_max}` : ''} hari` : null
      const [res] = await db.query<ResultSetHeader>(
        `INSERT INTO expeditions (nama, nama_key, tujuan, tarif_per_kg, estimasi_hari, keterangan, sumber, aktif) VALUES (?, ?, ?, ?, ?, ?, 'so', 1)
         ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id),
           nama = IF(sumber = 'so', VALUES(nama), nama), tarif_per_kg = IF(sumber = 'so', COALESCE(VALUES(tarif_per_kg), tarif_per_kg), tarif_per_kg),
           estimasi_hari = IF(sumber = 'so', COALESCE(VALUES(estimasi_hari), estimasi_hari), estimasi_hari), keterangan = IF(sumber = 'so', VALUES(keterangan), keterangan)`,
        [displayName(note!.key).slice(0, 150), note!.key, tujuan, note!.tarif_per_kg, est, `Otomatis dari keterangan SO (terakhir ${String(r.number)})${dest.provinsi ? ` · ${dest.provinsi}` : ''}`.slice(0, 500)],
      )
      routeId.set(routeKey, res.insertId)
    }
    rateRows.push([routeId.get(routeKey), 'so', r.id, str(r.number, 80), fromAccurateDate(r.transDate), dest.kota, dest.provinsi, note!.tarif_per_kg, note!.estimasi_min, note!.estimasi_max])
  }
  for (let i = 0; i < rateRows.length; i += 300)
    await db.query(
      `INSERT INTO expedition_rates (expedition_id, sumber, so_accurate_id, so_number, tanggal, kota, provinsi, tarif_per_kg, estimasi_min, estimasi_max) VALUES ?
       ON DUPLICATE KEY UPDATE expedition_id = VALUES(expedition_id), tanggal = VALUES(tanggal), kota = VALUES(kota), provinsi = VALUES(provinsi),
         tarif_per_kg = VALUES(tarif_per_kg), estimasi_min = VALUES(estimasi_min), estimasi_max = VALUES(estimasi_max)`,
      [rateRows.slice(i, i + 300)],
    )
  // Baris otomatis yang tidak lagi punya SO (mis. tujuan berubah setelah alamat terbaca) dan belum dipakai: dihapus
  await db.query(
    "DELETE FROM expeditions WHERE sumber = 'so' AND id NOT IN (SELECT DISTINCT expedition_id FROM expedition_rates) AND id NOT IN (SELECT expedition_id FROM shipments WHERE expedition_id IS NOT NULL) AND id NOT IN (SELECT expedition_id FROM quotations WHERE expedition_id IS NOT NULL)",
  )
  await db.query("INSERT INTO app_settings (`key`, value) VALUES ('logistik.ekspedisi_synced', NOW()) ON DUPLICATE KEY UPDATE value = NOW()")
  return { so: rows.length, tarif: rateRows.length, ekspedisi: nameCount.size, rute: routeId.size }
}

// ---------- Ekspedisi (tabel expeditions: satu baris = ekspedisi + tujuan) ----------
export const estimasiMax = (v: string | null | undefined) => {
  const m = String(v ?? '').match(/(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?/)
  return m ? Number(m[2] ?? m[1]) : null
}
export async function listRoutes() {
  const [rows] = await db.query<Row[]>(
    `SELECT e.*, u.name AS updated_by_name, COUNT(r.id) AS pemakaian, MAX(r.tanggal) AS terakhir, MIN(r.tarif_per_kg) AS tarif_min, MAX(r.tarif_per_kg) AS tarif_max,
       (SELECT COUNT(*) FROM shipments s WHERE s.expedition_id = e.id AND s.status <> 'batal') AS pengiriman
     FROM expeditions e LEFT JOIN users u ON u.id = e.updated_by
     LEFT JOIN expedition_rates r ON r.expedition_id = e.id AND r.tanggal >= CURDATE() - INTERVAL 12 MONTH
     GROUP BY e.id ORDER BY e.aktif DESC, e.nama, (e.tarif_per_kg IS NULL), e.tarif_per_kg`,
  )
  return rows.map((r) => ({
    id: Number(r.id), nama: String(r.nama), nama_key: (r.nama_key as string) ?? expeditionKey(String(r.nama)), tujuan: String(r.tujuan), kontak: (r.kontak as string) ?? null, telepon: (r.telepon as string) ?? null,
    tarif_per_kg: num(r.tarif_per_kg), minimal_kg: num(r.minimal_kg), estimasi_hari: (r.estimasi_hari as string) ?? null, keterangan: (r.keterangan as string) ?? null,
    sumber: (r.sumber as 'manual' | 'so') ?? 'manual', aktif: !!r.aktif, updated_by_name: (r.updated_by_name as string) ?? null,
    pemakaian: Number(r.pemakaian), terakhir: (r.terakhir as string) ?? null, tarif_min: num(r.tarif_min), tarif_max: num(r.tarif_max), pengiriman: Number(r.pengiriman),
  }))
}

// Ekspedisi termurah ke tujuan (kota / provinsi): baris aktif yang cocok, urut tarif per kg
export async function cheapestFor(tujuan: string) {
  const like = `%${tujuan}%`
  const [rows] = await db.query<Row[]>(
    `SELECT e.id, e.nama, e.tujuan, e.telepon, e.tarif_per_kg, e.minimal_kg, e.estimasi_hari, e.sumber,
       (SELECT COUNT(*) FROM expedition_rates r WHERE r.expedition_id = e.id) AS pemakaian, (SELECT MAX(r.tanggal) FROM expedition_rates r WHERE r.expedition_id = e.id) AS terakhir
     FROM expeditions e
     WHERE e.aktif = 1 AND (e.tujuan LIKE ? OR e.keterangan LIKE ? OR EXISTS (SELECT 1 FROM expedition_rates r WHERE r.expedition_id = e.id AND r.provinsi LIKE ?))
     ORDER BY (e.tarif_per_kg IS NULL), e.tarif_per_kg, pemakaian DESC`,
    [like, like, like],
  )
  return rows.map((r) => ({
    id: Number(r.id), nama: String(r.nama), tujuan: String(r.tujuan), telepon: (r.telepon as string) ?? null, tarif_per_kg: num(r.tarif_per_kg), minimal_kg: num(r.minimal_kg),
    estimasi_hari: (r.estimasi_hari as string) ?? null, sumber: r.sumber as string, pemakaian: Number(r.pemakaian), terakhir: (r.terakhir as string) ?? null,
  }))
}

export function readRoute(body: Obj) {
  const nama = str(body.nama, 150) || fail(400, 'Nama ekspedisi wajib diisi.')
  const tujuan = str(body.tujuan, 255) || fail(400, 'Tujuan (kota / provinsi) wajib diisi.')
  const dec = (v: unknown, label: string) => {
    if (v === '' || v === null || v === undefined) return null
    const n = Number(String(v).replace(',', '.'))
    if (!Number.isFinite(n) || n < 0 || n > 1e9) fail(400, `${label} tidak valid.`)
    return n
  }
  return {
    nama, nama_key: expeditionKey(nama), tujuan, kontak: str(body.kontak, 150) || null, telepon: str(body.telepon, 40) || null,
    tarif_per_kg: dec(body.tarif_per_kg, 'Tarif'), minimal_kg: dec(body.minimal_kg, 'Minimal kg'), estimasi_hari: str(body.estimasi_hari, 30) || null,
    keterangan: str(body.keterangan, 500) || null, aktif: body.aktif === false ? 0 : 1,
  }
}

// ---------- Pengiriman ----------
export const SHIP_STATUS = { packing: 'Packing', siap_kirim: 'Siap kirim', dikirim: 'Dikirim', diterima: 'Diterima', batal: 'Batal' } as const
export type ShipStatus = keyof typeof SHIP_STATUS

// SO dipantau mulai tanggal ini (modul Logistik mulai dipakai); SO lama dianggap sudah terkirim
export async function mulaiPantau() {
  const [[row]] = await db.query<Row[]>("SELECT value FROM app_settings WHERE `key` = 'logistik.mulai_kirim'")
  return isDate(String(row?.value ?? '')) ? String(row.value) : addDays(todayWib(), -7)
}

async function toleransi() {
  const [[row]] = await db.query<Row[]>("SELECT value FROM app_settings WHERE `key` = 'logistik.toleransi_kirim_hari'")
  return Math.max(0, Number(row?.value ?? 0) || 0)
}

// SO yang perlu dikirim: 60 hari terakhir, belum masuk pengiriman (selain batal); terlambat bila lewat tanggal kirim SO + toleransi
export async function shipCandidates() {
  const tol = await toleransi()
  const mulai = await mulaiPantau()
  const [rows] = await db.query<Row[]>(
    `SELECT so.accurate_id AS id, so.number, DATE_FORMAT(so.trans_date, '%Y-%m-%d') AS tanggal, DATE_FORMAT(so.ship_date, '%Y-%m-%d') AS ship_date, so.status, so.total_amount,
       so.description, COALESCE(so.to_address, CONCAT_WS(', ', c.bill_street, c.bill_city, c.bill_province)) AS to_address, so.customer_accurate_id, c.name AS customer_name, c.customer_no,
       (SELECT COUNT(*) FROM accurate_sales_order_items i WHERE i.so_accurate_id = so.accurate_id) AS baris,
       (SELECT SUM(IF(i.unit = 'kg', i.quantity, 0)) FROM accurate_sales_order_items i WHERE i.so_accurate_id = so.accurate_id) AS berat_kg
     FROM accurate_sales_orders so LEFT JOIN customers c ON c.accurate_id = so.customer_accurate_id
     WHERE COALESCE(so.ship_date, so.trans_date) >= ? AND COALESCE(so.status, '') NOT IN ('Ditutup', 'Closed')
       AND NOT EXISTS (SELECT 1 FROM shipment_items si JOIN shipments s ON s.id = si.shipment_id WHERE si.so_accurate_id = so.accurate_id AND s.status <> 'batal')
     ORDER BY so.ship_date IS NULL, so.ship_date, so.trans_date`,
    [mulai],
  )
  const today = todayWib()
  return rows.map((r) => {
    const note = parseShipNote(r.description as string)
    const batas = r.ship_date ? addDays(String(r.ship_date), tol) : null
    return {
      id: Number(r.id), number: String(r.number), tanggal: String(r.tanggal), ship_date: (r.ship_date as string) ?? null, status: (r.status as string) ?? null, total: Number(r.total_amount ?? 0),
      customer_accurate_id: num(r.customer_accurate_id), customer_name: (r.customer_name as string) ?? null, customer_no: (r.customer_no as string) ?? null,
      baris: Number(r.baris), berat_kg: num(r.berat_kg), ekspedisi: note?.nama ?? null, tujuan: parseDestination(r.to_address as string).kota,
      terlambat: !!batas && batas < today, hari_lewat: batas && batas < today ? Math.round((Date.parse(today) - Date.parse(batas)) / 86400e3) : 0,
    }
  })
}

// Isi awal pengiriman dari satu / beberapa SO (customer yang sama): alamat & keterangan langsung dari Accurate
export async function draftFromSo(ids: number[]) {
  if (!ids.length || ids.length > 10) fail(400, 'Pilih 1–10 SO.')
  const docs: Obj[] = []
  for (const id of ids) docs.push((await accurateGet<Obj>('/api/sales-order/detail.do', { id })).d)
  const custIds = new Set(docs.map((d) => Number((d.customer as Obj | undefined)?.id ?? d.customerId)))
  if (custIds.size > 1) fail(400, 'SO yang digabung dalam satu pengiriman harus dari customer yang sama.')
  const first = docs[0]
  const customer = (first.customer ?? {}) as Obj
  const note = docs.map((d) => parseShipNote(d.description as string)).find(Boolean) ?? null
  // Ekspedisi dari keterangan SO, rute yang cocok dengan kota tujuan (atau rute lain ekspedisi itu)
  const tujuan = parseDestination(first.toAddress as string)
  let expedition: { id: number; nama: string; tarif_per_kg: number | null; estimasi_max: number | null } | null = null
  if (note) {
    const [cands] = await db.query<Row[]>('SELECT id, nama, tujuan, tarif_per_kg, estimasi_hari FROM expeditions WHERE nama_key = ? AND aktif = 1 ORDER BY (tujuan = ?) DESC, (tujuan = ?) DESC, id DESC LIMIT 1', [note.key, tujuan.kota ?? '', tujuan.provinsi ?? ''])
    const e = cands[0]
    expedition = e ? { id: Number(e.id), nama: String(e.nama), tarif_per_kg: note.tarif_per_kg ?? num(e.tarif_per_kg), estimasi_max: note.estimasi_max ?? estimasiMax(e.estimasi_hari as string) } : null
  }
  const items = docs.flatMap((d) => ((d.detailItem ?? []) as Obj[]).map((l) => {
    const item = (l.item ?? {}) as Obj
    const unit = ((l.itemUnit ?? {}) as Obj).name as string | undefined
    return { so_accurate_id: Number(d.id), so_number: String(d.number), item_no: (item.no as string) ?? null, item_name: String(l.detailName ?? item.name ?? ''), qty: Number(l.quantity ?? 0), unit: unit ?? null, koli: null, catatan: (l.detailNotes as string) || null }
  }))
  const berat = items.filter((i) => /^kg$/i.test(i.unit ?? '')).reduce((t, i) => t + i.qty, 0)
  const ships = docs.map((d) => fromAccurateDate(d.shipDate)).filter(Boolean).sort() as string[]
  return {
    customer_accurate_id: Number(customer.id ?? first.customerId), customer_name: String(customer.name ?? ''), customer_no: (customer.customerNo as string) ?? null,
    telepon: (customer.mobilePhone as string) || (customer.workPhone as string) || null, alamat: String(first.toAddress ?? ''), rencana_kirim: ships[0] ?? null,
    expedition_id: expedition?.id ?? null, ekspedisi_nama: expedition?.nama ?? note?.nama ?? null, tarif_per_kg: expedition?.tarif_per_kg ?? note?.tarif_per_kg ?? null,
    estimasi_max: expedition?.estimasi_max ?? note?.estimasi_max ?? null, berat_kg: berat || null, tujuan, items,
  }
}

export type ShipmentInput = ReturnType<typeof readShipment>
export function readShipment(body: Obj) {
  const customer_name = str(body.customer_name, 255) || fail(400, 'Nama customer wajib diisi.')
  const dec = (v: unknown, label: string, max = 1e9) => {
    if (v === '' || v === null || v === undefined) return null
    const n = Number(String(v).replace(',', '.'))
    if (!Number.isFinite(n) || n < 0 || n > max) fail(400, `${label} tidak valid.`)
    return n
  }
  const date = (v: unknown, label: string) => {
    const s = str(v, 10)
    if (!s) return null
    if (!isDate(s)) fail(400, `${label} tidak valid.`)
    return s
  }
  const items = ((Array.isArray(body.items) ? body.items : []) as Obj[]).filter((i) => str(i.item_name, 500)).map((i, k) => ({
    so_accurate_id: num(i.so_accurate_id), so_number: str(i.so_number, 80) || null, item_no: str(i.item_no, 80) || null, item_name: str(i.item_name, 500),
    qty: dec(i.qty, `Qty baris ${k + 1}`) ?? fail(400, `Qty baris ${k + 1} wajib diisi.`), unit: str(i.unit, 40) || null, koli: dec(i.koli, `Koli baris ${k + 1}`, 60000), catatan: str(i.catatan, 500) || null,
  }))
  if (!items.length) fail(400, 'Tambahkan minimal satu barang.')
  const berat = dec(body.berat_kg, 'Berat')
  const tarif = dec(body.tarif_per_kg, 'Tarif')
  return {
    customer_accurate_id: num(body.customer_accurate_id), customer_name, customer_no: str(body.customer_no, 50) || null, alamat: str(body.alamat, 1000) || null, telepon: str(body.telepon, 80) || null,
    expedition_id: num(body.expedition_id), ekspedisi_nama: str(body.ekspedisi_nama, 120) || null, no_resi: str(body.no_resi, 80) || null, koli: dec(body.koli, 'Koli', 60000),
    berat_kg: berat, tarif_per_kg: tarif, ongkir: dec(body.ongkir, 'Ongkir') ?? (berat && tarif ? Math.round(berat * tarif) : null),
    rencana_kirim: date(body.rencana_kirim, 'Rencana kirim'), sopir: str(body.sopir, 120) || null, catatan: str(body.catatan, 1000) || null, items,
  }
}

async function nextNomor(conn: PoolConnection) {
  const ym = todayWib().slice(0, 7).replace('-', '/')
  const [[row]] = await conn.query<Row[]>("SELECT nomor FROM shipments WHERE nomor LIKE ? ORDER BY nomor DESC LIMIT 1 FOR UPDATE", [`SJ/${ym}/%`])
  const last = row ? Number(String(row.nomor).split('/').pop()) : 0
  return `SJ/${ym}/${String(last + 1).padStart(4, '0')}`
}

const SHIP_COLS = ['customer_accurate_id', 'customer_name', 'customer_no', 'alamat', 'telepon', 'expedition_id', 'ekspedisi_nama', 'no_resi', 'koli', 'berat_kg', 'tarif_per_kg', 'ongkir', 'rencana_kirim', 'sopir', 'catatan'] as const
export async function saveShipment(v: ShipmentInput, userId: number, id?: number) {
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    if (v.expedition_id) {
      const [[e]] = await conn.query<Row[]>('SELECT nama FROM expeditions WHERE id = ?', [v.expedition_id])
      if (!e) fail(400, 'Ekspedisi tidak ditemukan.')
      v.ekspedisi_nama = String(e.nama)
    }
    if (id) {
      const [[cur]] = await conn.query<Row[]>('SELECT status FROM shipments WHERE id = ? FOR UPDATE', [id])
      if (!cur) fail(404, 'Pengiriman tidak ditemukan.')
      if (['diterima', 'batal'].includes(String(cur.status))) fail(400, 'Pengiriman yang sudah diterima / batal tidak bisa diubah.')
      await conn.query(`UPDATE shipments SET ${SHIP_COLS.map((c) => `${c} = ?`).join(', ')}, updated_by = ? WHERE id = ?`, [...SHIP_COLS.map((c) => v[c]), userId, id])
      await conn.query('DELETE FROM shipment_items WHERE shipment_id = ?', [id])
    } else {
      const nomor = await nextNomor(conn)
      const [res] = await conn.query<ResultSetHeader>(`INSERT INTO shipments (nomor, ${SHIP_COLS.join(', ')}, created_by) VALUES (?, ${SHIP_COLS.map(() => '?').join(', ')}, ?)`, [nomor, ...SHIP_COLS.map((c) => v[c]), userId])
      id = res.insertId
    }
    // SO yang sudah ada di pengiriman lain (belum batal) tidak boleh dobel
    const soIds = [...new Set(v.items.map((i) => i.so_accurate_id).filter(Boolean))]
    if (soIds.length) {
      const [dup] = await conn.query<Row[]>(
        "SELECT DISTINCT si.so_number, s.nomor FROM shipment_items si JOIN shipments s ON s.id = si.shipment_id WHERE si.so_accurate_id IN (?) AND s.id <> ? AND s.status <> 'batal'",
        [soIds, id],
      )
      if (dup.length) fail(400, `SO ${dup.map((d) => `${d.so_number} (sudah di ${d.nomor})`).join(', ')} sudah masuk pengiriman lain.`)
    }
    await conn.query('INSERT INTO shipment_items (shipment_id, so_accurate_id, so_number, item_no, item_name, qty, unit, koli, catatan) VALUES ?',
      [v.items.map((i) => [id, i.so_accurate_id, i.so_number, i.item_no, i.item_name, i.qty, i.unit, i.koli, i.catatan])])
    await conn.commit()
    return id!
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
}

// Ubah status: siap_kirim / dikirim (tanggal, resi) / diterima (tanggal, penerima) / batal; target tiba = kirim + estimasi ekspedisi
export async function setShipmentStatus(id: number, body: Obj, userId: number) {
  const [[cur]] = await db.query<Row[]>('SELECT s.*, e.estimasi_hari FROM shipments s LEFT JOIN expeditions e ON e.id = s.expedition_id WHERE s.id = ?', [id])
  if (!cur) fail(404, 'Pengiriman tidak ditemukan.')
  const status = String(body.status) as ShipStatus
  if (!(status in SHIP_STATUS)) fail(400, 'Status tidak dikenal.')
  const from = String(cur.status)
  const allowed: Record<string, string[]> = { packing: ['siap_kirim', 'dikirim', 'batal'], siap_kirim: ['packing', 'dikirim', 'batal'], dikirim: ['diterima', 'siap_kirim'], diterima: ['dikirim'], batal: ['packing'] }
  if (!allowed[from]?.includes(status)) fail(400, `Status ${SHIP_STATUS[from as ShipStatus]} tidak bisa diubah ke ${SHIP_STATUS[status]}.`)
  const tanggal = str(body.tanggal, 10) || todayWib()
  if (!isDate(tanggal)) fail(400, 'Tanggal tidak valid.')
  const sets: string[] = ['status = ?', 'updated_by = ?']
  const args: unknown[] = [status, userId]
  if (status === 'dikirim') {
    const est = num(body.estimasi_hari) ?? estimasiMax(cur.estimasi_hari as string)
    sets.push('tanggal_kirim = ?', 'no_resi = COALESCE(?, no_resi)', 'target_tiba = ?', 'tanggal_diterima = NULL', 'penerima = NULL')
    args.push(tanggal, str(body.no_resi, 80) || null, est ? addDays(tanggal, est) : null)
  }
  if (status === 'diterima') {
    sets.push('tanggal_diterima = ?', 'penerima = ?')
    args.push(tanggal, str(body.penerima, 120) || null)
  }
  if (status === 'packing' || status === 'siap_kirim') sets.push('tanggal_kirim = NULL', 'target_tiba = NULL', 'tanggal_diterima = NULL')
  await db.query(`UPDATE shipments SET ${sets.join(', ')} WHERE id = ?`, [...args, id])
}

export const SHIPMENT_SELECT = `SELECT s.*, e.telepon AS ekspedisi_telepon, uc.name AS created_name,
  (SELECT GROUP_CONCAT(DISTINCT si.so_number ORDER BY si.so_number SEPARATOR ', ') FROM shipment_items si WHERE si.shipment_id = s.id) AS so_numbers,
  (SELECT COUNT(*) FROM shipment_items si WHERE si.shipment_id = s.id) AS baris
  FROM shipments s LEFT JOIN expeditions e ON e.id = s.expedition_id LEFT JOIN users uc ON uc.id = s.created_by`

export function serializeShipment(r: Row) {
  const today = todayWib()
  const d = (v: unknown) => (v ? String(v).slice(0, 10) : null)
  const target = d(r.target_tiba)
  const diterima = d(r.tanggal_diterima)
  return {
    id: Number(r.id), nomor: String(r.nomor), status: r.status as ShipStatus, customer_name: String(r.customer_name), customer_no: (r.customer_no as string) ?? null,
    customer_accurate_id: num(r.customer_accurate_id), alamat: (r.alamat as string) ?? null, telepon: (r.telepon as string) ?? null, expedition_id: num(r.expedition_id),
    ekspedisi_nama: (r.ekspedisi_nama as string) ?? null, ekspedisi_telepon: (r.ekspedisi_telepon as string) ?? null, no_resi: (r.no_resi as string) ?? null, koli: num(r.koli),
    berat_kg: num(r.berat_kg), tarif_per_kg: num(r.tarif_per_kg), ongkir: num(r.ongkir), rencana_kirim: d(r.rencana_kirim), tanggal_kirim: d(r.tanggal_kirim), target_tiba: target,
    tanggal_diterima: diterima, penerima: (r.penerima as string) ?? null, sopir: (r.sopir as string) ?? null, catatan: (r.catatan as string) ?? null,
    so_numbers: (r.so_numbers as string) ?? null, baris: Number(r.baris ?? 0), created_name: (r.created_name as string) ?? null, created_at: String(r.created_at),
    // Tepat waktu: diterima <= target tiba; terlambat bila belum diterima melewati target
    tepat_waktu: target && diterima ? diterima <= target : null,
    terlambat_tiba: !!target && !diterima && r.status === 'dikirim' && target < today,
  }
}

export async function shipmentItems(id: number) {
  const [rows] = await db.query<Row[]>('SELECT * FROM shipment_items WHERE shipment_id = ? ORDER BY id', [id])
  return rows.map((i) => ({ id: Number(i.id), so_accurate_id: num(i.so_accurate_id), so_number: (i.so_number as string) ?? null, item_no: (i.item_no as string) ?? null, item_name: String(i.item_name), qty: Number(i.qty), unit: (i.unit as string) ?? null, koli: num(i.koli), catatan: (i.catatan as string) ?? null }))
}
