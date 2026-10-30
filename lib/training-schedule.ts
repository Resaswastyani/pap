// Jadwal Training dari spreadsheet Google Drive (mis. "Jadwal Traning Kualitas QC"), cermin hanya baca:
// - tab "Rekap Data": daftar peserta, tanggal training, checklist materi (Jobdesc ttd / Video / PPT), kehadiran
// - tab "BATCH-n": rencana sesi per peserta (sel "Senin 28/7/25 (13.00-15.00)"), catatan di bawah baris "Note :"
// Tab lain diabaikan. Sinkron otomatis bila lebih dari TRAINING_STALE_HOURS jam, atau tombol Sinkron.
import type { RowDataPacket } from 'mysql2'
import { fail } from '@/lib/api'
import { db } from '@/lib/db'
import { driveEnabled, readSpreadsheet, spreadsheetId, type SheetTab } from '@/lib/drive'

export const SCHEDULE_URL_KEY = 'hrd.training_schedule_url'
const SYNC_KEY = 'hrd.training_schedule_synced'

export type RekapRow = { no: string; nama: string; ket: string | null; tanggal: string | null; materi: { jobdesc: boolean; video: boolean; ppt: boolean }; hadir: boolean; kehadiran: string | null }
export type Sesi = { tanggal: string; hari: string | null; jam: string | null; peserta: string[] }
export type Batch = { nama: string; sesi: Sesi[]; belum: string[]; catatan_peserta: { nama: string; catatan: string }[] }
export type Schedule = { judul: string | null; periode: string | null; rekap: RekapRow[]; batches: Batch[]; catatan: string[] }

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()
const checked = (v: unknown) => /^(v|x|y|ya|✓|✔|true|sudah)$/i.test(clean(v))

function splitNama(raw: string) {
  const m = clean(raw).match(/^(.+?)\s*-\s*(.+)$/)
  return m ? { nama: m[1].trim(), ket: m[2].replace(/[()]/g, '').trim() || null } : { nama: clean(raw), ket: null }
}

// 28/07/2025, 04/08/25, 28/7/25 -> YYYY-MM-DD (angka seri Excel bila Sheets API tidak aktif)
export function parseTanggal(raw: unknown) {
  const s = clean(raw)
  const m = s.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/)
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400e3).toISOString().slice(0, 10)
  return null
}

function parseRekap(tab: SheetTab) {
  const h = tab.rows.findIndex((r) => r.some((c) => /^nama$/i.test(clean(c))))
  if (h < 0) return { periode: null, rekap: [] as RekapRow[] }
  const head = tab.rows[h].map(clean)
  const sub = (tab.rows[h + 1] ?? []).map(clean)
  const col = (cells: string[], re: RegExp) => cells.findIndex((c) => re.test(c))
  const nama = col(head, /^nama$/i)
  const no = col(head, /^no\.?$/i)
  const tanggal = col(head, /tanggal/i)
  const kehadiran = col(head, /kehadiran/i)
  const [jobdesc, video, ppt] = [col(sub, /jobdesc/i), col(sub, /video/i), col(sub, /ppt/i)]
  const rekap: RekapRow[] = []
  for (const r of tab.rows.slice(h + 2)) {
    const raw = clean(r[nama])
    if (!raw || (no >= 0 && !/^\d+$/.test(clean(r[no])))) continue
    const hadirText = kehadiran >= 0 ? clean(r[kehadiran]) : ''
    rekap.push({
      no: no >= 0 ? clean(r[no]) : '', ...splitNama(raw), tanggal: tanggal >= 0 ? parseTanggal(r[tanggal]) : null,
      materi: { jobdesc: checked(r[jobdesc]), video: checked(r[video]), ppt: checked(r[ppt]) },
      hadir: /^hadir/i.test(hadirText), kehadiran: hadirText || null,
    })
  }
  return { periode: clean(tab.rows.slice(0, h).flat().find((c) => clean(c))) || null, rekap }
}

