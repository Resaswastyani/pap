// Lembar Perawatan Mesin dari spreadsheet "IGP - Lembar Perawatan Mesin" di Google Drive (dibaca dengan akun Google
// yang terhubung di Master Data > Logo & Desain, sama seperti Rekap Kerusakan & Jadwal Shift).
// Satu tab per mesin: judul "MAINTENANCE MESIN BLOW PP", lalu NO | NAMA PART | KELOMPOK | MAINTENANCE | CHECK LIST | KETERANGAN.
// Baris ber-NO memulai part baru; baris berikutnya tanpa NO adalah langkah maintenance lanjutan part itu.
import { createHash } from 'node:crypto'
import type { RowDataPacket } from 'mysql2'
import { fail } from '@/lib/api'
import { db } from '@/lib/db'
import { downloadSpreadsheetXlsx, readSpreadsheet, spreadsheetId, type SheetTab } from '@/lib/drive'
import { readXlsxImages, type XlsxImage } from '@/lib/xlsx-lite'
import { canManageTeknik } from '@/lib/teknik'
import type { UserProfile } from '@/lib/users'

const SETTING_KEY = 'perawatan.sheet_url'
export const DEFAULT_MAINTENANCE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1A1aDYp9sduVwM_qDdlT_SX2JG14esEu-CPCjlC-rK-k/edit?usp=sharing'

export const canSyncMaintenanceSheet = canManageTeknik

export async function loadMaintenanceSheetUrl() {
  const [[row]] = await db.query<(RowDataPacket & { value: string })[]>('SELECT value FROM app_settings WHERE `key` = ?', [SETTING_KEY])
  return row?.value || DEFAULT_MAINTENANCE_SHEET_URL
}
export async function saveMaintenanceSheetUrl(url: string, userId: number) {
  if (!spreadsheetId(url)) fail(400, 'Link spreadsheet tidak valid. Gunakan link "docs.google.com/spreadsheets/d/...".')
  await db.query('INSERT INTO app_settings (`key`, value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)', [SETTING_KEY, url.slice(0, 1000), userId])
}

// ---------- Pembacaan sheet ----------
const clean = (v: string | undefined) => (v ?? '').replace(/\s+/g, ' ').trim()
const norm = (v: string | undefined) => clean(v).toLowerCase()
// "MAINTENANCE MESIN BLOW PP" / tab "Mesin Blow PP" -> "Mesin Blow PP"
const titleCase = (s: string) =>
  s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(Pp|Hd|Pe|Mc|Epc)\b/g, (w) => w.toUpperCase())

export type SheetStep = { part_no: number | null; part: string; kelompok: string | null; langkah_urut: number; langkah: string; keterangan: string | null; sheet_row: number }
export type SheetMachine = { tab: string; mesin: string; urut: number; steps: SheetStep[] }

function headerOf(rows: string[][]) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const row = rows[i] ?? []
    const find = (re: RegExp) => row.findIndex((c) => re.test(norm(c)))
    const part = find(/^nama part$|^part$/)
    const langkah = find(/^maintenance$|^perawatan$/)
    if (part < 0 || langkah < 0) continue
    return { index: i, no: find(/^(no|no\.)$/), part, kelompok: find(/^kelompok$/), langkah, keterangan: find(/^keterangan$/) }
  }
  return null
}

// "1. Membersihkan ..." -> "Membersihkan ..."; "5 Kencangkan ..." -> "Kencangkan ..."
const stripNumber = (s: string) => s.replace(/^\d{1,2}\s*[.)]?\s+/, '')

