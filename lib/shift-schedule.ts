// Jadwal Shift karyawan produksi dari spreadsheet "Jadwal Karyawan Produksi" di Google Drive
// (dibaca dengan akun Google yang terhubung di Master Data, sama seperti Kalender Konten).
// Format sheet: judul "JADWAL KARYAWAN PRODUKSI BULAN OKTOBER 2026", baris judul kolom No | Nama | Nomer Induk | Pilihan Shift | 1 | 2 | ... | 31,
// lalu satu baris per karyawan berisi 1 / 2 / 3 (shift) atau kosong (libur). Baris "Jumlah" di bawah dihitung ulang aplikasi.
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { db } from '@/lib/db'
import { readSpreadsheet, spreadsheetId, type SheetTab } from '@/lib/drive'
import { fail } from '@/lib/api'
import type { UserProfile } from '@/lib/users'

const SETTING_KEY = 'jadwal_shift.sheet_url'
export const DEFAULT_SHIFT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1ABcIFeHNp5mADq5alUREayfEUg3vFWZB/edit?usp=drive_link&ouid=116992751279000154130&rtpof=true&sd=true'

export function requireShift(user: UserProfile) {
  if (!user.menus.includes('jadwal-shift')) fail(403, 'Anda tidak punya akses ke Jadwal Shift.')
}
// Sinkron & ganti link: admin, GM, PPIC, HRD, dan kepala divisi Produksi
export const canSyncShift = (user: UserProfile) =>
  user.role.isAdmin || ['general_manager', 'ppic', 'hrd'].includes(user.division.code) || (user.division.code === 'produksi' && user.role.code === 'lead')

export async function loadShiftSheetUrl() {
  const [[row]] = await db.query<(RowDataPacket & { value: string })[]>('SELECT value FROM app_settings WHERE `key` = ?', [SETTING_KEY])
  return row?.value || DEFAULT_SHIFT_SHEET_URL
}
export async function saveShiftSheetUrl(url: string, userId: number) {
  if (!spreadsheetId(url)) fail(400, 'Link spreadsheet tidak valid. Gunakan link "docs.google.com/spreadsheets/d/...".')
  await db.query('INSERT INTO app_settings (`key`, value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)', [SETTING_KEY, url.slice(0, 1000), userId])
}

// ---------- Pembacaan sheet ----------
const MONTHS: Record<string, number> = {
  januari: 1, january: 1, februari: 2, february: 2, maret: 3, march: 3, april: 4, mei: 5, may: 5, juni: 6, june: 6,
  juli: 7, july: 7, agustus: 8, august: 8, september: 9, oktober: 10, october: 10, november: 11, nopember: 11, desember: 12, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, agu: 8, agt: 8, aug: 8, sep: 9, sept: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12,
}
const MONTH_RE = new RegExp(`\\b(${Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|')})\\b[\\s,.-]*(20\\d{2})`, 'i')
const pad = (n: number) => String(n).padStart(2, '0')
const daysIn = (periode: string) => new Date(Date.UTC(Number(periode.slice(0, 4)), Number(periode.slice(5, 7)), 0)).getUTCDate()

function findPeriode(texts: string[]) {
  for (const text of texts) {
    const m = text.match(MONTH_RE)
    if (m) return `${m[2]}-${pad(MONTHS[m[1].toLowerCase()])}`
  }
  return null
}

const norm = (v: string | undefined) => (v ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
const dayNumber = (v: string | undefined) => (/^\d{1,2}(\.0+)?$/.test((v ?? '').trim()) ? Number.parseInt(v!, 10) : null)

// Baris judul kolom: deretan tanggal 1, 2, 3, ... dengan kolom "Nama" di kirinya.
// Judul kolom kiri bisa berada di baris itu atau baris di atasnya (sel digabung / merge).
function detectHeader(rows: string[][]) {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const row = rows[i]
    const days = new Map<number, number>()
    row.forEach((c, col) => {
      const d = dayNumber(c)
      if (d && d <= 31 && !days.has(d) && (d === 1 || days.has(d - 1))) days.set(d, col)
    })
    if (!days.has(1) || days.size < 28) continue
    const firstDay = days.get(1)!
    const label = (col: number) => norm(row[col]) || norm(rows[i - 1]?.[col])
    const find = (re: RegExp) => Array.from({ length: firstDay }, (_, col) => col).find((col) => re.test(label(col))) ?? -1
    const nama = find(/^nama\b/)
    if (nama < 0) continue
    return { index: i, days, cols: { no: find(/^(no|no\.|nomor)$/), nama, induk: find(/(induk|nik|nip|id karyawan)/), shift: find(/shift/) } }
  }
  return null
}

