// Absensi karyawan dari laporan kehadiran HRIS Altius (data mesin Fingerspot), diekspor ke Excel lalu
// disinkron dari Google Drive atau diunggah langsung. Kolom dikenali dari judulnya; dua bentuk laporan didukung:
//   - rekap harian : satu baris per karyawan per tanggal (jam masuk, jam pulang, status, terlambat, lembur, shift)
//   - log scan     : satu baris per scan (tanggal + jam); scan pertama = masuk, scan terakhir = pulang
// Jadwal masuk/pulang yang tidak ada di laporan diambil dari Jadwal Shift (kode shift + jam di tabel Keterangan),
// lalu terlambat, pulang cepat, dan lembur dihitung dari jadwal itu.
import type { RowDataPacket } from 'mysql2'
import { fail } from '@/lib/api'
import { db } from '@/lib/db'
import { listDriveFolder, readSpreadsheet, spreadsheetId, type SheetTab } from '@/lib/drive'
import { nameKey, parseDate } from '@/lib/hrd'
import { folderIdFromUrl } from '@/lib/sop'

export const ABSENSI_SETTING = 'hrd.absensi_sheet_url'
export const STATUS = { hadir: 'Hadir', terlambat: 'Terlambat', tidak_hadir: 'Tidak hadir', izin: 'Izin', sakit: 'Sakit', cuti: 'Cuti', dinas: 'Dinas luar', libur: 'Libur', tanpa_scan: 'Scan tidak lengkap' } as const
export type Status = keyof typeof STATUS

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()
const norm = (v: unknown) => clean(v).toLowerCase()
const pad = (n: number) => String(n).padStart(2, '0')

