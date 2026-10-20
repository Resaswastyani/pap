// Rekap kerusakan mesin dari spreadsheet "Laporan Kerusakan Mesin" di Google Drive (dibaca dengan akun Google yang terhubung
// di Master Data > Logo & Desain, sama seperti Jadwal Shift) + isian Form Laporan Kerusakan Mesin dari aplikasi.
// Format tab REKAP KERUSAKAN: NO | TANGGAL | MESIN | Komponen | KERUSAKAN | KETERANGAN (opsional: TINDAKAN, seperti tab FORM KERUSAKAN).
// Baris tanpa NO melanjutkan laporan di atasnya: berisi kerusakan lain (item baru) atau hanya lanjutan tindakan.
import type { RowDataPacket } from 'mysql2'
import { fail } from '@/lib/api'
import { db } from '@/lib/db'
import { readSpreadsheet, spreadsheetId, type SheetTab } from '@/lib/drive'
import { canHandleRepair, canViewRepairs } from '@/lib/repairs'
import { isLeadOf, type UserProfile } from '@/lib/users'

const SETTING_KEY = 'kerusakan_mesin.sheet_url'
export const DEFAULT_DAMAGE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1KFf9mAanl_Szo6I_6jQzmcj5zzwR64Eh/edit?usp=sharing&ouid=116992751279000154130&rtpof=true&sd=true'

export const requireDamageLog = (user: UserProfile) => {
  if (!canViewRepairs(user)) fail(403, 'Anda tidak punya akses ke menu Kerusakan Mesin.')
}
// Sinkron & ganti link spreadsheet: Teknik, GM/admin, kepala Produksi & PPIC
export const canSyncDamageLog = (user: UserProfile) => canHandleRepair(user) || isLeadOf(user, 'produksi', 'ppic')

export async function loadDamageSheetUrl() {
  const [[row]] = await db.query<(RowDataPacket & { value: string })[]>('SELECT value FROM app_settings WHERE `key` = ?', [SETTING_KEY])
  return row?.value || DEFAULT_DAMAGE_SHEET_URL
}
export async function saveDamageSheetUrl(url: string, userId: number) {
  if (!spreadsheetId(url)) fail(400, 'Link spreadsheet tidak valid. Gunakan link "docs.google.com/spreadsheets/d/...".')
  await db.query('INSERT INTO app_settings (`key`, value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)', [SETTING_KEY, url.slice(0, 1000), userId])
}

// ---------- Nama mesin ----------
// "mc cutseal HD", "MC Cut Seal HD", "Mc. Roto PP" -> "cutseal hd", "cutseal hd", "rotogravure pp"
export function machineKey(name: string | null | undefined) {
  let v = (name ?? '').toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim()
  v = v.replace(/^(m\/c|mc|mesin)\s+/, '')
  v = v.replace(/\bcut\s*seal\b/g, 'cutseal').replace(/\bbuffer\s*time\b/g, 'buffertime').replace(/\brot+o(?:gravure|grafur|gravur)?\b/g, 'rotogravure')
  return v.slice(0, 150) || null
}
// "cutseal hd" -> "Cutseal HD"
export const machineLabel = (key: string) =>
  key.split(' ').map((w) => (/^(hd|pp|pe|ldpe|hdpe|opp|cpp|pvc|ac)$/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(' ')

// ---------- Pembacaan sheet ----------
const pad = (n: number) => String(n).padStart(2, '0')
const norm = (v: string | undefined) => (v ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

// Tanggal: angka seri Excel (44837), "16/10/2023", "14/12/23", "2023-10-16"
export function parseSheetDate(value: string | undefined) {
  const v = (value ?? '').trim()
  let y: number, m: number, d: number
  let match: RegExpMatchArray | null
  if (/^\d{5}(\.\d+)?$/.test(v)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(v)) * 86_400_000)
    ;[y, m, d] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
  } else if ((match = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  else if ((match = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/))) {
    // Format Indonesia hari/bulan; bila bagian kedua > 12 berarti bulan/hari
    let [a, b] = [Number(match[1]), Number(match[2])]
    if (b > 12 && a <= 12) [a, b] = [b, a]
    ;[d, m, y] = [a, b, match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3])]
  } else return null
  return y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null
}