// "SUMARNO - KEBERSIHAN" -> SUMARNO / KEBERSIHAN; "ARI- KASHIFT" -> ARI / KASHIFT; "SIGIT - (TEKNIK)" -> SIGIT / TEKNIK
function splitName(raw: string) {
  const text = raw.replace(/\s+/g, ' ').trim()
  const m = text.match(/^(.*?\S)\s*-\s+(.+)$|^(.*?\S)\s+-\s*(.+)$/)
  const nama = (m ? m[1] ?? m[3] : text).trim()
  const bagian = m ? (m[2] ?? m[4]).replace(/[()]/g, '').trim() : ''
  return { nama, bagian: bagian || null }
}

// Isi sel tanggal: angka shift ("1", "2.0" -> "2"), kosong = libur, kode lain (C, S, I, ...) disimpan apa adanya
function shiftCode(value: string | undefined) {
  const v = (value ?? '').trim().toUpperCase()
  if (!v || v === '-' || v === '0') return ''
  return /^\d+(\.0+)?$/.test(v) ? String(Number.parseInt(v, 10)) : v.slice(0, 4)
}

export type ShiftRow = { urut: number; nama: string; bagian: string | null; nomor_induk: string | null; pilihan_shift: string | null; jadwal: string[] }
export type ParsedSchedule = { periode: string; judul: string | null; tab: string; rows: ShiftRow[] }
export type TabInfo = { title: string; periode: string | null; rows: number; note: string | null }

export function parseShiftTabs(tabs: SheetTab[], fallbackPeriode: string) {
  const schedules: ParsedSchedule[] = []
  const info: TabInfo[] = []
  for (const tab of tabs) {
    const header = detectHeader(tab.rows)
    if (!header) {
      info.push({ title: tab.title, periode: null, rows: 0, note: 'Tidak ada kolom Nama dan tanggal 1-31, dilewati.' })
      continue
    }
    const above = tab.rows.slice(0, header.index).flat().filter((c) => c.trim())
    const judul = above.find((c) => /jadwal/i.test(c)) ?? above[0] ?? null
    const periode = findPeriode([...above, tab.title]) ?? fallbackPeriode
    const total = daysIn(periode)
    const { cols, days } = header
    const rows: ShiftRow[] = []
    for (let r = header.index + 1; r < tab.rows.length; r++) {
      const row = tab.rows[r]
      // Baris rekap "Jumlah / Shift 1 / Shift 2 / Shift 3" di bawah tabel: berhenti
      if (row.slice(0, Math.max(cols.nama, cols.shift) + 1).some((c) => /^(jumlah|total)\b/i.test(c.trim()))) break
      const rawName = (row[cols.nama] ?? '').trim()
      if (!rawName || /^shift\s*\d/i.test(rawName)) continue
      const { nama, bagian } = splitName(rawName)
      rows.push({
        urut: Number.parseInt(row[cols.no] ?? '', 10) || rows.length + 1,
        nama: nama.slice(0, 150),
        bagian: bagian?.slice(0, 100) ?? null,
        nomor_induk: cols.induk >= 0 ? (row[cols.induk] ?? '').trim().replace(/\.0+$/, '').slice(0, 30) || null : null,
        pilihan_shift: cols.shift >= 0 ? (row[cols.shift] ?? '').trim().slice(0, 30) || null : null,
        jadwal: Array.from({ length: total }, (_, i) => (days.has(i + 1) ? shiftCode(row[days.get(i + 1)!]) : '')),
      })
    }
    info.push({ title: tab.title, periode, rows: rows.length, note: rows.length ? null : 'Tidak ada baris karyawan.' })
    if (rows.length) schedules.push({ periode, judul: judul?.trim().slice(0, 255) ?? null, tab: tab.title.slice(0, 150), rows })
  }
  // Dua tab untuk bulan yang sama: tab yang lebih akhir dipakai
  const unique = [...new Map(schedules.map((s) => [s.periode, s])).values()].sort((a, b) => a.periode.localeCompare(b.periode))
  return { schedules: unique, tabs: info }
}