// Jam: "07:55", "7.55", "07:55:12", pecahan hari Excel (0.3298), "2026-10-01 07:55:00" -> "07:55:00"
export function parseTime(value: unknown) {
  const v = clean(value)
  if (!v || v === '-' || v === '--:--') return null
  if (/^0?\.\d+$/.test(v) || /^0(\.\d+)?$/.test(v)) {
    const minutes = Math.round(Number(v) * 1440)
    return minutes > 0 && minutes < 1440 ? `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00` : null
  }
  // Angka seri Excel tanggal+jam (46296.33)
  if (/^\d{5}\.\d+$/.test(v)) return parseTime(String(Number(v) % 1))
  const m = v.match(/(?:^|\s|T)(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?(?:\s*(am|pm))?\s*$/i) ?? v.match(/^(\d{1,2})[:.](\d{2})/)
  if (!m) return null
  let h = Number(m[1])
  if (m[4]) h = (h % 12) + (/pm/i.test(m[4]) ? 12 : 0)
  if (h > 23 || Number(m[2]) > 59) return null
  return `${pad(h)}:${m[2]}:${m[3] ?? '00'}`
}
// Durasi: "00:15" / "0:15:00" = 15 menit, "15" = 15 menit, "1,5 jam" = 90 menit, pecahan hari Excel
export function parseMinutes(value: unknown) {
  const v = norm(value).replace(',', '.')
  if (!v || v === '-') return 0
  let m: RegExpMatchArray | null
  if ((m = v.match(/^(\d{1,3}):(\d{2})(?::\d{2})?$/))) return Number(m[1]) * 60 + Number(m[2])
  if ((m = v.match(/^(\d+(?:\.\d+)?)\s*(jam|j|h|hour)/))) return Math.round(Number(m[1]) * 60)
  if ((m = v.match(/^(\d+(?:\.\d+)?)\s*(menit|mnt|m|min)?$/))) {
    const n = Number(m[1])
    return n > 0 && n < 1 && !m[2] ? Math.round(n * 1440) : Math.round(n)
  }
  return 0
}
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

// Status kehadiran dari tulisan laporan
export function statusOf(value: string): Status | null {
  const v = norm(value)
  if (!v) return null
  if (/terlambat|telat|\blate\b/.test(v)) return 'terlambat'
  if (/sakit|\bsick\b|^s$/.test(v)) return 'sakit'
  if (/cuti|\bleave\b|^c$|^ct$/.test(v)) return 'cuti'
  if (/izin|ijin|permit|^i$/.test(v)) return 'izin'
  if (/dinas|\bdl\b|business trip|tugas luar/.test(v)) return 'dinas'
  if (/libur|\boff\b|holiday|day ?off|^l$/.test(v)) return 'libur'
  if (/alpa|alpha|mangkir|absent|tidak hadir|tanpa keterangan|^a$|^tk$/.test(v)) return 'tidak_hadir'
  if (/hadir|present|masuk|tepat|on ?time|^h$|^ok$/.test(v)) return 'hadir'
  return null
}

type Cols = Record<'nip' | 'nama' | 'depan' | 'belakang' | 'tanggal' | 'waktu' | 'masuk' | 'pulang' | 'shift' | 'jadwalMasuk' | 'jadwalPulang' | 'status' | 'keterangan' | 'terlambat' | 'cepat' | 'lembur', number>
function detectHeader(rows: string[][]): { index: number; cols: Cols } | null {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const header = (rows[i] ?? []).map(norm)
    const used = new Set<number>()
    const find = (re: RegExp, not?: RegExp) => {
      const j = header.findIndex((h, k) => !used.has(k) && re.test(h) && !(not && not.test(h)))
      if (j >= 0) used.add(j)
      return j
    }
    // Urutan penting: kolom jadwal & durasi dikenali dulu agar tidak tertukar dengan jam scan
    const cols = {} as Cols
    cols.nip = find(/^(nip|nik|no\.? ?induk|nomor induk|id karyawan|employee ?id|kode karyawan|kd karyawan)$/)
    cols.depan = find(/^nama depan$/)
    cols.belakang = find(/^nama belakang$/)
    cols.nama = find(/^(nama|nama karyawan|nama lengkap|employee name|employee|name|karyawan)$/)
    cols.jadwalMasuk = find(/(jadwal|schedule|jam kerja|shift).*(masuk|in\b|mulai|start)/)
    cols.jadwalPulang = find(/(jadwal|schedule|jam kerja|shift).*(pulang|keluar|out\b|selesai|end)/)
    cols.terlambat = find(/terlambat|telat|\blate\b/)
    cols.cepat = find(/pulang cepat|early/)
    cols.lembur = find(/lembur|overtime/)
    cols.masuk = find(/(jam|waktu|absen|scan|check|clock|time)\s*-?\s*(masuk|in)\b|^masuk$|^check ?in$|^clock ?in$|^in$/)
    cols.pulang = find(/(jam|waktu|absen|scan|check|clock|time)\s*-?\s*(pulang|keluar|out)\b|^(pulang|keluar)$|^check ?out$|^clock ?out$|^out$/)
    cols.tanggal = find(/^(tanggal|tgl|date|tanggal absen|hari\/tanggal|hari, tanggal|tanggal kehadiran)$/)
    cols.waktu = find(/^(jam|waktu|time|jam absen|waktu absen|waktu scan|jam scan|scan|tanggal & jam|tanggal dan jam|datetime)$/)
    cols.shift = find(/^(shift|jadwal|jadwal kerja|nama shift|kode shift|schedule)$/)
    cols.status = find(/^(status|status kehadiran|kehadiran|attendance|tipe kehadiran|status absen)$/)
    cols.keterangan = find(/^(keterangan|catatan|note|notes|remark|alasan)$/)
    const hasName = cols.nama >= 0 || cols.depan >= 0
    const hasWhen = cols.tanggal >= 0 || cols.waktu >= 0
    if ((cols.nip >= 0 || hasName) && hasWhen && (cols.masuk >= 0 || cols.waktu >= 0 || cols.status >= 0)) return { index: i, cols }
  }
  return null
}

export type DayRow = {
  nip: string; nama: string; tanggal: string; shift: string | null; jadwal_masuk: string | null; jadwal_pulang: string | null; jam_masuk: string | null; jam_pulang: string | null
  scan: number | null; status_asli: string | null; keterangan: string | null; terlambat_menit: number | null; pulang_cepat_menit: number | null; lembur_menit: number | null
}

