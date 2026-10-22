// Tulis balik ke Google Sheet (Sheets API v4) untuk data SIMPAP yang sumbernya spreadsheet di Drive:
// Kalender Konten, Rekap Kerusakan, Jadwal Shift, Data Mesin (critical point), Lembar Perawatan.
// Butuh izin "edit spreadsheet" pada akun Google yang terhubung (Master Data > Logo & Desain > Hubungkan akun Google).
// File Excel (.xlsx) yang diunggah ke Drive tidak bisa ditulis lewat Sheets API: simpan dulu sebagai Google Spreadsheet.
//
// Prinsip: SIMPAP menyimpan dulu, lalu menulis ke sheet. Sebelum mengubah / menghapus baris, isi baris dicek ulang
// (cocok dengan data lama) agar tidak menimpa baris lain bila sheet sudah bergeser. Kegagalan dikembalikan sebagai
// pesan peringatan (data di SIMPAP tetap tersimpan).
import { fail } from '@/lib/api'
import { googleAccessToken, spreadsheetId } from '@/lib/drive'

export class SheetWriteError extends Error {}

const API = 'https://sheets.googleapis.com/v4/spreadsheets'
const q = (title: string) => `'${title.replace(/'/g, "''")}'`

// Kolom ke huruf A1: 0 -> A, 26 -> AA
export function colLetter(index: number) {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

async function call<T = Record<string, unknown>>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await googleAccessToken().catch((e: Error) => {
    throw new SheetWriteError(e.message)
  })
  const res = await fetch(`${API}/${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = String(json.error?.message ?? `Google Sheets error ${res.status}`)
    if (res.status === 403 && /insufficient|scope/i.test(msg)) {
      throw new SheetWriteError('Akun Google yang terhubung belum punya izin edit spreadsheet. Admin perlu klik "Hubungkan akun Google" lagi di Master Data dan mencentang izin edit.')
    }
    if (res.status === 403) throw new SheetWriteError('Akun Google yang terhubung tidak punya akses edit ke spreadsheet ini. Bagikan spreadsheet sebagai Editor.')
    if (/not supported for this document/i.test(msg)) {
      throw new SheetWriteError('File ini masih berformat Excel (.xlsx) sehingga tidak bisa diubah otomatis. Buka di Google Drive > File > Simpan sebagai Google Spreadsheet, lalu ganti link spreadsheet di SIMPAP.')
    }
    throw new SheetWriteError(msg)
  }
  return json as T
}

export type Sheet = { id: string; tabs: { title: string; sheetId: number }[] }

export async function openSheet(url: string): Promise<Sheet> {
  const id = spreadsheetId(url)
  if (!id) throw new SheetWriteError('Link spreadsheet tidak valid.')
  const meta = await call<{ sheets: { properties: { title: string; sheetId: number } }[] }>(`${encodeURIComponent(id)}?fields=sheets.properties(title,sheetId)`)
  return { id, tabs: meta.sheets.map((s) => ({ title: s.properties.title, sheetId: s.properties.sheetId })) }
}

export function tabOf(sheet: Sheet, title: string) {
  const tab = sheet.tabs.find((t) => t.title === title)
  if (!tab) throw new SheetWriteError(`Tab "${title}" tidak ada lagi di spreadsheet.`)
  return tab
}

// Isi tab (teks seperti tampil). range opsional, mis. "A1:Z40"
export async function readTab(sheet: Sheet, title: string, range = '') {
  const json = await call<{ values?: unknown[][] }>(`${sheet.id}/values/${encodeURIComponent(`${q(title)}${range ? `!${range}` : ''}`)}`)
  return (json.values ?? []).map((r) => r.map((c) => String(c ?? '')))
}

// Tulis beberapa sel sekaligus: [{ row (1-based), col (0-based), value }]
export async function writeCells(sheet: Sheet, title: string, cells: { row: number; col: number; value: string | number }[]) {
  if (!cells.length) return
  await call(`${sheet.id}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data: cells.map((c) => ({ range: `${q(title)}!${colLetter(c.col)}${c.row}`, values: [[c.value]] })),
    }),
  })
}

