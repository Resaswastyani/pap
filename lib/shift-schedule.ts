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
// Judul kolom tanggal: "1", "2.0", "Hari1", "Hari 2", "Tgl 3"
const dayNumber = (v: string | undefined) => {
  const m = (v ?? '').trim().match(/^(?:hari|h|tgl|tanggal|day)?\s*(\d{1,2})(?:\.0+)?$/i)
  return m ? Number(m[1]) : null
}

// Tanggal sel: angka seri Excel (46296), "2026-10-01", "01/10/2026"
function parseDate(value: string | undefined) {
  const v = (value ?? '').trim()
  let y: number, m: number, d: number
  let match: RegExpMatchArray | null
  if (/^\d{5}(\.\d+)?$/.test(v)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(v)) * 86_400_000)
    ;[y, m, d] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
  } else if ((match = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  else if ((match = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/))) [y, m, d] = [Number(match[3]), Number(match[2]), Number(match[1])]
  else return null
  return y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? { periode: `${y}-${pad(m)}`, day: d } : null
}

// Baris judul kolom: deretan tanggal 1, 2, 3, ... (atau Hari1, Hari2, ...) dengan kolom "Nama" di kirinya.
// Judul kolom kiri bisa berada di baris itu atau baris di atasnya (sel digabung / merge).
function detectHeader(rows: string[][]) {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const row = rows[i]
    const days = new Map<number, number>()
    row.forEach((c, col) => {
      const d = dayNumber(c)
      if (d && d <= 31 && !days.has(d) && (d === 1 || days.has(d - 1))) days.set(d, col)
    })
    if (!days.has(1) || days.size < 7) continue
    const firstDay = days.get(1)!
    const label = (col: number) => norm(row[col]) || norm(rows[i - 1]?.[col])
    const find = (re: RegExp) => Array.from({ length: firstDay }, (_, col) => col).find((col) => re.test(label(col))) ?? -1
    const nama = find(/^nama\b/)
    if (nama < 0) continue
    return {
      index: i, days, lastDay: Math.max(...days.values()),
      cols: {
        no: find(/^(no|no\.|nomor)$/), nama, induk: find(/(kd ?karyawan|kode ?karyawan|induk|nik|nip|id karyawan)/), shift: find(/shift/),
        awal: find(/^(tgl|tanggal) ?(awal|mulai)|^(mulai|start)/), akhir: find(/^(tgl|tanggal) ?(akhir|selesai)|^(selesai|end)/),
      },
    }
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

// Kode jadwal per tanggal: "Shift1" / "Shift 2" / "3" -> "1".."3"; "OFF" / "Libur" / kosong -> "" (libur);
// kode lain (Normal1, Driver1, Cuti, ...) -> huruf kecil tanpa spasi. NO_DATA = tanggal di luar TGLAWAL-TGLAKHIR.
export const NO_DATA = '_'
export function shiftKey(value: string | undefined) {
  const v = (value ?? '').trim().toLowerCase().replace(/\s+/g, '')
  if (!v || ['-', '0', 'off', 'libur', 'l'].includes(v)) return ''
  const m = v.match(/^(?:shift)?(\d)(?:\.0+)?$/)
  return m ? m[1] : v.slice(0, 20)
}

// Tabel "Keterangan" (kode -> jam kerja), mis. Shift 1 | 7.00-15.00, OFF | Libur, Normal1 | 9.00-17.00
export type ShiftCode = { kode: string; label: string; jam: string | null }
const isKeterangan = (cell: string) => /^keterangan\s*:?$/i.test(cell.trim())
function readKeterangan(tabs: SheetTab[]) {
  const list = new Map<string, ShiftCode>()
  for (const tab of tabs) {
    tab.rows.forEach((row, r) => row.forEach((cell, c) => {
      if (!isKeterangan(cell)) return
      for (let rr = r + 1; rr < tab.rows.length; rr++) {
        const label = (tab.rows[rr][c] ?? '').trim()
        if (!label) break
        const jam = tab.rows[rr].slice(c + 1, c + 4).map((x) => x.trim()).find(Boolean) ?? null
        const kode = shiftKey(label)
        if (!list.has(kode)) list.set(kode, { kode, label: label.slice(0, 40), jam: jam?.slice(0, 60) ?? null })
      }
    }))
  }
  return list
}
const DEFAULT_LABEL: Record<string, string> = { '1': 'Shift 1', '2': 'Shift 2', '3': 'Shift 3', '': 'OFF' }
// Urutan: Shift 1-3, kode lain, lalu libur
const codeOrder = (k: string) => (['1', '2', '3'].includes(k) ? Number(k) : k === '' ? 99 : 10)

export type ShiftRow = { urut: number; nama: string; bagian: string | null; nomor_induk: string | null; pilihan_shift: string | null; jadwal: string[] }
export type ParsedSchedule = { periode: string; judul: string | null; tab: string; rows: ShiftRow[]; keterangan: ShiftCode[] }
export type TabInfo = { title: string; periode: string | null; rows: number; note: string | null }

export function parseShiftTabs(tabs: SheetTab[], fallbackPeriode: string) {
  const keterangan = readKeterangan(tabs)
  // Satu jadwal per bulan; bila dua tab berisi bulan yang sama, tab yang lebih akhir dipakai
  const byPeriode = new Map<string, Omit<ParsedSchedule, 'keterangan'> & { seen: Map<string, string> }>()
  const info: TabInfo[] = []
  for (const tab of tabs) {
    const header = detectHeader(tab.rows)
    if (!header) {
      if (!tab.rows.some((row) => row.some(isKeterangan))) {
        info.push({ title: tab.title, periode: null, rows: 0, note: 'Tidak ada kolom Nama dan kolom tanggal (1, 2, ... atau Hari1, Hari2, ...), dilewati.' })
      }
      continue
    }
    const above = tab.rows.slice(0, header.index).flat().filter((c) => c.trim())
    const judul = above.find((c) => /jadwal/i.test(c))?.trim().slice(0, 255) ?? null
    const tabPeriode = findPeriode([...above, tab.title]) ?? fallbackPeriode
    const tabName = tab.title.slice(0, 150)
    const { cols, days, lastDay } = header
    const periods = new Set<string>()
    let count = 0
    for (let r = header.index + 1; r < tab.rows.length; r++) {
      const row = tab.rows[r]
      // Baris rekap "Jumlah / Shift 1 / ..." atau tabel Keterangan di bawah tabel: berhenti
      if (row.slice(0, lastDay + 1).some((c) => /^(jumlah|total)\b/i.test(c.trim()) || isKeterangan(c))) break
      const rawName = (row[cols.nama] ?? '').trim()
      if (!rawName || /^shift\s*\d/i.test(rawName)) continue
      // Format TGLAWAL / TGLAKHIR: Hari1 = TGLAWAL; selain itu Hari1 = tanggal 1 bulan di judul / nama tab
      const start = cols.awal >= 0 ? parseDate(row[cols.awal]) : null
      const end = cols.akhir >= 0 ? parseDate(row[cols.akhir]) : null
      const periode = start?.periode ?? tabPeriode
      const total = daysIn(periode)
      const offset = (start?.day ?? 1) - 1
      const until = end && end.periode === periode ? end.day : total
      if (!periods.has(periode)) {
        byPeriode.set(periode, { periode, judul, tab: tabName, rows: [], seen: new Map() })
        periods.add(periode)
      }
      const schedule = byPeriode.get(periode)!
      const jadwal = Array.from({ length: total }, () => NO_DATA)
      for (const [n, col] of days) {
        const date = offset + n
        if (date > until) continue
        const raw = (row[col] ?? '').trim()
        const kode = shiftKey(raw)
        jadwal[date - 1] = kode
        if (!schedule.seen.has(kode)) schedule.seen.set(kode, raw)
      }
      const { nama, bagian } = splitName(rawName)
      count++
      schedule.rows.push({
        urut: Number.parseInt(row[cols.no] ?? '', 10) || schedule.rows.length + 1,
        nama: nama.slice(0, 150),
        bagian: bagian?.slice(0, 100) ?? null,
        nomor_induk: cols.induk >= 0 ? (row[cols.induk] ?? '').trim().replace(/\.0+$/, '').slice(0, 30) || null : null,
        pilihan_shift: cols.shift >= 0 ? (row[cols.shift] ?? '').trim().slice(0, 30) || null : null,
        jadwal,
      })
    }
    info.push({ title: tab.title, periode: periods.size ? [...periods].sort().join(', ') : null, rows: count, note: count ? null : 'Tidak ada baris karyawan.' })
  }
  const schedules: ParsedSchedule[] = [...byPeriode.values()].sort((a, b) => a.periode.localeCompare(b.periode)).map(({ seen, ...s }) => {
    // Keterangan: kode yang dipakai di jadwal + kode di tabel Keterangan, beserta jamnya
    const codes = [...new Set([...seen.keys(), ...keterangan.keys()])].sort((a, b) => codeOrder(a) - codeOrder(b))
    return {
      ...s,
      keterangan: codes.map((kode) => ({ kode, label: keterangan.get(kode)?.label ?? DEFAULT_LABEL[kode] ?? (seen.get(kode) || kode).slice(0, 40), jam: keterangan.get(kode)?.jam ?? null })),
    }
  })
  return { schedules, tabs: info }
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
        `INSERT INTO shift_schedules (periode, judul, sheet_tab, keterangan, synced_by, synced_at) VALUES (?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), judul = VALUES(judul), sheet_tab = VALUES(sheet_tab), keterangan = VALUES(keterangan), synced_by = VALUES(synced_by), synced_at = NOW()`,
        [s.periode, s.judul, s.tab, JSON.stringify(s.keterangan), userId],
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
type ScheduleRow = RowDataPacket & { id: number; periode: string; judul: string | null; sheet_tab: string | null; keterangan: string | null; synced_at: string; synced_name: string | null }
type RowRow = RowDataPacket & { id: number; urut: number; nama: string; bagian: string | null; nomor_induk: string | null; pilihan_shift: string | null; jadwal: string }

export async function getShiftSchedule(periode: string | null) {
  const [periods] = await db.query<(RowDataPacket & { periode: string })[]>('SELECT periode FROM shift_schedules ORDER BY periode')
  const list = periods.map((p) => p.periode)
  const now = new Date(Date.now() + 7 * 3600e3)
  const thisMonth = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}`
  // Default: bulan ini bila ada, selain itu jadwal terbaru
  const target = periode && /^\d{4}-\d{2}$/.test(periode) ? periode : list.includes(thisMonth) ? thisMonth : list.at(-1) ?? thisMonth
  const [[schedule]] = await db.query<ScheduleRow[]>(
    'SELECT s.id, s.periode, s.judul, s.sheet_tab, s.keterangan, s.synced_at, u.name AS synced_name FROM shift_schedules s LEFT JOIN users u ON u.id = s.synced_by WHERE s.periode = ?',
    [target],
  )
  let rows: RowRow[] = []
  if (schedule) [rows] = await db.query<RowRow[]>('SELECT id, urut, nama, bagian, nomor_induk, pilihan_shift, jadwal FROM shift_schedule_rows WHERE schedule_id = ? ORDER BY urut, id', [schedule.id])
  const total = daysIn(target)
  // Jadwal lama (sebelum ada tabel Keterangan): Shift 1-3 & OFF tanpa jam
  let keterangan: ShiftCode[] = (['1', '2', '3', ''] as const).map((kode) => ({ kode, label: DEFAULT_LABEL[kode], jam: null }))
  try {
    if (schedule?.keterangan) keterangan = JSON.parse(schedule.keterangan)
  } catch {}
  return {
    periode: target,
    periods: list,
    days: total,
    keterangan,
    schedule: schedule ? { judul: schedule.judul, sheet_tab: schedule.sheet_tab, synced_at: schedule.synced_at, synced_name: schedule.synced_name } : null,
    rows: rows.map((r) => {
      let jadwal: string[] = []
      try {
        jadwal = JSON.parse(r.jadwal)
      } catch {}
      return { id: r.id, urut: r.urut, nama: r.nama, bagian: r.bagian, nomor_induk: r.nomor_induk, pilihan_shift: r.pilihan_shift, jadwal: Array.from({ length: total }, (_, i) => jadwal[i] ?? NO_DATA) }
    }),
  }
}