export function parseAttendanceTabs(tabs: SheetTab[]) {
  const days = new Map<string, DayRow>()
  const info: { title: string; format: 'rekap' | 'log' | null; rows: number }[] = []
  for (const tab of tabs) {
    const header = detectHeader(tab.rows)
    if (!header) {
      info.push({ title: tab.title, format: null, rows: 0 })
      continue
    }
    const c = header.cols
    const at = (row: string[], j: number) => (j >= 0 ? clean(row[j]) : '')
    const isLog = c.masuk < 0 && c.pulang < 0 && c.waktu >= 0
    let count = 0
    for (let r = header.index + 1; r < tab.rows.length; r++) {
      const row = tab.rows[r] ?? []
      const nama = (at(row, c.nama) || [at(row, c.depan), at(row, c.belakang)].filter(Boolean).join(' ')).slice(0, 150)
      const nip = at(row, c.nip).replace(/\.0+$/, '').slice(0, 30) || (nama ? `nama:${nameKey(nama)}` : '')
      // Tanggal bisa di kolom tanggal atau menyatu dengan jam ("2026-10-01 07:55:00")
      const tanggal = parseDate(at(row, c.tanggal).replace(/^[a-z]+,?\s+/i, '')) ?? parseDate(at(row, c.waktu).split(/[ T]/)[0])
      if (!nip || !tanggal) continue
      count++
      const key = `${nip}|${tanggal}`
      const day = days.get(key) ?? {
        nip, nama, tanggal, shift: null, jadwal_masuk: null, jadwal_pulang: null, jam_masuk: null, jam_pulang: null, scan: null,
        status_asli: null, keterangan: null, terlambat_menit: null, pulang_cepat_menit: null, lembur_menit: null,
      }
      if (isLog) {
        const t = parseTime(at(row, c.waktu))
        if (t) {
          day.scan = (day.scan ?? 0) + 1
          if (!day.jam_masuk || t < day.jam_masuk) day.jam_masuk = t
          if (!day.jam_pulang || t > day.jam_pulang) day.jam_pulang = t
        }
      } else {
        day.jam_masuk = parseTime(at(row, c.masuk)) ?? day.jam_masuk
        day.jam_pulang = parseTime(at(row, c.pulang)) ?? day.jam_pulang
      }
      day.shift = at(row, c.shift).slice(0, 60) || day.shift
      day.jadwal_masuk = parseTime(at(row, c.jadwalMasuk)) ?? day.jadwal_masuk
      day.jadwal_pulang = parseTime(at(row, c.jadwalPulang)) ?? day.jadwal_pulang
      // Kolom shift berisi rentang jam, mis. "07:00 - 15:00"
      const range = at(row, c.shift).match(/(\d{1,2}[:.]\d{2})\s*[-–s/d]+\s*(\d{1,2}[:.]\d{2})/)
      if (range) {
        day.jadwal_masuk ??= parseTime(range[1])
        day.jadwal_pulang ??= parseTime(range[2])
      }
      day.status_asli = at(row, c.status).slice(0, 60) || day.status_asli
      day.keterangan = [day.keterangan, at(row, c.keterangan)].filter(Boolean).join(' · ').slice(0, 500) || null
      if (c.terlambat >= 0 && at(row, c.terlambat)) day.terlambat_menit = parseMinutes(at(row, c.terlambat))
      if (c.cepat >= 0 && at(row, c.cepat)) day.pulang_cepat_menit = parseMinutes(at(row, c.cepat))
      if (c.lembur >= 0 && at(row, c.lembur)) day.lembur_menit = parseMinutes(at(row, c.lembur))
      days.set(key, day)
    }
    info.push({ title: tab.title, format: isLog ? 'log' : 'rekap', rows: count })
  }
  // Log dengan satu scan: belum ada jam pulang
  for (const d of days.values()) if (d.scan === 1) d.jam_pulang = null
  return { days: [...days.values()], tabs: info }
}

