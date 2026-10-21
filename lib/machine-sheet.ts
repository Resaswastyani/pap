// Data Mesin & critical point perawatan dari spreadsheet "MAPPING TEKNIS MESIN" (tab RINCIAN CRITICAL POINT),
// dibaca dengan akun Google yang terhubung di Master Data (seperti Logo & Desain dan Kalender Konten).
// Susunan sheet: "INLINE PP" (lini) -> "A. MC BLOW" (mesin) -> "- EPC" (komponen) -> "1.0 | langkah | ... | link Drive",
// baris "-> ..." = penjelas langkah, kolom "Data Pembantu :" = daftar "1. SOP Mesin | link", "Sumber : | link" = dokumen sumber.
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { fail } from '@/lib/api'
import { db } from '@/lib/db'
import { readSpreadsheet, spreadsheetId, type SheetTab } from '@/lib/drive'

const SETTING_KEY = 'teknis.sheet_url'
export const DEFAULT_MACHINE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1MRCTFQxTokFa3WMB0Q3GtpX96xEfcf5f_7Xo-3e42BA/edit?usp=sharing'

export async function loadMachineSheetUrl() {
  const [[row]] = await db.query<(RowDataPacket & { value: string })[]>('SELECT value FROM app_settings WHERE `key` = ?', [SETTING_KEY])
  return row?.value || DEFAULT_MACHINE_SHEET_URL
}
export async function saveMachineSheetUrl(url: string, userId: number) {
  if (!spreadsheetId(url)) fail(400, 'Link spreadsheet tidak valid. Gunakan link "docs.google.com/spreadsheets/d/...".')
  await db.query('INSERT INTO app_settings (`key`, value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)', [SETTING_KEY, url.slice(0, 1000), userId])
}

// ---------- Pembacaan sheet ----------
const isUrl = (v: string) => /^https?:\/\//i.test(v.trim())
const clean = (v: string | undefined) => (v ?? '').replace(/\s+/g, ' ').trim()
// Id file Google Drive / Docs dari link (untuk preview gambar)
export function driveFileId(url: string | null) {
  if (!url) return null
  const m = url.match(/\/d\/([a-zA-Z0-9_-]{20,})/) ?? url.match(/[?&]id=([a-zA-Z0-9_-]{20,})/)
  return m ? m[1] : null
}
const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\bMc\b/, 'MC').replace(/\bPp\b/, 'PP').replace(/\bHd\b/, 'HD').replace(/\bEpc\b/, 'EPC')
const slug = (s: string) => s.toUpperCase().replace(/^MC\s+/, '').replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '')
export function stageOf(name: string) {
  if (/blow/i.test(name)) return 'Blow'
  if (/roto|cetak|print/i.test(name)) return 'Cetak'
  if (/cut|seal|gusset|buffer|bag/i.test(name)) return 'Bag making'
  return 'Lainnya'
}

export type SheetCheckpoint = { komponen: string; komponen_urut: number; jenis: 'langkah' | 'catatan'; urut: number; teks: string; keterangan: string | null; link: string | null; ref: string }
export type SheetMachine = { key: string; kode: string; nama: string; lini: string | null; tahap: string; docs: { judul: string; url: string | null }[]; checkpoints: SheetCheckpoint[] }