type Columns = { no: number; tanggal: number; mesin: number; komponen: number; kerusakan: number; tindakan: number; keterangan: number }
function detectHeader(rows: string[][]): { index: number; cols: Columns } | null {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const row = rows[i] ?? []
    const find = (re: RegExp) => row.findIndex((c) => re.test(norm(c)))
    const tanggal = find(/^(tanggal|tgl)$/)
    const mesin = find(/^(nama )?mesin$/)
    const kerusakan = find(/^kerusakan$/)
    if (tanggal < 0 || mesin < 0 || kerusakan < 0) continue
    const tindakan = find(/^tindakan/)
    const keterangan = find(/^keterangan$/)
    return { index: i, cols: { no: find(/^(no|no\.|nomor)$/), tanggal, mesin, komponen: find(/^komponen/), kerusakan, tindakan, keterangan } }
  }
  return null
}

export type DamageEntry = {
  sheet_row: number; no_laporan: number | null; tanggal: string | null; mesin: string | null; komponen: string | null
  kerusakan: string | null; tindakan: string | null; keterangan: string | null
}
const cell = (row: string[], col: number) => (col >= 0 ? (row[col] ?? '').trim() : '')
const join = (a: string | null, b: string) => (b ? (a ? `${a}\n${b}` : b) : a)

function parseTab(tab: SheetTab) {
  const header = detectHeader(tab.rows)
  if (!header) return null
  const { cols } = header
  const entries: DamageEntry[] = []
  let current: { no: number | null; tanggal: string | null; mesin: string | null } = { no: null, tanggal: null, mesin: null }
  for (let i = header.index + 1; i < tab.rows.length; i++) {
    const row = tab.rows[i] ?? []
    const no = Number(cell(row, cols.no).replace(/\.0+$/, ''))
    const tanggal = parseSheetDate(cell(row, cols.tanggal))
    const mesin = cell(row, cols.mesin)
    const komponen = cell(row, cols.komponen)
    const kerusakan = cell(row, cols.kerusakan)
    const tindakan = cell(row, cols.tindakan)
    const keterangan = cell(row, cols.keterangan)
    if (!mesin && !komponen && !kerusakan && !tindakan && !keterangan) continue
    if (Number.isInteger(no) && no > 0) current = { no, tanggal, mesin: mesin || null }
    else if (mesin) current = { ...current, mesin }
    const last = entries.at(-1)
    // Hanya lanjutan tindakan/keterangan (tanpa kerusakan, komponen, mesin, NO): gabungkan ke baris sebelumnya
    if (last && !kerusakan && !komponen && !mesin && !(no > 0)) {
      last.tindakan = join(last.tindakan, tindakan)
      last.keterangan = join(last.keterangan, keterangan)
      continue
    }
    entries.push({
      sheet_row: i + 1, no_laporan: current.no, tanggal: tanggal ?? current.tanggal, mesin: current.mesin,
      komponen: komponen || null, kerusakan: kerusakan || null, tindakan: tindakan || null, keterangan: keterangan || null,
    })
  }
  return entries
}

// Tab rekap (judul berisi "rekap") diutamakan; tab form kosong dilewati
export async function readDamageSheet(url: string) {
  const id = spreadsheetId(url) ?? fail(400, 'Link spreadsheet tidak valid.')
  const tabs = await readSpreadsheet(id)
  const parsed = tabs.map((t) => ({ title: t.title, entries: parseTab(t) }))
  const rekap = parsed.filter((t) => t.entries?.length && /rekap/i.test(t.title))
  const used = rekap.length ? rekap : parsed.filter((t) => t.entries?.length)
  return {
    tabs: parsed.map((t) => ({ title: t.title, rows: t.entries?.length ?? 0, used: used.includes(t), note: t.entries === null ? 'Kolom Tanggal, Mesin & Kerusakan tidak ditemukan' : null })),
    entries: used.flatMap((t) => t.entries ?? []),
  }
}

