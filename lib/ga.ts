// General Affair: nomor HP, langganan aplikasi, dan WiFi kantor dari spreadsheet "PAP - GA - List No HP, Subscription, WIFI".
// Spreadsheet tetap sumber utama (seperti Data Mesin / Grade): tambah, ubah, hapus, dan centang bayar di PAP-MS ditulis ke
// sheet lebih dulu lalu disinkron ulang; perubahan langsung di sheet terbaca saat sinkron (cron Drive, tombol Sinkron,
// atau otomatis saat menu dibuka bila sinkron terakhir > 10 menit).
//   No HP PAP    : No | Nomor HP | Ket | Masa Aktif | Provider | <tahun> > <bulan> berisi "Sudah"
//   Subscription : No | Nama Layanan | Kategori | Vendor | Biaya | Siklus | Jatuh Tempo | Metode | Status | Penanggung Jawab | User | Catatan
//   WIFI         : tabel utama (No | Nama Wifi | Provider | ID Pelanggan | Nama Pelanggan | Biaya | Jatuh Tempo | Paket | Call Center | Catatan)
//                  + tabel status bayar per bulan di bawahnya (No | Nama Wifi | Provider | ID Pelanggan | <bulan>...), tahun di baris atasnya
import type { RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'
import { readSpreadsheet, spreadsheetId, type SheetTab } from '@/lib/drive'
import { nameKey, parseDate, parseNumber } from '@/lib/hrd'
import { deleteRow, insertRowAtEnd, openSheet, readTab, SheetWriteError, sheetDate, writeCells, type Sheet } from '@/lib/sheet-write'
import { isManagement, type UserProfile } from '@/lib/users'

export const GA_SETTING = 'ga.sheet_url'
export type GaJenis = 'hp' | 'langganan' | 'wifi'
export const GA_JENIS: Record<GaJenis, string> = { hp: 'Nomor HP', langganan: 'Langganan', wifi: 'WiFi' }
export const gaJenis = (v: unknown): GaJenis => (v === 'hp' || v === 'langganan' || v === 'wifi' ? v : fail(400, 'Jenis data GA tidak dikenal.'))

// ---------- Hak akses ----------
const hasMenu = (user: UserProfile, key: string) => user.menus.includes(key as never)
export const canViewGa = (user: UserProfile) => hasMenu(user, 'ga-data')
// Ubah data, sinkron, proses pengajuan: divisi General Affair, GM, admin
export const canManageGa = (user: UserProfile) => isManagement(user) || user.division.code === 'general_affair'
export function requireGaView(user: UserProfile) {
  if (!canViewGa(user)) fail(403, 'Anda tidak punya akses ke menu Data GA.')
}
export function requireGaManage(user: UserProfile) {
  requireGaView(user)
  if (!canManageGa(user)) fail(403, 'Data GA dikelola General Affair.')
}

// ---------- Nilai sel ----------
const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()
const norm = (v: unknown) => clean(v).toLowerCase()
const text = (v: unknown, max: number) => clean(v).slice(0, max) || null
// ID pelanggan / nomor besar dari ekspor Excel: 1.42528400309E11 -> 142528400309
const idText = (v: unknown, max = 60) => {
  const s = clean(v)
  if (!s) return null
  if (/^\d+(\.\d+)?e\+?\d+$/i.test(s)) return BigInt(Math.round(Number(s))).toString().slice(0, max)
  return s.replace(/\.0+$/, '').slice(0, max)
}
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '')
const MONTH_OF: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, agt: 8, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12 }
const monthOf = (v: unknown) => {
  const s = norm(v)
  return /^[a-z]+$/.test(s) ? MONTH_OF[s.slice(0, 3)] ?? null : null
}
const yearOf = (v: unknown) => {
  const n = Number(clean(v).replace(/\.0+$/, ''))
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : null
}
const pad = (n: number) => String(n).padStart(2, '0')
const paid = (v: unknown) => /^(sudah|lunas|ya|v|✓|true)$/i.test(clean(v))
const at = (row: string[] | undefined, i: number) => (i >= 0 ? row?.[i] ?? '' : '')

type PayCol = { key: string; col: number } // key "YYYY-MM"