export function parseMachineTabs(tabs: SheetTab[]) {
  const machines: SheetMachine[] = []
  for (const tab of tabs) {
    let lini: string | null = null
    let machine: SheetMachine | null = null
    let docCol: number | null = null // kolom label "1. SOP Mesin" di kanan "Data Pembantu"
    let komponen = ''
    let komponenUrut = 0
    let catatanUrut = 0
    tab.rows.forEach((raw, r) => {
      const row = raw.map((c) => c ?? '')
      const filled = row.map((c, j) => ({ c: clean(c), j })).filter((x) => x.c)
      if (!filled.length) return
      const a = clean(row[0])
      const b = clean(row[1])
      const ref = `${tab.title}!${r + 1}`
      // Judul lini
      const lineCell = filled.find((x) => /^inline\b/i.test(x.c) && x.j <= 2)
      if (lineCell && filled.length <= 2 && !/^data pembantu/i.test(filled[1]?.c ?? '')) {
        lini = lineCell.c.toUpperCase()
        machine = null
        return
      }
      // Judul mesin: "A." | "MC BLOW"
      if (/^mc\b/i.test(b) && (/^[a-z]\.?$/i.test(a) || !a)) {
        // Nama & kode MC Gusset tanpa kata "Buffer": "MC GUSSET & BUFFER" -> "MC Gusset" / PP-GUSSET
        const b2 = /gusset/i.test(b) ? b.replace(/\s*&\s*buffer\b/i, '') : b
        const name = titleCase(b2)
        const short = lini ? lini.replace(/^INLINE\s*/i, '') : ''
        const key = `${(lini ?? tab.title).toLowerCase()}|${b.toLowerCase()}`.slice(0, 80)
        machine = machines.find((m) => m.key === key) ?? null
        if (!machine) {
          machine = { key, kode: `${short ? `${slug(short)}-` : ''}${slug(b2)}`.slice(0, 30), nama: `${name}${lini ? ` · ${titleCase(lini)}` : ''}`.slice(0, 150), lini, tahap: stageOf(b), docs: [], checkpoints: [] }
          machines.push(machine)
        }
        docCol = null
        komponen = ''
        komponenUrut = 0
      }
      if (!machine) return
      const m: SheetMachine = machine
      // Data pembantu: "Data Pembantu :" di baris ini menetapkan kolom label daftar dokumen
      const dp = filled.find((x) => /^data pembantu/i.test(x.c))
      if (dp) docCol = dp.j + 1
      const used = new Set<number>()
      if (dp) used.add(dp.j)
      if (docCol !== null) {
        const label = clean(row[docCol])
        const match = label.match(/^\d+\.\s*(.+)$/)
        if (match) {
          const value = clean(row[docCol + 1])
          m.docs.push({ judul: (isUrl(value) || !value ? match[1] : `${match[1]} (${value})`).slice(0, 255), url: isUrl(value) ? value.slice(0, 1000) : null })
          used.add(docCol).add(docCol + 1)
        }
      }
      // "Sumber : | link"
      filled.forEach((x) => {
        if (/^sumber\s*:?$/i.test(x.c) && isUrl(clean(row[x.j + 1]))) {
          m.docs.push({ judul: `Sumber${komponen ? ` · ${komponen}` : ''}`, url: clean(row[x.j + 1]).slice(0, 1000) })
          used.add(x.j).add(x.j + 1)
        }
      })
      // Baris judul mesin hanya membawa data pembantu
      if (/^mc\b/i.test(b) && (/^[a-z]\.?$/i.test(a) || !a)) return
      const rest = filled.filter((x) => !used.has(x.j))
      if (!rest.length) return
      // Komponen: "- EPC"
      if (/^-\s*\S/.test(b) && !/^->/.test(b)) {
        komponen = b.replace(/^-\s*/, '').slice(0, 150)
        komponenUrut++
        catatanUrut = 0
        return
      }
      const link = rest.find((x) => isUrl(x.c))?.c ?? null
      // Langkah bernomor: "1.0" | teks
      if (/^\d+(\.0+)?$/.test(b) && clean(row[2])) {
        m.checkpoints.push({
          komponen: komponen || 'Umum', komponen_urut: komponenUrut || 1, jenis: 'langkah', urut: Number.parseInt(b, 10),
          teks: clean(row[2]).slice(0, 5000), keterangan: null, link: link?.slice(0, 1000) ?? null, ref,
        })
        return
      }
      // Teks lain di bawah komponen: penjelas langkah ("-> ...") atau catatan / keterangan komponen
      const text = rest.filter((x) => !isUrl(x.c) && x.j >= 1).map((x) => x.c).join(' ')
      if (!text) return
      const last = m.checkpoints[m.checkpoints.length - 1]
      if (/^->/.test(text) && last && last.jenis === 'langkah' && last.komponen === (komponen || 'Umum')) {
        last.keterangan = [last.keterangan, text.replace(/^->\s*/, '')].filter(Boolean).join('\n').slice(0, 5000)
        return
      }
      m.checkpoints.push({ komponen: komponen || 'Umum', komponen_urut: komponenUrut || 1, jenis: 'catatan', urut: ++catatanUrut, teks: text.slice(0, 5000), keterangan: null, link: link?.slice(0, 1000) ?? null, ref })
    })
  }
  return machines
}