// Baris dari sheet diganti seluruhnya; isian dari aplikasi tidak disentuh
export async function importDamageEntries(entries: DamageEntry[]) {
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query("DELETE FROM machine_damage_logs WHERE source = 'sheet'")
    for (let i = 0; i < entries.length; i += 500) {
      await conn.query(
        `INSERT INTO machine_damage_logs (source, sheet_row, no_laporan, tanggal, mesin, mesin_key, komponen, kerusakan, tindakan, keterangan) VALUES ?`,
        [entries.slice(i, i + 500).map((e) => ['sheet', e.sheet_row, e.no_laporan, e.tanggal, e.mesin?.slice(0, 150) ?? null, machineKey(e.mesin), e.komponen?.slice(0, 150) ?? null, e.kerusakan, e.tindakan, e.keterangan])],
      )
    }
    await conn.query("INSERT INTO app_settings (`key`, value) VALUES ('kerusakan_mesin.synced_at', NOW()) ON DUPLICATE KEY UPDATE value = NOW()")
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
  return { baris: entries.length, laporan: new Set(entries.map((e) => e.no_laporan).filter(Boolean)).size }
}

// ---------- Daftar & form ----------
export const DAMAGE_SELECT = `SELECT d.id, d.source, d.sheet_row, d.no_laporan, d.tanggal, d.mesin, d.mesin_key, d.komponen, d.kerusakan, d.tindakan, d.keterangan,
  d.created_by, u.name AS created_name, d.created_at FROM machine_damage_logs d LEFT JOIN users u ON u.id = d.created_by`

// Filter daftar/cetak: ?q= &mesin=<mesin_key> &komponen= &dari=YYYY-MM-DD &sampai=YYYY-MM-DD &tahun=YYYY
export function damageFilter(params: URLSearchParams) {
  const where: string[] = []
  const args: unknown[] = []
  const q = (params.get('q') ?? '').trim().slice(0, 100)
  if (q) where.push('(d.mesin LIKE ? OR d.komponen LIKE ? OR d.kerusakan LIKE ? OR d.tindakan LIKE ? OR d.keterangan LIKE ?)'), args.push(...Array(5).fill(`%${q}%`))
  const mesin = (params.get('mesin') ?? '').trim().slice(0, 150)
  if (mesin) where.push('d.mesin_key = ?'), args.push(mesin)
  const komponen = (params.get('komponen') ?? '').trim().slice(0, 150)
  if (komponen) where.push('d.komponen = ?'), args.push(komponen)
  const date = (k: string) => (/^\d{4}-\d{2}-\d{2}$/.test(params.get(k) ?? '') ? params.get(k)! : null)
  const dari = date('dari')
  const sampai = date('sampai')
  if (dari) where.push('d.tanggal >= ?'), args.push(dari)
  if (sampai) where.push('d.tanggal <= ?'), args.push(sampai)
  const tahun = /^\d{4}$/.test(params.get('tahun') ?? '') ? Number(params.get('tahun')) : null
  if (tahun) where.push('YEAR(d.tanggal) = ?'), args.push(tahun)
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', args }
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
// Isian Form Laporan Kerusakan Mesin: tanggal, nama mesin, komponen, kerusakan, tindakan, keterangan
export function readDamageInput(body: Record<string, unknown>) {
  const tanggal = parseSheetDate(text(body.tanggal, 10)) ?? fail(400, 'Tanggal wajib diisi.')
  const mesin = text(body.mesin, 150) || fail(400, 'Nama mesin wajib diisi.')
  const kerusakan = text(body.kerusakan, 5000) || fail(400, 'Kerusakan wajib diisi.')
  return {
    tanggal, mesin, mesin_key: machineKey(mesin), komponen: text(body.komponen, 150) || null, kerusakan,
    tindakan: text(body.tindakan, 5000) || null, keterangan: text(body.keterangan, 5000) || null,
  }
}

// Dipakai cron Drive: sinkron otomatis tanpa pengguna
export async function syncDamageSheet() {
  const { entries } = await readDamageSheet(await loadDamageSheetUrl())
  if (!entries.length) return { baris: 0, laporan: 0 }
  return importDamageEntries(entries)
}