// ---------- Jadwal dari menu Jadwal Shift ----------
type ShiftInfo = { kode: string; label: string; masuk: string | null; pulang: string | null }
async function shiftLookup(days: DayRow[]) {
  const periods = [...new Set(days.map((d) => d.tanggal.slice(0, 7)))]
  if (!periods.length) return () => null
  const [schedules] = await db.query<(RowDataPacket & { id: number; periode: string; keterangan: string | null })[]>('SELECT id, periode, keterangan FROM shift_schedules WHERE periode IN (?)', [periods])
  if (!schedules.length) return () => null
  const [rows] = await db.query<(RowDataPacket & { schedule_id: number; nama: string; nomor_induk: string | null; jadwal: string })[]>(
    'SELECT schedule_id, nama, nomor_induk, jadwal FROM shift_schedule_rows WHERE schedule_id IN (?)', [schedules.map((s) => s.id)],
  )
  const byPeriode = new Map(schedules.map((s) => {
    const codes = new Map<string, ShiftInfo>()
    for (const k of (s.keterangan ? JSON.parse(s.keterangan) : []) as { kode: string; label: string; jam: string | null }[]) {
      const m = (k.jam ?? '').match(/(\d{1,2}[:.]\d{2})\s*[-–]\s*(\d{1,2}[:.]\d{2})/)
      codes.set(k.kode, { kode: k.kode, label: k.label, masuk: m ? parseTime(m[1]) : null, pulang: m ? parseTime(m[2]) : null })
    }
    const people = rows.filter((r) => r.schedule_id === s.id).map((r) => ({ nip: r.nomor_induk, key: nameKey(r.nama), jadwal: JSON.parse(r.jadwal) as string[] }))
    return [s.periode, { codes, people }]
  }))
  return (d: DayRow): ShiftInfo | null => {
    const p = byPeriode.get(d.tanggal.slice(0, 7))
    if (!p) return null
    const key = nameKey(d.nama)
    const person = p.people.find((x) => x.nip && x.nip === d.nip) ?? p.people.find((x) => x.key === key)
    const kode = person?.jadwal[Number(d.tanggal.slice(8, 10)) - 1]
    if (kode === undefined || kode === '_') return null
    return p.codes.get(kode) ?? { kode, label: kode === '' ? 'OFF' : kode, masuk: null, pulang: null }
  }
}

// Status & menit dihitung bila laporan tidak memuatnya
export function finalize(d: DayRow, shift: ShiftInfo | null) {
  const jadwalMasuk = d.jadwal_masuk ?? shift?.masuk ?? null
  const jadwalPulang = d.jadwal_pulang ?? shift?.pulang ?? null
  // Hari libur mengikuti Jadwal Shift (tidak semua karyawan libur hari Minggu). Laporan Altius menandai setiap Minggu "Libur"
  // untuk semua karyawan; bila Jadwal Shift berisi shift kerja di tanggal itu, hari itu dihitung hari kerja.
  const shiftLabel = shift?.label ?? d.shift ?? null
  const fromReport = !!(d.shift || d.jadwal_masuk || d.jadwal_pulang)
  const libur = shift ? shift.kode === '' : fromReport ? statusOf(d.shift ?? '') === 'libur' : statusOf(shiftLabel ?? '') === 'libur'
  let status = statusOf(d.status_asli ?? '')
  // "Libur" dari laporan tapi ada scan, atau Jadwal Shift berisi shift kerja: status dihitung ulang (hadir / terlambat / tidak hadir)
  if (status === 'libur' && (d.jam_masuk || (shift && shift.kode !== ''))) status = null
  let terlambat = d.terlambat_menit
  let cepat = d.pulang_cepat_menit
  let lembur = d.lembur_menit
  // Shift malam (masuk 23.00, pulang 07.00): jam pulang dihitung di hari berikutnya
  const overnight = jadwalMasuk && jadwalPulang && jadwalPulang < jadwalMasuk
  const minutesOf = (t: string, ref: 'masuk' | 'pulang') => toMin(t) + (overnight && ref === 'pulang' && toMin(t) < toMin(jadwalMasuk!) ? 1440 : 0)
  if (terlambat === null && d.jam_masuk && jadwalMasuk) terlambat = Math.max(0, toMin(d.jam_masuk) - toMin(jadwalMasuk))
  if (cepat === null && d.jam_pulang && jadwalPulang && d.jam_masuk) cepat = Math.max(0, minutesOf(jadwalPulang, 'pulang') - minutesOf(d.jam_pulang, 'pulang'))
  // Lembur: pulang lebih dari 30 menit setelah jadwal (dibulatkan per 30 menit); hari libur = seluruh jam kerja
  if (lembur === null && d.jam_masuk && d.jam_pulang) {
    if (libur) lembur = Math.max(0, minutesOf(d.jam_pulang, 'pulang') - toMin(d.jam_masuk) + (d.jam_pulang < d.jam_masuk ? 1440 : 0))
    else if (jadwalPulang) {
      const extra = minutesOf(d.jam_pulang, 'pulang') - minutesOf(jadwalPulang, 'pulang')
      lembur = extra >= 30 ? Math.floor(extra / 30) * 30 : 0
    }
  }
  if (!status || (status === 'hadir' && (terlambat ?? 0) > 0)) {
    if (d.jam_masuk && (terlambat ?? 0) > 0) status = 'terlambat'
    else if (d.jam_masuk) status = status ?? (d.scan === 1 ? 'tanpa_scan' : 'hadir')
    else if (libur) status = 'libur'
    else status = status ?? 'tidak_hadir'
  }
  return {
    ...d, shift: shiftLabel, jadwal_masuk: jadwalMasuk, jadwal_pulang: jadwalPulang, status,
    terlambat_menit: Math.min(terlambat ?? 0, 65535), pulang_cepat_menit: Math.min(cepat ?? 0, 65535), lembur_menit: Math.min(lembur ?? 0, 65535),
  }
}