export async function readMachineSheet(url: string) {
  const id = spreadsheetId(url) ?? fail(400, 'Link spreadsheet tidak valid.')
  const tabs = await readSpreadsheet(id)
  return { tabs: tabs.map((t) => t.title), machines: parseMachineTabs(tabs) }
}

// ---------- Simpan ----------
// Mesin dikenali lewat sheet_key (atau kode yang sama dengan mesin yang sudah ada); critical point & dokumen diganti dengan isi sheet terbaru.
// Status, kapasitas, keterangan, dan tahap mesin yang sudah ada tidak diubah.
export async function importMachines(machines: SheetMachine[]) {
  const conn: PoolConnection = await db.getConnection()
  let created = 0
  try {
    await conn.beginTransaction()
    for (const m of machines) {
      const [[found]] = await conn.query<(RowDataPacket & { id: number })[]>('SELECT id FROM machines WHERE sheet_key = ? OR (sheet_key IS NULL AND kode = ?) ORDER BY sheet_key IS NULL LIMIT 1', [m.key, m.kode])
      let id = found?.id
      if (id) {
        await conn.query('UPDATE machines SET sheet_key = ?, nama = ?, lini = ? WHERE id = ?', [m.key, m.nama, m.lini, id])
      } else {
        const [res] = await conn.query<ResultSetHeader>("INSERT INTO machines (sheet_key, kode, nama, tahap, lini, status) VALUES (?, ?, ?, ?, ?, 'aktif')", [m.key, m.kode, m.nama, m.tahap, m.lini])
        id = res.insertId
        created++
      }
      await conn.query('DELETE FROM machine_checkpoints WHERE machine_id = ?', [id])
      await conn.query('DELETE FROM machine_documents WHERE machine_id = ?', [id])
      if (m.checkpoints.length) {
        await conn.query(
          'INSERT INTO machine_checkpoints (machine_id, komponen, komponen_urut, jenis, urut, teks, keterangan, link, drive_file_id, sheet_ref) VALUES ?',
          [m.checkpoints.map((c) => [id, c.komponen, c.komponen_urut, c.jenis, c.urut, c.teks, c.keterangan, c.link, driveFileId(c.link), c.ref.slice(0, 150)])],
        )
      }
      if (m.docs.length) {
        await conn.query('INSERT INTO machine_documents (machine_id, urut, judul, url, drive_file_id) VALUES ?', [m.docs.map((d, i) => [id, i + 1, d.judul, d.url, driveFileId(d.url)])])
      }
    }
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') fail(409, 'Kode mesin dari sheet bentrok dengan mesin lain. Ubah kode mesin yang sudah ada lalu sinkron ulang.')
    throw error
  } finally {
    conn.release()
  }
  return {
    mesin: machines.length, baru: created,
    langkah: machines.reduce((n, m) => n + m.checkpoints.filter((c) => c.jenis === 'langkah').length, 0),
    dokumen: machines.reduce((n, m) => n + m.docs.length, 0),
  }
}

// ---------- Tampilan ----------
export async function loadMachineDetail(id: number) {
  const [[machine]] = await db.query<RowDataPacket[]>('SELECT * FROM machines WHERE id = ?', [id])
  if (!machine) fail(404, 'Mesin tidak ditemukan.')
  const [checkpoints] = await db.query<RowDataPacket[]>(
    'SELECT id, komponen, komponen_urut, jenis, urut, teks, keterangan, link, drive_file_id FROM machine_checkpoints WHERE machine_id = ? ORDER BY komponen_urut, id',
    [id],
  )
  const [documents] = await db.query<RowDataPacket[]>('SELECT id, judul, url, drive_file_id FROM machine_documents WHERE machine_id = ? ORDER BY urut', [id])
  // Laporan kerusakan terakhir (menu Kerusakan Mesin)
  const [repairs] = await db.query<RowDataPacket[]>(
    'SELECT id, nomor, keluhan, status, prioritas, created_at FROM machine_repairs WHERE machine_id = ? ORDER BY created_at DESC LIMIT 5',
    [id],
  )
  return { machine, checkpoints, documents, repairs }
}