// Kolom bulan: baris bulan + tahun di baris yang sama / di atasnya (sel tahun berlaku sampai tahun berikutnya)
function payColumns(monthRow: string[], yearRows: string[][], fallbackYear: number | null): PayCol[] {
  const cols: PayCol[] = []
  let year = fallbackYear
  for (let c = 0; c < monthRow.length; c++) {
    for (const yr of yearRows) { const y = yearOf(yr[c]); if (y) year = y }
    const m = monthOf(monthRow[c])
    if (m && year) cols.push({ key: `${year}-${pad(m)}`, col: c })
  }
  return cols
}
const findCol = (header: string[], test: (h: string) => boolean) => header.findIndex((h) => test(norm(h)))

// ---------- Baca tab ----------
export type PhoneRow = { no: number | null; nomor: string; ket: string | null; masa_aktif: string | null; provider: string | null; pembayaran: Record<string, boolean>; sheet_row: number }
export type SubRow = {
  no: number | null; nama: string; kategori: string | null; vendor: string | null; biaya: number | null; siklus: string | null; jatuh_tempo: string | null
  metode_bayar: string | null; status: string | null; penanggung_jawab: string | null; user_akun: string | null; catatan: string | null; sheet_row: number
}
export type WifiRow = {
  no: number | null; nama: string; provider: string | null; id_pelanggan: string | null; nama_pelanggan: string | null; biaya: number | null; jatuh_tempo: string | null
  tgl_tagihan: number | null; paket: string | null; call_center: string | null; catatan: string | null; pembayaran: Record<string, boolean>; sheet_row: number
}
type Layout = { cols: Record<string, number>; lastRow: number }

function parsePhones(rows: string[][]) {
  const index = rows.slice(0, 15).findIndex((r) => r.some((c) => norm(c) === 'nomor hp'))
  if (index < 0) return null
  const header = rows[index]
  const cols = {
    no: findCol(header, (h) => h === 'no'), nomor: findCol(header, (h) => h === 'nomor hp'), ket: findCol(header, (h) => h === 'ket' || h === 'keterangan'),
    masa_aktif: findCol(header, (h) => h.startsWith('masa aktif')), provider: findCol(header, (h) => h === 'provider'),
  }
  // Bulan di baris judul atau baris di bawahnya; tahun di baris judul
  const monthIndex = [index, index + 1].find((i) => (rows[i] ?? []).filter((c) => monthOf(c)).length >= 3) ?? index + 1
  const pay = payColumns(rows[monthIndex] ?? [], [rows[index], rows[index - 1] ?? []], null)
  const items: PhoneRow[] = []
  for (let r = monthIndex + 1; r < rows.length; r++) {
    const row = rows[r]
    const nomor = clean(at(row, cols.nomor))
    if (digits(nomor).length < 6) continue
    items.push({
      no: parseNumber(at(row, cols.no)), nomor: nomor.slice(0, 40), ket: text(at(row, cols.ket), 150), masa_aktif: parseDate(at(row, cols.masa_aktif)),
      provider: text(at(row, cols.provider), 80), pembayaran: Object.fromEntries(pay.map((p) => [p.key, paid(at(row, p.col))])), sheet_row: r + 1,
    })
  }
  return { items, pay, layout: { cols, lastRow: items.at(-1)?.sheet_row ?? monthIndex + 1 } as Layout }
}