export async function importAttendance(days: DayRow[], sumber: 'drive' | 'upload') {
  if (!days.length) fail(400, 'Tidak ada data kehadiran yang dikenali. Pastikan ada kolom NIP / Nama, Tanggal, dan Jam Masuk / Jam (scan) atau Status.')
  const lookup = await shiftLookup(days)
  // NIP dari Data Karyawan untuk baris yang hanya punya nama
  const [emps] = await db.query<(RowDataPacket & { nip: string; nama_key: string })[]>('SELECT nip, nama_key FROM employees ORDER BY tgl_berhenti IS NOT NULL')
  const nipOf = new Map<string, string>()
  for (const e of emps) if (!nipOf.has(e.nama_key)) nipOf.set(e.nama_key, e.nip)
  const rows = days.map((d) => {
    const nip = d.nip.startsWith('nama:') ? nipOf.get(d.nip.slice(5)) ?? d.nip.slice(0, 30) : d.nip
    return finalize({ ...d, nip }, lookup(d))
  })
  for (let i = 0; i < rows.length; i += 500) {
    await db.query(
      `INSERT INTO attendance_days (nip, nama, nama_key, tanggal, shift, jadwal_masuk, jadwal_pulang, jam_masuk, jam_pulang, scan, status, status_asli, keterangan,
         terlambat_menit, pulang_cepat_menit, lembur_menit, sumber) VALUES ?
       ON DUPLICATE KEY UPDATE nama = VALUES(nama), nama_key = VALUES(nama_key), shift = VALUES(shift), jadwal_masuk = VALUES(jadwal_masuk), jadwal_pulang = VALUES(jadwal_pulang),
         jam_masuk = VALUES(jam_masuk), jam_pulang = VALUES(jam_pulang), scan = VALUES(scan), status = VALUES(status), status_asli = VALUES(status_asli),
         keterangan = VALUES(keterangan), terlambat_menit = VALUES(terlambat_menit), pulang_cepat_menit = VALUES(pulang_cepat_menit), lembur_menit = VALUES(lembur_menit), sumber = VALUES(sumber)`,
      [rows.slice(i, i + 500).map((d) => [d.nip, d.nama, nameKey(d.nama), d.tanggal, d.shift, d.jadwal_masuk, d.jadwal_pulang, d.jam_masuk, d.jam_pulang, d.scan, d.status,
        d.status_asli, d.keterangan, d.terlambat_menit, d.pulang_cepat_menit, d.lembur_menit, sumber])],
    )
  }
  await db.query("INSERT INTO app_settings (`key`, value) VALUES ('hrd.absensi_synced_at', NOW()) ON DUPLICATE KEY UPDATE value = NOW()")
  const dates = rows.map((d) => d.tanggal).sort()
  // Izin / cuti yang sudah disetujui ditandai lagi (data mesin menimpa status hari itu)
  if (dates.length) await (await import('@/lib/leave')).applyLeaves(undefined, { dari: dates[0], sampai: dates.at(-1)! })
  return { baris: rows.length, karyawan: new Set(rows.map((d) => d.nip)).size, dari: dates[0], sampai: dates.at(-1) }
}

