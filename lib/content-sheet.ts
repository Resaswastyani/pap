// Impor Kalender Konten dari Google Sheet "konten planning" (dibaca dengan akun Google yang terhubung di Master Data).
// Kolom dikenali dari judul kolomnya (bebas urutan, di tab mana pun); baris tanpa tanggal atau judul dilewati.
// Baris dikenali ulang lewat kunci tanggal + judul + platform, sehingga sinkron berulang memperbarui, bukan menggandakan.
import { createHash } from 'node:crypto'
import type { RowDataPacket } from 'mysql2'
import { db } from '@/lib/db'
import { readSpreadsheet, spreadsheetId } from '@/lib/drive'
import { CONTENT_TYPES, PLATFORMS, type ContentStatus } from '@/lib/content'
import { fail } from '@/lib/api'

export const DEFAULT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1V15XU6zd7DnQ0E-ewb98mnKK9fVvTL_1Jx4_TsW9aec/edit?usp=sharing'
const SETTING_KEY = 'konten.sheet_url'

export async function loadSheetUrl() {
  const [[row]] = await db.query<(RowDataPacket & { value: string })[]>('SELECT value FROM app_settings WHERE `key` = ?', [SETTING_KEY])
  return row?.value || DEFAULT_SHEET_URL
}
export async function saveSheetUrl(url: string, userId: number) {
  if (!spreadsheetId(url)) fail(400, 'Link Google Sheet tidak valid.')
  await db.query('INSERT INTO app_settings (`key`, value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)', [SETTING_KEY, url.slice(0, 1000), userId])
}

// ---------- Pengenalan kolom ----------
type Field = 'tanggal' | 'jam' | 'judul' | 'platform' | 'jenis' | 'caption' | 'status' | 'tujuan' | 'target_sektor' | 'link_hasil' | 'pic' | 'catatan'
const FIELD_PATTERNS: [Field, RegExp][] = [
  ['jam', /^(jam|waktu|pukul|time)\b/],
  ['tanggal', /(tanggal|tgl|jadwal|date|posting date|hari)/],
  ['caption', /(caption|copywriting|copy|naskah|script|detail|deskripsi|description)/],
  ['platform', /(platform|channel|sosmed|media sosial|akun)/],
  ['jenis', /(jenis|format|tipe|type)/],
  ['status', /(status|progress|progres)/],
  ['link_hasil', /(link|url)/],
  ['pic', /(^pic\b|penanggung|admin|desainer|designer|editor)/],
  ['tujuan', /(tujuan|objective|goal|pilar|pillar|kategori)/],
  ['target_sektor', /(sektor|segmen|target|audiens|audience|produk)/],
  ['judul', /(judul|topik|tema|ide|konten|content|title|headline|materi)/],
  ['catatan', /(catatan|note|keterangan|ket\b|brief)/],
]
export type Mapping = Partial<Record<Field, number>>

function detectHeader(rows: string[][]) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const mapping: Mapping = {}
    rows[i].forEach((raw, col) => {
      const h = raw.toLowerCase().replace(/\s+/g, ' ').trim()
      if (!h) return
      const hit = FIELD_PATTERNS.find(([f, re]) => mapping[f] === undefined && re.test(h))
      if (hit) mapping[hit[0]] = col
    })
    if (mapping.tanggal !== undefined && (mapping.judul !== undefined || mapping.caption !== undefined)) return { index: i, mapping }
  }
  return null
}

// ---------- Nilai ----------
const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, mar: 3, maret: 3, march: 3, apr: 4, april: 4, mei: 5, may: 5,
  jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, agu: 8, agt: 8, agustus: 8, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10, oct: 10, october: 10, nov: 11, november: 11, des: 12, desember: 12, dec: 12, december: 12,
}
const pad = (n: number) => String(n).padStart(2, '0')