function parseSubs(rows: string[][]) {
  const index = rows.slice(0, 15).findIndex((r) => r.some((c) => norm(c).startsWith('nama layanan')))
  if (index < 0) return null
  const header = rows[index]
  const cols = {
    no: findCol(header, (h) => h === 'no'), nama: findCol(header, (h) => h.startsWith('nama layanan')), kategori: findCol(header, (h) => h.startsWith('kategori')),
    vendor: findCol(header, (h) => h.startsWith('vendor') || h.startsWith('provider')), biaya: findCol(header, (h) => h.startsWith('biaya') || h.startsWith('tarif')),
    siklus: findCol(header, (h) => h.startsWith('siklus')), jatuh_tempo: findCol(header, (h) => h.includes('jatuh tempo')), metode_bayar: findCol(header, (h) => h.startsWith('metode')),
    status: findCol(header, (h) => h === 'status'), penanggung_jawab: findCol(header, (h) => h.includes('jawab')), user_akun: findCol(header, (h) => h === 'user' || h === 'akun'),
    catatan: findCol(header, (h) => h.startsWith('catatan')),
  }
  const items: SubRow[] = []
  for (let r = index + 1; r < rows.length; r++) {
    const row = rows[r]
    const nama = clean(at(row, cols.nama))
    if (!nama) continue
    items.push({
      no: parseNumber(at(row, cols.no)), nama: nama.slice(0, 200), kategori: text(at(row, cols.kategori), 80), vendor: text(at(row, cols.vendor), 150),
      biaya: parseNumber(at(row, cols.biaya)), siklus: text(at(row, cols.siklus), 30), jatuh_tempo: parseDate(at(row, cols.jatuh_tempo)),
      metode_bayar: text(at(row, cols.metode_bayar), 80), status: text(at(row, cols.status), 30), penanggung_jawab: text(at(row, cols.penanggung_jawab), 150),
      user_akun: text(at(row, cols.user_akun), 255), catatan: text(at(row, cols.catatan), 2000), sheet_row: r + 1,
    })
  }
  return { items, layout: { cols, lastRow: items.at(-1)?.sheet_row ?? index + 1 } as Layout }
}

type WifiBlock = { header: number; cols: Record<string, number>; pay: PayCol[]; rows: { sheet_row: number; key: string; idp: string }[] }
const wifiKey = (nama: unknown) => nameKey(nama)

function parseWifi(rows: string[][]) {
  const isHeader = (r: string[] | undefined) => !!r?.some((c) => norm(c) === 'nama wifi')
  const index = rows.findIndex((r) => isHeader(r) && r.some((c) => norm(c).startsWith('biaya')))
  if (index < 0) return null
  const header = rows[index]
  const cols = {
    no: findCol(header, (h) => h === 'no'), nama: findCol(header, (h) => h === 'nama wifi'), provider: findCol(header, (h) => h === 'provider'),
    id_pelanggan: findCol(header, (h) => h === 'id pelanggan'), nama_pelanggan: findCol(header, (h) => h === 'nama pelanggan'), biaya: findCol(header, (h) => h.startsWith('biaya')),
    jatuh_tempo: findCol(header, (h) => h.includes('jatuh tempo')), paket: findCol(header, (h) => h === 'paket'), call_center: findCol(header, (h) => h.startsWith('call center')),
    catatan: findCol(header, (h) => h.startsWith('catatan')),
  }
  const items: WifiRow[] = []
  let r = index + 1
  for (; r < rows.length && clean(at(rows[r], cols.nama)); r++) {
    const row = rows[r]
    const tempo = text(at(row, cols.jatuh_tempo), 40)
    const day = Number(tempo?.match(/\d{1,2}/)?.[0])
    items.push({
      no: parseNumber(at(row, cols.no)), nama: clean(at(row, cols.nama)).slice(0, 150), provider: text(at(row, cols.provider), 80), id_pelanggan: idText(at(row, cols.id_pelanggan)),
      nama_pelanggan: text(at(row, cols.nama_pelanggan), 200), biaya: parseNumber(at(row, cols.biaya)), jatuh_tempo: tempo,
      tgl_tagihan: day >= 1 && day <= 31 ? day : null, paket: text(at(row, cols.paket), 500), call_center: idText(at(row, cols.call_center)), catatan: text(at(row, cols.catatan), 500),
      pembayaran: {}, sheet_row: r + 1,
    })
  }
  // Tabel status bayar: judul berisi "Nama Wifi" + nama bulan; tahun di 1-3 baris di atasnya (atau tahun blok sebelumnya)
  const blocks: WifiBlock[] = []
  let year: number | null = null
  for (let b = r; b < rows.length; b++) {
    const h = rows[b]
    if (!isHeader(h) || h.filter((c) => monthOf(c)).length < 1) continue
    const above = [rows[b - 3] ?? [], rows[b - 2] ?? [], rows[b - 1] ?? []]
    const pay = payColumns(h, above, year ?? new Date().getFullYear())
    if (pay.length) year = Number(pay.at(-1)!.key.slice(0, 4))
    const bc = { no: findCol(h, (x) => x === 'no'), nama: findCol(h, (x) => x === 'nama wifi'), provider: findCol(h, (x) => x === 'provider'), id_pelanggan: findCol(h, (x) => x === 'id pelanggan') }
    const block: WifiBlock = { header: b + 1, cols: bc, pay, rows: [] }
    for (let i = b + 1; i < rows.length && clean(at(rows[i], bc.nama)); i++) {
      block.rows.push({ sheet_row: i + 1, key: wifiKey(at(rows[i], bc.nama)), idp: digits(idText(at(rows[i], bc.id_pelanggan))) })
      const item = items.find((w) => (digits(w.id_pelanggan) && digits(w.id_pelanggan) === digits(idText(at(rows[i], bc.id_pelanggan)))) || wifiKey(w.nama) === wifiKey(at(rows[i], bc.nama)))
      if (item) for (const p of pay) item.pembayaran[p.key] = paid(at(rows[i], p.col))
    }
    blocks.push(block)
  }
  return { items, blocks, layout: { cols, lastRow: items.at(-1)?.sheet_row ?? index + 1 } as Layout }
}