export async function readAttendanceSheet(url: string) {
  const id = spreadsheetId(url) ?? fail(400, 'Link spreadsheet absensi belum diisi.')
  return parseAttendanceTabs(await readSpreadsheet(id))
}

// ---------- Folder Google Drive berisi file laporan kehadiran ----------
// Sumber bisa satu spreadsheet atau satu folder: tiap file Google Sheet / Excel (.xlsx) di folder (dan satu tingkat subfolder)
// dibaca. Sinkron hanya memproses file baru / berubah (dicatat per file: waktu diubah di Drive).
const FILES_KEY = 'hrd.absensi_files'
const SHEET_MIME = 'application/vnd.google-apps.spreadsheet'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const isAttendanceFolder = (url: string) => !!folderIdFromUrl(url) && !spreadsheetId(url)

type FolderFile = { id: string; name: string; modified: string | null; folder: string | null; jenis: 'sheet' | 'xlsx' | 'lain' }
export async function listAttendanceFiles(url: string) {
  const rootId = folderIdFromUrl(url) ?? fail(400, 'Link folder absensi tidak valid.')
  const out: FolderFile[] = []
  const kind = (mime: string, name: string): FolderFile['jenis'] => (mime === SHEET_MIME ? 'sheet' : mime === XLSX_MIME || /\.xlsx$/i.test(name) ? 'xlsx' : 'lain')
  for (const item of await listDriveFolder(rootId)) {
    if (item.isFolder) {
      for (const sub of await listDriveFolder(item.id)) {
        if (!sub.isFolder) out.push({ id: sub.id, name: sub.name, modified: sub.modified, folder: item.name, jenis: kind(sub.mimeType, sub.name) })
      }
    } else out.push({ id: item.id, name: item.name, modified: item.modified, folder: null, jenis: kind(item.mimeType, item.name) })
  }
  return out.sort((a, b) => (a.modified ?? '').localeCompare(b.modified ?? ''))
}

async function processedFiles(): Promise<Record<string, string>> {
  const [[row]] = await db.query<(RowDataPacket & { value: string | null })[]>('SELECT value FROM app_settings WHERE `key` = ?', [FILES_KEY])
  try {
    return JSON.parse(row?.value ?? '{}')
  } catch {
    return {}
  }
}

// Pratinjau folder: file yang dikenali + status (baru / berubah / sudah disinkron)
export async function previewAttendanceFolder(url: string) {
  const files = await listAttendanceFiles(url)
  const done = await processedFiles()
  return files.map((f) => ({ ...f, status: f.jenis === 'lain' ? 'dilewati' : done[f.id] === (f.modified ?? '') ? 'sudah' : done[f.id] ? 'berubah' : 'baru' }))
}

// Sinkron folder: file baru / berubah dibaca & diimpor (dalam batas waktu; sisanya pada sinkron berikutnya). all = baca ulang semua.
export async function syncAttendanceFolder(url: string, sumber: 'drive' | 'upload' = 'drive', { all = false, budgetMs = 40_000 } = {}) {
  const deadline = Date.now() + budgetMs
  const files = (await listAttendanceFiles(url)).filter((f) => f.jenis !== 'lain')
  const done = await processedFiles()
  const pending = files.filter((f) => all || done[f.id] !== (f.modified ?? ''))
  const hasil: { file: string; baris: number; error?: string }[] = []
  let baris = 0
  const karyawan = new Set<string>()
  const tanggal: string[] = []
  for (const f of pending) {
    if (Date.now() > deadline) break
    try {
      const parsed = parseAttendanceTabs(await readSpreadsheet(f.id))
      if (parsed.days.length) {
        const r = await importAttendance(parsed.days, sumber)
        baris += r.baris
        parsed.days.forEach((d) => { karyawan.add(d.nip); tanggal.push(d.tanggal) })
      }
      hasil.push({ file: f.name, baris: parsed.days.length })
      done[f.id] = f.modified ?? ''
    } catch (error) {
      hasil.push({ file: f.name, baris: 0, error: (error as Error).message.slice(0, 200) })
    }
    await db.query('INSERT INTO app_settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)', [FILES_KEY, JSON.stringify(done)])
  }
  tanggal.sort()
  return {
    file: files.length, diproses: hasil.length, tersisa: pending.length - hasil.length, baris, karyawan: karyawan.size,
    dari: tanggal[0] ?? null, sampai: tanggal.at(-1) ?? null, hasil,
  }
}

