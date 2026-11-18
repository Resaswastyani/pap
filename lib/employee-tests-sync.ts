import type { RowDataPacket } from 'mysql2'
import { fail } from '@/lib/api'
import { db } from '@/lib/db'
import { readSpreadsheet, spreadsheetId, type SheetTab } from '@/lib/drive'

// Sinkron hasil tes Google Form (spreadsheet jawaban) ke Hasil tes karyawan:
// - Tes IQ: 60 soal pilihan, kunci dari tab "Jawaban Responden"; skor IQ = benar x 2 + 42, lulus bila >= 110
//   (rumus sama dengan tab "Print Tes IQ").
// - Papikostik: 90 soal pilihan a/b -> 20 aspek PAPI Kostick (skor 0-9 per aspek).
// Jawaban dicocokkan ke karyawan lewat nomor HP lalu nama lengkap; jawaban pelamar yang bukan karyawan dilewati.

type Row = RowDataPacket & Record<string, unknown>
export const TEST_SHEET_KEYS = { papikostik: 'hrd.tes_papikostik_url', iq: 'hrd.tes_iq_url' } as const
const SYNCED_KEY = 'hrd.tes_synced_at'

// Soal 1-90 -> aspek pilihan a & b (lembar penilaian PAPI Kostick). Soal 81-90 dikoreksi sesuai isi pernyataannya
// (rumus tab "Jawaban Responden Tes Papikosti" bergeser satu soal pada baris terakhir).
const PAPI_KEY = 'GE AN PA XP BX OB ZO KZ FK WF GC LE PN XA BP OX ZB KO FZ WK GD LC IE XN BA OP ZX KB FO WZ GR LD IC TE BN OA ZP KX FB WO GS LR ID TC VE ON ZA KP FX WB GV LS IR TD VC SE ZN KA FP WX GT LV IS TR VD SC RE KN FA WP GI LT IV TS VR SD RC DE FN WA GL LI IT TV VS SR RD DC CE WN'.split(' ')
export const PAPI_ORDER = 'GLITVSRDCENAPXBOZKFW'.split('')
// Kunci tes IQ cadangan (isi tab "Jawaban Responden"), dipakai bila tab kunci tidak terbaca
const IQ_KEY = 'DCAAADCEBECDCBABEBEBEBCEEDADCBDBBCBBDCDCAECEEBCEBCCECBCDBBCB'.split('')

const normName = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '')
const normPhone = (s: string) => {
  const d = String(s ?? '').replace(/\.0+$/, '').replace(/\D/g, '').replace(/^62/, '').replace(/^0+/, '')
  return d.length >= 8 ? d : null
}
const letterOf = (answer: string) => String(answer ?? '').trim().match(/^([a-e])\s*\)/i)?.[1].toUpperCase() ?? null