export function parseMaintenanceTabs(tabs: SheetTab[]) {
  const machines: SheetMachine[] = []
  tabs.forEach((tab) => {
    const head = headerOf(tab.rows)
    if (!head) return
    // Nama tab ("Mesin Blow PP") lebih lengkap dari judul di dalam sheet; judul "MAINTENANCE ..." dipakai bila nama tab generik
    const title = tab.rows.slice(0, head.index).flat().map(clean).find((c) => /^maintenance\b/i.test(c))
    const mesin = /^sheet\s*\d*$/i.test(tab.title.trim()) && title ? titleCase(title.replace(/^maintenance\s+/i, '')) : clean(tab.title)
    const steps: SheetStep[] = []
    let part: { no: number | null; nama: string; kelompok: string | null } | null = null
    let urut = 0
    for (let r = head.index + 1; r < tab.rows.length; r++) {
      const row = tab.rows[r] ?? []
      const no = Number(clean(row[head.no]).replace(/\.0+$/, ''))
      const nama = clean(row[head.part])
      const langkah = clean(row[head.langkah])
      const keterangan = head.keterangan >= 0 ? clean(row[head.keterangan]) : ''
      if (nama && (Number.isInteger(no) && no > 0 || !part || nama !== part.nama)) {
        part = { no: Number.isInteger(no) && no > 0 ? no : null, nama, kelompok: clean(row[head.kelompok]) || null }
        urut = 0
      }
      if (!part || !langkah) continue
      steps.push({ part_no: part.no, part: part.nama, kelompok: part.kelompok, langkah_urut: ++urut, langkah: stripNumber(langkah), keterangan: keterangan || null, sheet_row: r + 1 })
    }
    if (steps.length) machines.push({ tab: tab.title, mesin, urut: machines.length + 1, steps })
  })
  return machines
}

export async function readMaintenanceSheet(url: string) {
  const id = spreadsheetId(url) ?? fail(400, 'Link spreadsheet tidak valid.')
  const tabs = await readSpreadsheet(id)
  const machines = parseMaintenanceTabs(tabs)
  return {
    machines,
    tabs: tabs.map((t) => {
      const m = machines.find((x) => x.tab === t.title)
      return { title: t.title, mesin: m?.mesin ?? null, parts: m ? new Set(m.steps.map((s) => s.part)).size : 0, langkah: m?.steps.length ?? 0 }
    }),
  }
}

// ---------- Tautan ke Data Mesin ----------
// "Mesin Blow PP" -> PP-BLOW; "Mesin Gusset HD" / "Buffer Time HD" -> HD-GUSSET-BUFFER; "Cut Seal PP" -> PP-CUTSEAL
export function machineCodeFor(mesin: string) {
  const v = mesin.toLowerCase().replace(/\s+/g, ' ')
  const lini = /\bpp\b/.test(v) ? 'PP' : /\bhd\b/.test(v) ? 'HD' : null
  if (!lini) return null
  if (/\bblow\b/.test(v)) return `${lini}-BLOW`
  if (/roto/.test(v)) return `${lini}-ROTOGRAVURE`
  if (/gusset|buffer ?time/.test(v)) return `${lini}-GUSSET-BUFFER`
  if (/cut ?seal/.test(v)) return `${lini}-CUTSEAL`
  return null
}

// Lembar diganti seluruhnya dengan isi sheet terbaru
export async function importMaintenanceSheet(machines: SheetMachine[]) {
  const [rows] = await db.query<(RowDataPacket & { id: number; kode: string })[]>('SELECT id, kode FROM machines')
  const byKode = new Map(rows.map((m) => [m.kode.toUpperCase(), m.id]))
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('DELETE FROM maintenance_sheet_items')
    for (const m of machines) {
      const code = machineCodeFor(m.mesin)
      const machineId = code ? byKode.get(code) ?? null : null
      await conn.query(
        'INSERT INTO maintenance_sheet_items (sheet_tab, mesin, mesin_urut, machine_id, part_no, part, kelompok, langkah_urut, langkah, keterangan, sheet_row) VALUES ?',
        [m.steps.map((s) => [m.tab.slice(0, 120), m.mesin.slice(0, 150), m.urut, machineId, s.part_no, s.part.slice(0, 200), s.kelompok?.slice(0, 150) ?? null, s.langkah_urut, s.langkah, s.keterangan, s.sheet_row])],
      )
    }
    await conn.query("INSERT INTO app_settings (`key`, value) VALUES ('perawatan.synced_at', NOW()) ON DUPLICATE KEY UPDATE value = NOW()")
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
  return { mesin: machines.length, part: machines.reduce((n, m) => n + new Set(m.steps.map((s) => s.part)).size, 0), langkah: machines.reduce((n, m) => n + m.steps.length, 0) }
}