// "19/10/2026", "19-10-26", "2026-10-19", "Senin, 19 Oktober 2026", "19 Okt" (tahun dari defaultYear)
export function parseSheetDate(value: string, defaultYear: number) {
  const v = value.trim().toLowerCase()
  if (!v) return null
  let y: number, m: number, d: number
  let match = v.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  else if ((match = v.match(/(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/))) {
    d = Number(match[1]); m = Number(match[2]); y = match[3] ? Number(match[3]) : defaultYear
  } else if ((match = v.match(/(\d{1,2})\s+([a-z]+)\.?(?:\s+(\d{4}))?/)) && MONTHS[match[2]]) {
    d = Number(match[1]); m = MONTHS[match[2]]; y = match[3] ? Number(match[3]) : defaultYear
  } else return null
  if (y < 100) y += 2000
  // Format bulan/tanggal (US), mis. 10/19/2026
  if (m > 12 && d <= 12) [d, m] = [m, d]
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return `${y}-${pad(m)}-${pad(d)}`
}
function parseTime(value: string | undefined) {
  const m = (value ?? '').match(/(\d{1,2})[.:](\d{2})/)
  return m && Number(m[1]) < 24 ? `${pad(Number(m[1]))}:${m[2]}:00` : '10:00:00'
}

const PLATFORM_WORDS: [keyof typeof PLATFORMS, RegExp][] = [
  ['instagram', /\b(ig|insta|instagram)\b/], ['tiktok', /\b(tiktok|tik tok|tt)\b/], ['facebook', /\b(fb|facebook|meta)\b/],
  ['whatsapp', /\b(wa|whatsapp|blast)\b/], ['marketplace', /(shopee|tokopedia|tokped|marketplace|lazada)/],
  ['google', /(google|gmaps|maps|ads)/], ['website', /(web|website|blog|seo)/],
]
function platformsOf(value: string, fallback: keyof typeof PLATFORMS) {
  const v = value.toLowerCase()
  const found = PLATFORM_WORDS.filter(([, re]) => re.test(v)).map(([p]) => p)
  return found.length ? found : [fallback]
}
function jenisOf(value: string, fallback: keyof typeof CONTENT_TYPES): keyof typeof CONTENT_TYPES {
  const v = value.toLowerCase()
  if (/reel/.test(v)) return 'reels'
  if (/story|stories/.test(v)) return 'story'
  if (/artikel|article|blog/.test(v)) return 'artikel'
  if (/iklan|ads|boost|promote/.test(v)) return 'iklan'
  if (/blast/.test(v)) return 'blasting'
  if (/video|vlog|youtube/.test(v)) return 'video'
  if (/feed|post|car[a-z]*ousel|foto|photo|single|gambar|desain/.test(v)) return 'feed'
  return fallback
}
function statusOf(value: string): ContentStatus {
  const v = value.toLowerCase()
  if (/batal|cancel|skip/.test(v)) return 'batal'
  if (/tayang|posted|upload|publish|sudah/.test(v)) return 'tayang'
  if (/done|selesai|siap|ready|schedul|approved|acc/.test(v)) return 'siap'
  if (/desain|design|produksi|proses|editing|edit|take|shoot|progress/.test(v)) return 'produksi'
  return 'ide' // termasuk Paused
}

export type SheetPlan = {
  key: string; ref: string; tanggal: string; jadwal_tayang: string; judul: string; platform: keyof typeof PLATFORMS; jenis: keyof typeof CONTENT_TYPES
  status: ContentStatus; caption: string | null; tujuan: string | null; target_sektor: string | null; link_hasil: string | null; catatan: string | null
}

export async function readContentSheet(url: string) {
  const id = spreadsheetId(url) ?? fail(400, 'Link Google Sheet tidak valid.')
  const tabs = await readSpreadsheet(id)
  const year = new Date(Date.now() + 7 * 3600e3).getUTCFullYear()
  const plans: SheetPlan[] = []
  const tabInfo: { title: string; header: string[] | null; mapped: Partial<Record<Field, string>>; rows: number; skipped: number }[] = []
  for (const tab of tabs) {
    const found = detectHeader(tab.rows)
    if (!found) {
      tabInfo.push({ title: tab.title, header: null, mapped: {}, rows: 0, skipped: 0 })
      continue
    }
    const { index, mapping } = found
    const header = tab.rows[index]
    const get = (row: string[], f: Field) => {
      if (mapping[f] === undefined) return ''
      const v = (row[mapping[f]!] ?? '').trim()
      return v.toLowerCase() === (header[mapping[f]!] ?? '').trim().toLowerCase() ? '' : v
    }
    let rows = 0
    let skipped = 0
    // Tahun dari judul tab (mis. "Oktober 2026") bila tanggal di sheet tanpa tahun
    const tabYear = Number(tab.title.match(/20\d{2}/)?.[0] ?? year)
    // Tab Artikel = artikel website; tab lain = konten sosmed (diunggah ke IG, FB, TikTok)
    const isArtikel = /artikel|article|blog/i.test(tab.title)
    const defaultPlatform: keyof typeof PLATFORMS = isArtikel ? 'website' : 'sosmed'
    const defaultJenis: keyof typeof CONTENT_TYPES = isArtikel ? 'artikel' : 'feed'
    for (let r = index + 1; r < tab.rows.length; r++) {
      const row = tab.rows[r]
      if (!row.some((c) => c.trim())) continue
      const tanggal = parseSheetDate(get(row, 'tanggal'), tabYear)
      const judul = (get(row, 'judul') || get(row, 'caption').split(/\r?\n/)[0] || '').slice(0, 255)
      if (!tanggal || !judul) {
        skipped++
        continue
      }
      rows++
      const extra = [get(row, 'pic') && `PIC: ${get(row, 'pic')}`, get(row, 'catatan')].filter(Boolean).join('\n')
      for (const platform of platformsOf(get(row, 'platform'), defaultPlatform)) {
        const key = createHash('sha1').update(`${tanggal}|${judul.toLowerCase()}|${platform}`).digest('hex')
        plans.push({
          key, ref: `${tab.title}!${r + 1}`, tanggal, jadwal_tayang: `${tanggal} ${parseTime(get(row, 'jam'))}`, judul, platform,
          jenis: jenisOf(`${get(row, 'jenis')} ${get(row, 'platform')}`, defaultJenis), status: statusOf(get(row, 'status')),
          caption: get(row, 'caption').slice(0, 10000) || null, tujuan: (get(row, 'tujuan') || (/reel|car[a-z]*ousel/i.test(get(row, 'jenis')) ? '' : get(row, 'jenis'))).slice(0, 255) || null,
          target_sektor: get(row, 'target_sektor').slice(0, 255) || null, link_hasil: get(row, 'link_hasil').slice(0, 1000) || null,
          catatan: extra.slice(0, 5000) || null,
        })
      }
    }
    const mapped = Object.fromEntries(Object.entries(mapping).map(([f, col]) => [f, header[col!]])) as Partial<Record<Field, string>>
    tabInfo.push({ title: tab.title, header, mapped, rows, skipped })
  }
  // Kunci ganda (baris sama persis) cukup sekali
  const unique = [...new Map(plans.map((p) => [p.key, p])).values()]
  return { tabs: tabInfo, plans: unique }
}

// Tandai baru / sudah ada (untuk pratinjau)
export async function existingKeys(keys: string[]) {
  if (!keys.length) return new Set<string>()
  const [rows] = await db.query<(RowDataPacket & { sheet_key: string })[]>('SELECT sheet_key FROM content_plans WHERE sheet_key IN (?)', [keys])
  return new Set(rows.map((r) => r.sheet_key))
}

// Isi dari sheet menimpa kolom yang dikelola di sheet; hasil (reach, leads, anggaran), PIC aplikasi, & request desain tetap
export async function importContentPlans(plans: SheetPlan[], userId: number) {
  const before = await existingKeys(plans.map((p) => p.key))
  for (let i = 0; i < plans.length; i += 200) {
    const chunk = plans.slice(i, i + 200)
    await db.query(
      `INSERT INTO content_plans (sheet_key, sheet_ref, judul, platform, jenis, jadwal_tayang, status, tujuan, target_sektor, caption, link_hasil, catatan, pic_id, created_by)
       VALUES ? ON DUPLICATE KEY UPDATE sheet_ref = VALUES(sheet_ref), judul = VALUES(judul), jenis = VALUES(jenis), jadwal_tayang = VALUES(jadwal_tayang),
         status = VALUES(status), tujuan = COALESCE(VALUES(tujuan), tujuan), target_sektor = COALESCE(VALUES(target_sektor), target_sektor),
         caption = COALESCE(VALUES(caption), caption), link_hasil = COALESCE(VALUES(link_hasil), link_hasil), catatan = COALESCE(VALUES(catatan), catatan)`,
      [chunk.map((p) => [p.key, p.ref, p.judul, p.platform, p.jenis, p.jadwal_tayang, p.status, p.tujuan, p.target_sektor, p.caption, p.link_hasil, p.catatan, null, userId])],
    )
  }
  const created = plans.filter((p) => !before.has(p.key)).length
  return { created, updated: plans.length - created }
}