// Timestamp form: angka seri Excel (45793.42), teks "2025-05-15 10:10:05", atau "a/b/yyyy" yang urutannya mengikuti
// bahasa spreadsheet (Indonesia: tanggal/bulan, Inggris: bulan/tanggal). monthFirst ditentukan per tab dari seluruh isinya.
const valid = (y: number, m: number, d: number) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y > 2000 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null)
function tanggalOf(ts: string, monthFirst: boolean) {
  const t = String(ts ?? '').trim()
  if (/^\d{5}(\.\d+)?$/.test(t)) return new Date(Date.UTC(1899, 11, 30) + Number(t) * 86400e3).toISOString().slice(0, 10)
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) {
    const [a, b, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
    // Bila satu bagian > 12, urutannya pasti; selain itu ikuti urutan tab
    if (a > 12) return valid(y, b, a)
    if (b > 12) return valid(y, a, b)
    return monthFirst ? valid(y, a, b) : valid(y, b, a)
  }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? valid(Number(m[1]), Number(m[2]), Number(m[3])) : null
}
// Urutan tanggal tab: bulan/tanggal bila ada nilai bagian kedua > 12 (mis. 9/18/2025)
const monthFirstOf = (values: string[]) => values.some((v) => Number(String(v).trim().match(/^\d{1,2}\/(\d{1,2})\//)?.[1]) > 12)

type Response = { key: string; tanggal: string | null; nama: string; telp: string | null; bagian: string | null; answers: Map<number, string> }

// Tab jawaban form: baris judul berisi Timestamp + kolom soal "1. ..."
function responses(tabs: SheetTab[], jenis: string): Response[] {
  const out: Response[] = []
  for (const tab of tabs) {
    const head = (tab.rows[0] ?? []).map((h) => String(h ?? '').trim())
    const ts = head.findIndex((h) => /^timestamp$/i.test(h))
    const qcols = head.map((h, i) => [Number(h.match(/^(\d{1,2})\s*\./)?.[1]), i] as const).filter(([n]) => n > 0)
    if (ts < 0 || qcols.length < 30) continue
    const col = (re: RegExp) => head.findIndex((h) => re.test(h))
    const nama = col(/^nama/i)
    const telp = col(/telep|telp|^no\.? ?hp|phone|whatsapp/i)
    const bagian = col(/bagian/i)
    const email = col(/email/i)
    const monthFirst = monthFirstOf(tab.rows.slice(1).map((r) => String(r[ts] ?? '')))
    for (const r of tab.rows.slice(1)) {
      const name = String(r[nama] ?? '').trim()
      if (!name || /^tes(t)?$/i.test(name)) continue
      out.push({
        key: `${jenis}:${tab.title.slice(0, 40)}:${String(r[ts] ?? '').trim()}:${String(r[email] ?? name).trim().toLowerCase()}`.slice(0, 190),
        tanggal: tanggalOf(String(r[ts] ?? ''), monthFirst), nama: name, telp: telp >= 0 ? normPhone(String(r[telp] ?? '')) : null, bagian: bagian >= 0 ? String(r[bagian] ?? '').trim() || null : null,
        answers: new Map(qcols.map(([n, i]) => [n, String(r[i] ?? '')])),
      })
    }
  }
  return out
}

function iqKey(tabs: SheetTab[]) {
  const tab = tabs.find((t) => /jawaban responden/i.test(t.title))
  const key: string[] = []
  for (const r of tab?.rows ?? []) {
    const n = Number(String(r[0] ?? '').trim())
    const k = String(r[1] ?? '').trim().toUpperCase()
    if (Number.isInteger(n) && n >= 1 && n <= 60 && /^[A-E]$/.test(k)) key[n - 1] = k
  }
  return key.filter(Boolean).length === 60 ? key : IQ_KEY
}

export function scoreIq(answers: Map<number, string>, key = IQ_KEY) {
  let benar = 0
  key.forEach((k, i) => { if (letterOf(answers.get(i + 1) ?? '') === k) benar++ })
  const skor = benar * 2 + 42
  return { benar, skor, lulus: skor >= 110 }
}

export function scorePapi(answers: Map<number, string>) {
  const score = Object.fromEntries(PAPI_ORDER.map((a) => [a, 0])) as Record<string, number>
  let dijawab = 0
  PAPI_KEY.forEach((pair, i) => {
    const l = letterOf(answers.get(i + 1) ?? '')
    if (l === 'A') score[pair[0]]++
    else if (l === 'B') score[pair[1]]++
    if (l === 'A' || l === 'B') dijawab++
  })
  return { score, dijawab }
}
// Ringkasan disimpan di kolom hasil: "G7 L4 I7 ..." (urutan baku PAPI)
export const papiText = (score: Record<string, number>) => PAPI_ORDER.map((a) => `${a}${score[a]}`).join(' ')

// Jarak ketik (Levenshtein) untuk toleransi salah ketik nama
function editDistance(x: string, y: string) {
  const d = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)])
  for (let j = 1; j <= y.length; j++) d[0][j] = j
  for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1))
  return d[x.length][y.length]
}
const tokens = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((t) => t.length >= 2)

// Pencocokan jawaban form ke karyawan, berurutan:
// 1) nomor HP sama; 2) nama lengkap sama; 3) semua kata nama yang lebih pendek ada di nama yang lain (min. 2 kata,
//    mis. "Ady Prasetyo" = "ADY PRASETYO NUGROHO"); 4) salah ketik kecil (<= 2 huruf, nama >= 10 huruf).
// Langkah 3-4 hanya dipakai bila kandidatnya tepat satu karyawan.
async function employeeMatcher() {
  const [rows] = await db.query<Row[]>('SELECT id, nama, handphone FROM employees')
  const byPhone = new Map<string, number>()
  const byName = new Map<string, number | null>()
  const list = rows.map((e) => ({ id: Number(e.id), key: normName(String(e.nama)), toks: tokens(String(e.nama)) }))
  for (const e of rows) {
    const p = normPhone(String(e.handphone ?? ''))
    if (p) byPhone.set(p, Number(e.id))
    const n = normName(String(e.nama))
    byName.set(n, byName.has(n) ? null : Number(e.id)) // nama kembar tidak dicocokkan otomatis
  }
  const unique = (ids: number[]) => (new Set(ids).size === 1 ? ids[0] : null)
  return (r: Response) => {
    if (r.telp && byPhone.get(r.telp)) return byPhone.get(r.telp)!
    const key = normName(r.nama)
    const exact = byName.get(key)
    if (exact) return exact
    if (exact === null) return null
    const toks = tokens(r.nama)
    if (toks.length >= 2) {
      const sub = list.filter((e) => e.toks.length >= 2 && (toks.every((t) => e.toks.includes(t)) || e.toks.every((t) => toks.includes(t))))
      const hit = unique(sub.map((e) => e.id))
      if (hit) return hit
      if (sub.length > 1) return null
    }
    if (key.length >= 10) {
      const near = list.filter((e) => Math.abs(e.key.length - key.length) <= 2 && editDistance(e.key, key) <= 2)
      return unique(near.map((e) => e.id))
    }
    return null
  }
}