// ---------- Gambar part ----------
// Gambar ditempel di kolom NAMA PART di samping baris part-nya: pasangkan ke part terakhir yang mulai di/atas baris gambar
export type PartImage = { tab: string; part_no: number | null; part: string; urut: number; name: string; mime: string; data: Buffer; sheet_row: number }
export function mapPartImages(machines: SheetMachine[], tabs: { title: string; images: XlsxImage[] }[]) {
  const out: PartImage[] = []
  for (const m of machines) {
    const images = tabs.find((t) => t.title === m.tab)?.images ?? []
    // Baris awal tiap part (urut sesuai sheet)
    const starts: { row: number; part_no: number | null; part: string }[] = []
    for (const s of m.steps) if (s.langkah_urut === 1) starts.push({ row: s.sheet_row, part_no: s.part_no, part: s.part })
    if (!starts.length) continue
    const count = new Map<string, number>()
    for (const img of [...images].sort((a, b) => a.row - b.row || a.col - b.col)) {
      const row = img.row + 1
      const owner = [...starts].reverse().find((p) => p.row <= row + 1) ?? starts[0]
      const key = `${owner.part_no}|${owner.part}`
      count.set(key, (count.get(key) ?? 0) + 1)
      out.push({ tab: m.tab, part_no: owner.part_no, part: owner.part, urut: count.get(key)!, name: img.name, mime: img.mime, data: img.data, sheet_row: row })
    }
  }
  return out
}

// Gambar disimpan ulang hanya bila isinya berubah (hash seluruh gambar), agar sinkron rutin tidak menulis ulang megabyte data
export async function importMaintenanceImages(images: PartImage[]) {
  const hash = createHash('sha1')
  for (const img of images) hash.update(`${img.tab}|${img.part_no}|${img.part}|${img.urut}|`).update(img.data)
  const digest = hash.digest('hex')
  const [[prev]] = await db.query<(RowDataPacket & { value: string })[]>("SELECT value FROM app_settings WHERE `key` = 'perawatan.images_hash'")
  if (prev?.value === digest) return { gambar: images.length, berubah: false }
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('DELETE FROM maintenance_sheet_images')
    // Beberapa gambar per query (batas max_allowed_packet MySQL)
    for (let i = 0; i < images.length; i += 8) {
      await conn.query(
        'INSERT INTO maintenance_sheet_images (sheet_tab, part_no, part, urut, name, mime, size, data, sheet_row) VALUES ?',
        [images.slice(i, i + 8).map((g) => [g.tab.slice(0, 120), g.part_no, g.part.slice(0, 200), g.urut, g.name.slice(0, 255), g.mime, g.data.length, g.data, g.sheet_row])],
      )
    }
    await conn.query("INSERT INTO app_settings (`key`, value) VALUES ('perawatan.images_hash', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [digest])
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
  return { gambar: images.length, berubah: true }
}

// Gambar dibaca dari file XLSX (Sheets API tidak menyertakan gambar yang ditempel di sel)
export async function syncMaintenanceImages(url: string, machines: SheetMachine[]) {
  const id = spreadsheetId(url) ?? fail(400, 'Link spreadsheet tidak valid.')
  return importMaintenanceImages(mapPartImages(machines, readXlsxImages(await downloadSpreadsheetXlsx(id))))
}

// Dipakai cron Drive: sinkron otomatis tanpa pengguna
export async function syncMaintenanceSheet() {
  const url = await loadMaintenanceSheetUrl()
  const { machines } = await readMaintenanceSheet(url)
  if (!machines.length) return { mesin: 0, part: 0, langkah: 0 }
  const result = await importMaintenanceSheet(machines)
  const gambar = await syncMaintenanceImages(url, machines).catch((error) => ({ error: (error as Error).message }))
  return { ...result, gambar }
}

export const requireMaintenanceSheet = (user: UserProfile) => {
  if (!user.menus.includes('perawatan-mesin' as never)) fail(403, 'Anda tidak punya akses ke menu Perawatan Mesin.')
}