export async function readShiftSheet(url: string) {
  const id = spreadsheetId(url) ?? fail(400, 'Link spreadsheet tidak valid.')
  const tabs = await readSpreadsheet(id)
  const now = new Date(Date.now() + 7 * 3600e3)
  return parseShiftTabs(tabs, `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}`)
}

// Simpan: jadwal bulan yang sama diganti seluruhnya dengan isi sheet terbaru
export async function importShiftSchedules(schedules: ParsedSchedule[], userId: number) {
  const conn: PoolConnection = await db.getConnection()
  try {
    await conn.beginTransaction()
    for (const s of schedules) {
      const [res] = await conn.query<ResultSetHeader>(
        `INSERT INTO shift_schedules (periode, judul, sheet_tab, synced_by, synced_at) VALUES (?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), judul = VALUES(judul), sheet_tab = VALUES(sheet_tab), synced_by = VALUES(synced_by), synced_at = NOW()`,
        [s.periode, s.judul, s.tab, userId],
      )
      const scheduleId = res.insertId
      await conn.query('DELETE FROM shift_schedule_rows WHERE schedule_id = ?', [scheduleId])
      await conn.query(
        'INSERT INTO shift_schedule_rows (schedule_id, urut, nama, bagian, nomor_induk, pilihan_shift, jadwal) VALUES ?',
        [s.rows.map((r) => [scheduleId, r.urut, r.nama, r.bagian, r.nomor_induk, r.pilihan_shift, JSON.stringify(r.jadwal)])],
      )
    }
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
  return { bulan: schedules.length, karyawan: schedules.reduce((n, s) => n + s.rows.length, 0) }
}

// ---------- Tampilan ----------
type ScheduleRow = RowDataPacket & { id: number; periode: string; judul: string | null; sheet_tab: string | null; synced_at: string; synced_name: string | null }
type RowRow = RowDataPacket & { id: number; urut: number; nama: string; bagian: string | null; nomor_induk: string | null; pilihan_shift: string | null; jadwal: string }

export async function getShiftSchedule(periode: string | null) {
  const [periods] = await db.query<(RowDataPacket & { periode: string })[]>('SELECT periode FROM shift_schedules ORDER BY periode')
  const list = periods.map((p) => p.periode)
  const now = new Date(Date.now() + 7 * 3600e3)
  const thisMonth = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}`
  // Default: bulan ini bila ada, selain itu jadwal terbaru
  const target = periode && /^\d{4}-\d{2}$/.test(periode) ? periode : list.includes(thisMonth) ? thisMonth : list.at(-1) ?? thisMonth
  const [[schedule]] = await db.query<ScheduleRow[]>(
    'SELECT s.id, s.periode, s.judul, s.sheet_tab, s.synced_at, u.name AS synced_name FROM shift_schedules s LEFT JOIN users u ON u.id = s.synced_by WHERE s.periode = ?',
    [target],
  )
  let rows: RowRow[] = []
  if (schedule) [rows] = await db.query<RowRow[]>('SELECT id, urut, nama, bagian, nomor_induk, pilihan_shift, jadwal FROM shift_schedule_rows WHERE schedule_id = ? ORDER BY urut, id', [schedule.id])
  const total = daysIn(target)
  return {
    periode: target,
    periods: list,
    days: total,
    schedule: schedule ? { judul: schedule.judul, sheet_tab: schedule.sheet_tab, synced_at: schedule.synced_at, synced_name: schedule.synced_name } : null,
    rows: rows.map((r) => {
      let jadwal: string[] = []
      try {
        jadwal = JSON.parse(r.jadwal)
      } catch {}
      return { id: r.id, urut: r.urut, nama: r.nama, bagian: r.bagian, nomor_induk: r.nomor_induk, pilihan_shift: r.pilihan_shift, jadwal: Array.from({ length: total }, (_, i) => jadwal[i] ?? '') }
    }),
  }
}