export async function loadTestSheetUrls() {
  const [rows] = await db.query<Row[]>('SELECT `key`, value FROM app_settings WHERE `key` IN (?, ?, ?)', [TEST_SHEET_KEYS.papikostik, TEST_SHEET_KEYS.iq, SYNCED_KEY])
  const get = (k: string) => (rows.find((r) => r.key === k)?.value as string | null) ?? ''
  return { papikostik: get(TEST_SHEET_KEYS.papikostik), iq: get(TEST_SHEET_KEYS.iq), synced_at: get(SYNCED_KEY) || null }
}

export async function saveTestSheetUrls(urls: { papikostik?: unknown; iq?: unknown }, userId: number) {
  for (const jenis of ['papikostik', 'iq'] as const) {
    const url = typeof urls[jenis] === 'string' ? (urls[jenis] as string).trim() : null
    if (url === null) continue
    if (url && !spreadsheetId(url)) fail(400, `Link spreadsheet ${jenis === 'iq' ? 'Tes IQ' : 'Papikostik'} tidak valid.`)
    await db.query('INSERT INTO app_settings (`key`, value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)', [TEST_SHEET_KEYS[jenis], url, userId])
  }
}

type Result = { jenis: 'papikostik' | 'iq'; jawaban: number; cocok: number; baru: number; tidak_cocok: string[]; error?: string }

async function syncOne(jenis: 'papikostik' | 'iq', url: string, match: (r: Response) => number | null): Promise<Result> {
  const id = spreadsheetId(url)
  if (!id) return { jenis, jawaban: 0, cocok: 0, baru: 0, tidak_cocok: [], error: 'Link belum diatur.' }
  const tabs = await readSpreadsheet(id)
  const list = responses(tabs, jenis)
  const key = jenis === 'iq' ? iqKey(tabs) : null
  const res: Result = { jenis, jawaban: list.length, cocok: 0, baru: 0, tidak_cocok: [] }
  const [known] = await db.query<Row[]>('SELECT sheet_key FROM employee_tests WHERE jenis = ? AND sheet_key IS NOT NULL', [jenis])
  const existing = new Set(known.map((k) => String(k.sheet_key)))
  for (const r of list) {
    const employeeId = match(r)
    if (!employeeId) { res.tidak_cocok.push(r.nama); continue }
    res.cocok++
    let hasil: string
    let skor: number | null = null
    if (jenis === 'iq') {
      const s = scoreIq(r.answers, key!)
      hasil = `${s.lulus ? 'Lulus' : 'Tidak lulus'} · ${s.benar}/60 benar`
      skor = s.skor
    } else {
      const s = scorePapi(r.answers)
      hasil = papiText(s.score)
    }
    const catatan = [r.bagian ? `Bagian dilamar: ${r.bagian}` : null, 'Dari Google Form'].filter(Boolean).join(' · ')
    await db.query(
      `INSERT INTO employee_tests (employee_id, jenis, tanggal, hasil, skor, catatan, sumber, sheet_key) VALUES (?, ?, ?, ?, ?, ?, 'form', ?)
       ON DUPLICATE KEY UPDATE employee_id = VALUES(employee_id), tanggal = VALUES(tanggal), hasil = VALUES(hasil), skor = VALUES(skor), catatan = VALUES(catatan)`,
      [employeeId, jenis, r.tanggal, hasil, skor, catatan, r.key],
    )
    if (!existing.has(r.key)) res.baru++
  }
  res.tidak_cocok = [...new Set(res.tidak_cocok)].slice(0, 200)
  return res
}

export async function syncEmployeeTests() {
  const urls = await loadTestSheetUrls()
  const match = await employeeMatcher()
  const results: Result[] = []
  for (const jenis of ['papikostik', 'iq'] as const) {
    results.push(await syncOne(jenis, urls[jenis], match).catch((e: Error) => ({ jenis, jawaban: 0, cocok: 0, baru: 0, tidak_cocok: [], error: e.message })))
  }
  await db.query("INSERT INTO app_settings (`key`, value) VALUES (?, NOW()) ON DUPLICATE KEY UPDATE value = NOW()", [SYNCED_KEY])
  return results
}