// Tambah baris di bawah data terakhir tab; mengembalikan nomor baris (1-based) yang terisi
export async function appendRow(sheet: Sheet, title: string, values: (string | number)[]) {
  const json = await call<{ updates?: { updatedRange?: string } }>(
    `${sheet.id}/values/${encodeURIComponent(`${q(title)}!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: [values] }) },
  )
  const m = json.updates?.updatedRange?.match(/!\$?[A-Z]+\$?(\d+)/)
  return m ? Number(m[1]) : null
}

// Sisipkan baris kosong setelah baris `after` (1-based) dengan format baris di atasnya, lalu isi
export async function insertRowAfter(sheet: Sheet, title: string, after: number, values: (string | number)[]) {
  const tab = tabOf(sheet, title)
  await call(`${sheet.id}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ insertDimension: { range: { sheetId: tab.sheetId, dimension: 'ROWS', startIndex: after, endIndex: after + 1 }, inheritFromBefore: true } }] }),
  })
  await writeCells(sheet, title, values.map((value, col) => ({ row: after + 1, col, value })))
  return after + 1
}

export async function deleteRow(sheet: Sheet, title: string, row: number) {
  const tab = tabOf(sheet, title)
  await call(`${sheet.id}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId: tab.sheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row } } }] }),
  })
}

// Tab baru (mis. jadwal shift bulan baru); bila sudah ada, dipakai apa adanya
export async function ensureTab(sheet: Sheet, title: string) {
  if (sheet.tabs.some((t) => t.title === title)) return
  const json = await call<{ replies: { addSheet?: { properties: { sheetId: number } } }[] }>(`${sheet.id}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
  })
  sheet.tabs.push({ title, sheetId: json.replies[0]?.addSheet?.properties.sheetId ?? 0 })
}

// Ganti isi satu rentang (mis. seluruh tabel jadwal bulan) dan kosongkan sisa baris lama di bawahnya
export async function replaceBlock(sheet: Sheet, title: string, startRow: number, rows: (string | number)[][], clearUntilRow?: number) {
  const width = Math.max(1, ...rows.map((r) => r.length))
  const data = [{ range: `${q(title)}!A${startRow}:${colLetter(width - 1)}${startRow + rows.length - 1}`, values: rows }]
  if (clearUntilRow && clearUntilRow >= startRow + rows.length) {
    await call(`${sheet.id}/values/${encodeURIComponent(`${q(title)}!A${startRow + rows.length}:${colLetter(width - 1)}${clearUntilRow}`)}:clear`, { method: 'POST', body: '{}' })
  }
  await call(`${sheet.id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }) })
}

// Jalankan penulisan ke sheet; hasil = null (berhasil) atau pesan peringatan untuk ditampilkan ke pengguna
export async function trySheet(label: string, fn: () => Promise<unknown>) {
  try {
    await fn()
    return null
  } catch (error) {
    const msg = error instanceof SheetWriteError ? error.message : `Gagal menulis ke Google Sheet: ${(error as Error).message}`
    console.error(`[sheet-write] ${label}:`, (error as Error).message)
    return `Tersimpan di SIMPAP, tetapi ${label} di Google Sheet belum diperbarui. ${msg}`
  }
}

// Tanggal YYYY-MM-DD -> dd/mm/yyyy (format tanggal Indonesia di sheet)
export const sheetDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

// Data cermin sheet (Data Mesin, Lembar Perawatan): sheet ditulis lebih dulu; gagal = 400 dengan alasannya (tidak ada yang berubah)
export async function sheetStrict<T>(fn: () => Promise<T>) {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof SheetWriteError) fail(400, error.message)
    throw error
  }
}