// ---------- Penyesuaian dengan Jadwal Shift ----------
// Absensi tersimpan disamakan dengan Jadwal Shift: label shift & status libur / tidak hadir.
// Bulan tanpa Jadwal Shift memakai pola hari libur rutin karyawan dari jadwal bulan lain (label "OFF" / "Masuk");
// karyawan yang tidak pernah ada di Jadwal Shift tidak diubah (tetap libur hari Minggu).
export async function applyShiftSchedule(periods?: string[]) {
  const [rows] = await db.query<(RowDataPacket & { id: number; nip: string; nama: string; tanggal: string; shift: string | null; status: Status; jam_masuk: string | null; terlambat_menit: number; scan: number | null })[]>(
    // Hari yang ditandai dari pengajuan Izin & Cuti tidak dihitung ulang
    `SELECT id, nip, nama, DATE_FORMAT(tanggal, '%Y-%m-%d') AS tanggal, shift, status, jam_masuk, terlambat_menit, scan FROM attendance_days
     WHERE leave_id IS NULL ${periods?.length ? "AND DATE_FORMAT(tanggal, '%Y-%m') IN (?)" : ''}`,
    periods?.length ? [periods] : [],
  )
  if (!rows.length) return { diperbarui: 0 }
  const lookup = await shiftLookup(rows.map((r) => ({ nip: r.nip, nama: r.nama, tanggal: r.tanggal }) as DayRow))
  const { loadRestInfo } = await import('@/lib/payroll-weekly')
  const restOf = await loadRestInfo()
  const changes: [string | null, Status, number][] = []
  for (const r of rows) {
    let sh = lookup({ nip: r.nip, nama: r.nama, tanggal: r.tanggal } as DayRow)
    if (!sh) {
      // Tanpa jadwal di bulan itu: pola libur rutin dari Jadwal Shift bulan lain
      const rest = restOf(r.nip, r.nama)
      if (rest.source !== 'jadwal') continue
      const off = rest.dates.get(r.tanggal) ?? new Date(`${r.tanggal}T00:00:00Z`).getUTCDay() === rest.offDay
      sh = off ? { kode: '', label: 'OFF', masuk: null, pulang: null } : { kode: 'masuk', label: r.shift && !/^(off|libur)/i.test(r.shift) ? r.shift : 'Masuk', masuk: null, pulang: null }
    }
    let status = r.status
    if (r.jam_masuk) {
      if (status === 'libur' || status === 'tidak_hadir') status = r.terlambat_menit > 0 && sh.kode !== '' ? 'terlambat' : r.scan === 1 ? 'tanpa_scan' : 'hadir'
    } else if (sh.kode === '') {
      if (status === 'tidak_hadir' || status === 'hadir') status = 'libur'
    } else if (status === 'libur') status = 'tidak_hadir'
    if (status !== r.status || sh.label !== r.shift) changes.push([sh.label, status, r.id])
  }
  for (let i = 0; i < changes.length; i += 300) {
    const part = changes.slice(i, i + 300)
    await db.query(
      `UPDATE attendance_days SET shift = CASE id ${part.map(() => 'WHEN ? THEN ?').join(' ')} END, status = CASE id ${part.map(() => 'WHEN ? THEN ?').join(' ')} END WHERE id IN (?)`,
      [...part.flatMap(([label, , id]) => [id, label]), ...part.flatMap(([, status, id]) => [id, status]), part.map(([, , id]) => id)],
    )
  }
  return { diperbarui: changes.length }
}