function parseBatch(tab: SheetTab) {
  const sesi = new Map<string, Sesi>()
  const belum: string[] = []
  const catatan_peserta: Batch['catatan_peserta'] = []
  const catatan: string[] = []
  let judul: string | null = null
  let inNote = false
  for (const r of tab.rows) {
    const cells = r.map(clean)
    if (inNote) {
      const text = cells.filter(Boolean).join(' ')
      if (text) catatan.push(text)
      continue
    }
    if (cells.some((c) => /^note\s*:?$/i.test(c))) { inNote = true; continue }
    if (!judul) judul = cells.find((c) => /jadwal/i.test(c)) ?? null
    // Baris peserta: nomor lalu nama, sel setelahnya berisi jadwal
    const i = cells.findIndex((c, j) => /^\d+$/.test(c) && /[a-z]/i.test(cells[j + 1] ?? ''))
    if (i < 0) continue
    const { nama } = splitNama(cells[i + 1])
    let terjadwal = false
    for (const cell of cells.slice(i + 2)) {
      if (!cell) continue
      const tanggal = parseTanggal(cell)
      if (!tanggal) {
        if (/[a-z]/i.test(cell)) catatan_peserta.push({ nama, catatan: cell })
        continue
      }
      terjadwal = true
      const jam = cell.match(/\(([^)]+)\)/)?.[1]?.trim() ?? null
      const key = `${tanggal}|${jam ?? ''}`
      if (!sesi.has(key)) sesi.set(key, { tanggal, hari: cell.match(/^([a-z]+)\s/i)?.[1] ?? null, jam, peserta: [] })
      const s = sesi.get(key)!
      if (!s.peserta.includes(nama)) s.peserta.push(nama)
    }
    if (!terjadwal) belum.push(nama)
  }
  const batch: Batch = {
    nama: tab.title.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim(),
    sesi: [...sesi.values()].sort((a, b) => a.tanggal.localeCompare(b.tanggal)),
    belum,
    catatan_peserta,
  }
  return { batch, judul, catatan }
}

export function parseSchedule(tabs: SheetTab[]): Schedule {
  const rekapTab = tabs.find((t) => /rekap/i.test(t.title))
  const { periode, rekap } = rekapTab ? parseRekap(rekapTab) : { periode: null, rekap: [] }
  const parsed = tabs.filter((t) => /^batch/i.test(t.title.trim())).map(parseBatch)
  return {
    judul: parsed.find((p) => p.judul)?.judul ?? null, periode, rekap,
    batches: parsed.map((p) => p.batch),
    catatan: parsed.find((p) => p.catatan.length)?.catatan ?? [],
  }
}

async function setting(key: string) {
  const [[row]] = await db.query<(RowDataPacket & { value: string | null })[]>('SELECT value FROM app_settings WHERE `key` = ?', [key])
  return row?.value ?? ''
}
async function saveSetting(key: string, value: string, userId: number | null) {
  await db.query('INSERT INTO app_settings (`key`, value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)', [key, value, userId])
}
export const loadScheduleUrl = () => setting(SCHEDULE_URL_KEY)
export async function saveScheduleUrl(url: string, userId: number) {
  if (url && !spreadsheetId(url)) fail(400, 'Link tidak valid. Gunakan link Google Spreadsheet (docs.google.com/spreadsheets/d/...).')
  await saveSetting(SCHEDULE_URL_KEY, url.slice(0, 1000), userId)
}
export async function loadScheduleSync(): Promise<{ at: string | null; error: string | null }> {
  try {
    return { at: null, error: null, ...JSON.parse((await setting(SYNC_KEY)) || '{}') }
  } catch {
    return { at: null, error: null }
  }
}
export async function recordScheduleError(message: string) {
  await saveSetting(SYNC_KEY, JSON.stringify({ ...(await loadScheduleSync()), error: message.slice(0, 500) }), null)
}

export async function syncSchedule() {
  const url = await loadScheduleUrl()
  const id = spreadsheetId(url) ?? fail(400, 'Link spreadsheet jadwal training belum diisi.')
  if (!(await driveEnabled())) fail(400, 'Akun Google belum terhubung. Hubungkan di Master Data > Logo & Desain.')
  const data = parseSchedule(await readSpreadsheet(id))
  if (!data.rekap.length && !data.batches.length) fail(502, 'Tab "Rekap Data" / "BATCH" tidak terbaca dari spreadsheet jadwal.')
  const [[{ now }]] = await db.query<(RowDataPacket & { now: string })[]>('SELECT NOW() AS now')
  await db.query('INSERT INTO training_schedule (id, data, synced_at) VALUES (1, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data), synced_at = VALUES(synced_at)', [JSON.stringify(data), now])
  await saveSetting(SYNC_KEY, JSON.stringify({ at: now, error: null }), null)
  return data
}

export async function loadSchedule(): Promise<Schedule | null> {
  const [[row]] = await db.query<(RowDataPacket & { data: string })[]>('SELECT data FROM training_schedule WHERE id = 1')
  return row ? (JSON.parse(row.data) as Schedule) : null
}