const TAB_PARSERS = { hp: parsePhones, langganan: parseSubs, wifi: parseWifi } as const
export function findGaTabs(tabs: SheetTab[]) {
  const out: { hp?: { title: string; parsed: NonNullable<ReturnType<typeof parsePhones>> }; langganan?: { title: string; parsed: NonNullable<ReturnType<typeof parseSubs>> }; wifi?: { title: string; parsed: NonNullable<ReturnType<typeof parseWifi>> } } = {}
  for (const tab of tabs) {
    for (const jenis of ['hp', 'langganan', 'wifi'] as const) {
      if (out[jenis]) continue
      const parsed = TAB_PARSERS[jenis](tab.rows)
      if (parsed) { (out as Record<string, unknown>)[jenis] = { title: tab.title, parsed }; break }
    }
  }
  return out
}

// ---------- Sinkron dari sheet ----------
export async function loadGaUrl() {
  const [[row]] = await db.query<(RowDataPacket & { value: string })[]>('SELECT value FROM app_settings WHERE `key` = ?', [GA_SETTING])
  return row?.value ?? ''
}
export async function saveGaUrl(url: string, userId: number) {
  if (!spreadsheetId(url)) fail(400, 'Link tidak valid. Gunakan link Google Spreadsheet (docs.google.com/spreadsheets/d/...).')
  await db.query('INSERT INTO app_settings (`key`, value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)', [GA_SETTING, url.slice(0, 1000), userId])
}

export async function readGaSheet() {
  const url = await loadGaUrl()
  const id = spreadsheetId(url) ?? fail(400, 'Link spreadsheet GA belum diisi.')
  const tabs = await readSpreadsheet(id)
  return { url, tabs: tabs.map((t) => t.title), ...findGaTabs(tabs) }
}

export async function importGa(found: Awaited<ReturnType<typeof readGaSheet>>) {
  if (!found.hp && !found.langganan && !found.wifi) fail(400, 'Tab No HP (kolom Nomor HP), Subscription (Nama Layanan), maupun WIFI (Nama Wifi, Biaya) tidak ditemukan.')
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    // Tab yang tidak ditemukan tidak mengosongkan datanya
    if (found.hp) {
      await conn.query('DELETE FROM ga_phones')
      if (found.hp.parsed.items.length) await conn.query('INSERT INTO ga_phones (no, nomor, ket, masa_aktif, provider, pembayaran, sheet_row) VALUES ?', [
        found.hp.parsed.items.map((p) => [p.no, p.nomor, p.ket, p.masa_aktif, p.provider, JSON.stringify(p.pembayaran), p.sheet_row]),
      ])
    }
    if (found.langganan) {
      const cols = ['no', 'nama', 'kategori', 'vendor', 'biaya', 'siklus', 'jatuh_tempo', 'metode_bayar', 'status', 'penanggung_jawab', 'user_akun', 'catatan', 'sheet_row'] as const
      await conn.query('DELETE FROM ga_subscriptions')
      if (found.langganan.parsed.items.length) await conn.query(`INSERT INTO ga_subscriptions (${cols.join(', ')}) VALUES ?`, [found.langganan.parsed.items.map((s) => cols.map((k) => s[k]))])
    }
    if (found.wifi) {
      const cols = ['no', 'nama', 'provider', 'id_pelanggan', 'nama_pelanggan', 'biaya', 'jatuh_tempo', 'tgl_tagihan', 'paket', 'call_center', 'catatan', 'sheet_row'] as const
      await conn.query('DELETE FROM ga_wifi')
      if (found.wifi.parsed.items.length) await conn.query(`INSERT INTO ga_wifi (${cols.join(', ')}, pembayaran) VALUES ?`, [
        found.wifi.parsed.items.map((w) => [...cols.map((k) => w[k]), JSON.stringify(w.pembayaran)]),
      ])
    }
    const meta = { tabs: { hp: found.hp?.title ?? null, langganan: found.langganan?.title ?? null, wifi: found.wifi?.title ?? null } }
    await conn.query("INSERT INTO app_settings (`key`, value) VALUES ('ga.synced_at', NOW()) ON DUPLICATE KEY UPDATE value = NOW()")
    await conn.query("INSERT INTO app_settings (`key`, value) VALUES ('ga.meta', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [JSON.stringify(meta)])
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
  return { hp: found.hp?.parsed.items.length ?? 0, langganan: found.langganan?.parsed.items.length ?? 0, wifi: found.wifi?.parsed.items.length ?? 0 }
}

export const syncGa = async () => importGa(await readGaSheet())

// Dipakai saat menu dibuka: sinkron bila terakhir > 10 menit lalu (gagal tidak menghalangi tampilan data)
export async function syncGaIfStale(minutes = 10) {
  if (!spreadsheetId(await loadGaUrl())) return null
  const [[row]] = await db.query<(RowDataPacket & { stale: number })[]>(
    "SELECT COALESCE(MAX(value) < NOW() - INTERVAL ? MINUTE, 1) AS stale FROM app_settings WHERE `key` = 'ga.synced_at'", [minutes],
  )
  if (!Number(row?.stale ?? 1)) return null
  try {
    await syncGa()
    return null
  } catch (error) {
    return (error as Error).message
  }
}

// ---------- Isian form ----------
type Cell = string | number
const num = (v: unknown, label: string) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(String(v).replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? n : fail(400, `${label} harus berupa angka.`)
}
const isoDate = (v: unknown, label: string) => {
  const s = str(v, 10)
  if (!s) return ''
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? sheetDate(s) : fail(400, `${label} tidak valid.`)
}
const sheetText = (v: string) => (/^\d{6,}$/.test(v) ? `'${v}` : v) // nomor panjang tetap teks

function readInput(jenis: GaJenis, body: Record<string, unknown>): Record<string, Cell> {
  if (jenis === 'hp') {
    const nomor = str(body.nomor, 40) || fail(400, 'Nomor HP wajib diisi.')
    if (digits(nomor).length < 8) fail(400, 'Nomor HP tidak valid.')
    return { nomor: sheetText(nomor), ket: str(body.ket, 150), masa_aktif: isoDate(body.masa_aktif, 'Masa aktif'), provider: str(body.provider, 80) }
  }
  if (jenis === 'langganan') {
    return {
      nama: str(body.nama, 200) || fail(400, 'Nama layanan wajib diisi.'), kategori: str(body.kategori, 80), vendor: str(body.vendor, 150), biaya: num(body.biaya, 'Biaya') ?? '',
      siklus: str(body.siklus, 30), jatuh_tempo: isoDate(body.jatuh_tempo, 'Jatuh tempo'), metode_bayar: str(body.metode_bayar, 80), status: str(body.status, 30) || 'Aktif',
      penanggung_jawab: str(body.penanggung_jawab, 150), user_akun: str(body.user_akun, 255), catatan: str(body.catatan, 2000),
    }
  }
  const tgl = num(body.tgl_tagihan, 'Tanggal jatuh tempo')
  if (tgl !== null && (tgl < 1 || tgl > 31)) fail(400, 'Tanggal jatuh tempo harus 1-31.')
  return {
    nama: str(body.nama, 150) || fail(400, 'Nama WiFi wajib diisi.'), provider: str(body.provider, 80), id_pelanggan: sheetText(str(body.id_pelanggan, 60)),
    nama_pelanggan: str(body.nama_pelanggan, 200), biaya: num(body.biaya, 'Biaya') ?? '', jatuh_tempo: tgl ? `Tanggal ${tgl}` : '', paket: str(body.paket, 500),
    call_center: str(body.call_center, 60), catatan: str(body.catatan, 500),
  }
}

// ---------- Tulis ke sheet ----------
export type GaRow = { id: number; sheet_row: number | null; key: string; label: string }
const rowKey = (jenis: GaJenis, r: { nomor?: unknown; nama?: unknown; user_akun?: unknown }) =>
  jenis === 'hp' ? digits(r.nomor) : jenis === 'langganan' ? `${nameKey(r.nama)}|${norm(r.user_akun)}` : wifiKey(r.nama)

async function openTab(jenis: GaJenis) {
  const sheet = await openSheet(await loadGaUrl())
  for (const t of sheet.tabs) {
    const rows = await readTab(sheet, t.title)
    const parsed = TAB_PARSERS[jenis](rows)
    if (parsed) return { sheet, title: t.title, rows, parsed }
  }
  throw new SheetWriteError(`Tab ${GA_JENIS[jenis]} tidak ditemukan di spreadsheet GA.`)
}
type OpenTab = Awaited<ReturnType<typeof openTab>>

// Baris di sheet harus masih milik data yang sama (sheet bisa bergeser sejak sinkron terakhir)
function locate(tab: OpenTab, jenis: GaJenis, old: GaRow) {
  const items = tab.parsed.items as (PhoneRow | SubRow | WifiRow)[]
  const entry = items.find((e) => e.sheet_row === old.sheet_row)
  if (!entry || rowKey(jenis, entry as never) !== old.key) throw new SheetWriteError(`Baris "${old.label}" sudah berubah di spreadsheet. Klik Sinkron dulu, lalu ulangi.`)
  return entry
}

async function writeValues(sheet: Sheet, title: string, row: number, cols: Record<string, number>, values: Record<string, Cell>) {
  await writeCells(sheet, title, Object.entries(values).filter(([k]) => (cols[k] ?? -1) >= 0).map(([k, value]) => ({ row, col: cols[k], value })))
}

export async function gaCreate(jenis: GaJenis, body: Record<string, unknown>) {
  const values = readInput(jenis, body)
  const tab = await openTab(jenis)
  const items = tab.parsed.items as (PhoneRow | SubRow | WifiRow)[]
  const key = rowKey(jenis, Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v).replace(/^'/, '')])))
  if (items.some((e) => rowKey(jenis, e as never) === key)) fail(400, `${GA_JENIS[jenis]} ini sudah ada di spreadsheet.`)
  values.no = Math.max(0, ...items.map((e) => e.no ?? 0)) + 1
  const { cols, lastRow } = tab.parsed.layout
  if (!items.length) throw new SheetWriteError(`Tab ${tab.title} belum punya baris data sebagai contoh format. Isi satu baris langsung di sheet.`)
  // Baris baru menyalin format baris terakhir (dropdown "Sudah", warna), lalu isinya ditimpa
  const row = await insertRowAtEnd(tab.sheet, tab.title, lastRow)
  const clear: Record<string, Cell> = {}
  if (jenis === 'hp') (tab.parsed as NonNullable<ReturnType<typeof parsePhones>>).pay.forEach((p) => { clear[`pay:${p.key}`] = '' })
  const payCols = jenis === 'hp' ? Object.fromEntries((tab.parsed as NonNullable<ReturnType<typeof parsePhones>>).pay.map((p) => [`pay:${p.key}`, p.col])) : {}
  await writeValues(tab.sheet, tab.title, row, { ...cols, ...payCols }, { ...Object.fromEntries(Object.keys(cols).map((k) => [k, ''])), ...clear, ...values })
  // WiFi: tambahkan juga ke setiap tabel status bayar (dari bawah agar nomor baris di atasnya tidak bergeser)
  if (jenis === 'wifi') {
    const fresh = await openTab('wifi')
    const blocks = [...(fresh.parsed as NonNullable<ReturnType<typeof parseWifi>>).blocks].reverse()
    for (const b of blocks) {
      if (!b.rows.length) continue
      const at = await insertRowAtEnd(fresh.sheet, fresh.title, b.rows.at(-1)!.sheet_row)
      const cells: Record<string, Cell> = { no: values.no, nama: values.nama, provider: values.provider, id_pelanggan: values.id_pelanggan }
      b.pay.forEach((p) => { cells[`pay:${p.key}`] = '' })
      await writeValues(fresh.sheet, fresh.title, at, { ...b.cols, ...Object.fromEntries(b.pay.map((p) => [`pay:${p.key}`, p.col])) }, cells)
    }
  }
  return syncGa()
}

export async function gaUpdate(jenis: GaJenis, old: GaRow, body: Record<string, unknown>) {
  const values = readInput(jenis, body)
  const tab = await openTab(jenis)
  const entry = locate(tab, jenis, old)
  const items = tab.parsed.items as (PhoneRow | SubRow | WifiRow)[]
  const key = rowKey(jenis, Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v).replace(/^'/, '')])))
  if (items.some((e) => e.sheet_row !== entry.sheet_row && rowKey(jenis, e as never) === key)) fail(400, `${GA_JENIS[jenis]} ini sudah ada di spreadsheet.`)
  await writeValues(tab.sheet, tab.title, entry.sheet_row, tab.parsed.layout.cols, values)
  // WiFi: nama / provider / ID pelanggan di tabel status bayar ikut diperbarui
  if (jenis === 'wifi') {
    for (const b of (tab.parsed as NonNullable<ReturnType<typeof parseWifi>>).blocks) {
      const r = b.rows.find((x) => x.key === old.key)
      if (r) await writeValues(tab.sheet, tab.title, r.sheet_row, b.cols, { nama: values.nama, provider: values.provider, id_pelanggan: values.id_pelanggan })
    }
  }
  return syncGa()
}

export async function gaDelete(jenis: GaJenis, old: GaRow) {
  const tab = await openTab(jenis)
  const entry = locate(tab, jenis, old)
  // Hapus dari bawah ke atas: baris status bayar WiFi (di bawah tabel utama) lebih dulu
  const rows = [entry.sheet_row]
  if (jenis === 'wifi') for (const b of (tab.parsed as NonNullable<ReturnType<typeof parseWifi>>).blocks) rows.push(...b.rows.filter((x) => x.key === old.key).map((x) => x.sheet_row))
  for (const r of rows.sort((a, b) => b - a)) await deleteRow(tab.sheet, tab.title, r)
  return syncGa()
}

// Centang / hapus centang status bayar satu bulan ("Sudah" di sel bulan itu)
export async function gaSetPayment(jenis: 'hp' | 'wifi', old: GaRow, bulan: string, lunas: boolean) {
  if (!/^\d{4}-\d{2}$/.test(bulan)) fail(400, 'Bulan tidak valid.')
  const tab = await openTab(jenis)
  const entry = locate(tab, jenis, old)
  let row = entry.sheet_row
  let col = -1
  if (jenis === 'hp') col = (tab.parsed as NonNullable<ReturnType<typeof parsePhones>>).pay.find((p) => p.key === bulan)?.col ?? -1
  else {
    for (const b of (tab.parsed as NonNullable<ReturnType<typeof parseWifi>>).blocks) {
      const p = b.pay.find((x) => x.key === bulan)
      const r = b.rows.find((x) => x.key === old.key || (x.idp && x.idp === digits((entry as WifiRow).id_pelanggan)))
      if (p && r) { row = r.sheet_row; col = p.col; break }
    }
  }
  if (col < 0) throw new SheetWriteError(`Kolom bulan ${bulan} untuk "${old.label}" belum ada di spreadsheet. Tambahkan kolom / baris bulan itu di sheet dulu.`)
  await writeCells(tab.sheet, tab.title, [{ row, col, value: lunas ? 'Sudah' : '' }])
  return syncGa()
}

// ---------- Baca data untuk API ----------
export async function loadGaRow(jenis: GaJenis, id: number): Promise<GaRow> {
  const table = jenis === 'hp' ? 'ga_phones' : jenis === 'langganan' ? 'ga_subscriptions' : 'ga_wifi'
  const [[row]] = await db.query<(RowDataPacket & Record<string, unknown>)[]>(`SELECT * FROM ${table} WHERE id = ?`, [id])
  if (!row) fail(404, 'Data sudah diperbarui dari spreadsheet. Muat ulang halaman.')
  return { id, sheet_row: row.sheet_row as number | null, key: rowKey(jenis, row as { nomor?: unknown; nama?: unknown; user_akun?: unknown }), label: String(jenis === 'hp' ? row.nomor : row.nama) }
}
