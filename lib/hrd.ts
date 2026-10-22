// HRD (Guidance Human Resource): data karyawan, grade operator, dan kebijakan gaji dari spreadsheet di Google Drive
// (dibaca dengan akun Google yang terhubung di Master Data > Logo & Desain, sama seperti Jadwal Shift & Rekap Kerusakan).
//   Data Karyawan : ekspor sistem HR, baris judul berisi "NIP" & "Nama Depan" (satu baris per karyawan, termasuk yang resign)
//   Grade & Gaji  : tab "Draft Grade" (nilai Teknis Mesin & QC Product dari tiap kepala shift -> rata-rata -> grade A/B/C)
//                   tab "Kebijakan UMK ..." (upah harian, grade, kenaikan, tunjangan, BPJS, THR, tarif per jam & lembur)
// Isi tabel diganti dengan isi spreadsheet setiap sinkron.
import type { RowDataPacket } from 'mysql2'
import { fail } from '@/lib/api'
import { db } from '@/lib/db'
import { readSpreadsheet, spreadsheetId, type SheetTab } from '@/lib/drive'
import { isManagement, type UserProfile } from '@/lib/users'

export const KARYAWAN_SETTING = 'hrd.karyawan_sheet_url'
export const GRADE_SETTING = 'hrd.grade_sheet_url'

// ---------- Hak akses ----------
const hasMenu = (user: UserProfile, key: string) => user.menus.includes(key as never)
export const canViewEmployees = (user: UserProfile) => hasMenu(user, 'karyawan')
export const canViewPayroll = (user: UserProfile) => hasMenu(user, 'grade-gaji')
// Data pribadi (KTP, alamat, BPJS, NPWP, rekening) & sinkron: HRD, GM, admin
export const canManageHr = (user: UserProfile) => isManagement(user) || user.division.code === 'hrd'

export async function loadSheetUrl(key: string) {
  const [[row]] = await db.query<(RowDataPacket & { value: string })[]>('SELECT value FROM app_settings WHERE `key` = ?', [key])
  return row?.value ?? ''
}
export async function saveSheetUrl(key: string, url: string, userId: number) {
  if (!spreadsheetId(url)) fail(400, 'Link spreadsheet tidak valid. Gunakan link "docs.google.com/spreadsheets/d/...".')
  await db.query('INSERT INTO app_settings (`key`, value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)', [key, url.slice(0, 1000), userId])
}

// ---------- Nilai sel ----------
const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()
const norm = (v: unknown) => clean(v).toLowerCase()
// Nama untuk pencocokan antar sheet: "SRI  KISWANTI" -> "sri kiswanti"
export const nameKey = (v: unknown) => norm(v).replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 150)
const pad = (n: number) => String(n).padStart(2, '0')
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, agt: 8, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12 }

// Tanggal: "1979-12-25", "25/12/1979", "04 Apr 2020", angka seri Excel; 1970-01-01 = kosong (nilai bawaan ekspor)
export function parseDate(value: unknown) {
  const v = clean(value).toLowerCase()
  if (!v) return null
  let y: number, m: number, d: number
  let match: RegExpMatchArray | null
  if (/^\d{5}(\.\d+)?$/.test(v)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(v)) * 86_400_000)
    ;[y, m, d] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
  } else if ((match = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  else if ((match = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/))) [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])]
  else if ((match = v.match(/^(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})/)) && MONTHS[match[2]]) [d, m, y] = [Number(match[1]), MONTHS[match[2]], Number(match[3])]
  else return null
  if (y <= 1970 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

// Angka dari sel: 2250000, "2,250,000", "2.250.000", "60,5", "5,95%", "Rp 12.857", "7.627207359E11"
export function parseNumber(value: unknown): number | null {
  let v = clean(value).replace(/rp\.?/i, '').replace(/%$/, '').replace(/\s/g, '')
  if (!v || v === '-') return null
  if (/^-?\d+(\.\d+)?e[+-]?\d+$/i.test(v)) return Number(v)
  const lastDot = v.lastIndexOf('.')
  const lastComma = v.lastIndexOf(',')
  if (lastDot >= 0 && lastComma >= 0) {
    // Pemisah terakhir = desimal
    v = lastComma > lastDot ? v.replace(/\./g, '').replace(',', '.') : v.replace(/,/g, '')
  } else if (lastComma >= 0) {
    v = /^-?\d{1,3}(,\d{3})+$/.test(v) ? v.replace(/,/g, '') : v.replace(',', '.')
  } else if (lastDot >= 0 && /^-?\d{1,3}(\.\d{3})+$/.test(v)) {
    v = v.replace(/\./g, '')
  }
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
// Nomor rekening / NIP: angka besar dari Excel ditulis utuh (7.627207359E11 -> 762720735900)
const idText = (value: unknown, max = 60) => {
  const v = clean(value)
  if (!v) return null
  if (/^\d+(\.\d+)?e\+?\d+$/i.test(v)) return BigInt(Math.round(Number(v))).toString().slice(0, max)
  return v.replace(/\.0+$/, '').slice(0, max)
}
const text = (value: unknown, max: number) => clean(value).slice(0, max) || null

// ---------- Data Karyawan ----------
export type EmployeeRow = {
  nip: string; nama: string; nama_key: string; email: string | null; handphone: string | null; jenis_kelamin: string | null; tempat_lahir: string | null
  tgl_lahir: string | null; agama: string | null; status_menikah: string | null; pendidikan: string | null; tgl_masuk: string | null; departemen: string | null
  divisi: string | null; jabatan: string | null; level_posisi: string | null; status_karyawan: string | null; tgl_akhir_percobaan: string | null; tgl_berhenti: string | null
  nip_atasan: string | null; nama_atasan: string | null; masa_kerja: string | null; hari_kerja: string | null; id_finger: string | null
  no_id: string | null; alamat_id: string | null; alamat_tinggal: string | null; no_bpjs_tk: string | null; no_bpjs_kes: string | null; npwp: string | null
  bank: string | null; no_rek: string | null; rek_an: string | null; status_pajak: string | null; nama_ibu: string | null; jumlah_anak: number | null; sheet_row: number
}

export function parseEmployeeTabs(tabs: SheetTab[]) {
  for (const tab of tabs) {
    const index = tab.rows.slice(0, 15).findIndex((r) => r.some((c) => norm(c) === 'nip') && r.some((c) => /^nama( depan)?$/.test(norm(c))))
    if (index < 0) continue
    const header = tab.rows[index].map(norm)
    const col = (...names: string[]) => header.findIndex((h) => names.includes(h))
    const c = {
      nip: col('nip'), depan: col('nama depan', 'nama'), belakang: col('nama belakang'), email: col('email'), hp: col('handphone', 'no hp', 'hp'),
      tempat: col('tempat lahir'), lahir: col('tgl lahir', 'tanggal lahir'), jk: col('jenis kelamin'), noId: col('no id', 'no ktp', 'nik'), agama: col('agama'),
      menikah: col('st menikah', 'status menikah'), alamatId: col('alamat id', 'alamat ktp'), alamat: col('alamat tinggal', 'alamat'), masuk: col('tgl masuk', 'tanggal masuk'),
      bergabung: col('tgl bergabung'), dept: col('departemen'), divisi: col('divisi'), jabatan: col('jabatan'), level: col('level posisi'),
      percobaan: col('tgl akhir percobaan'), pendidikan: col('pendidikan'), sekolah: col('sekolah'), major: col('major'), anak: col('jumlah anak'), ibu: col('nama ibu kandung'),
      status: col('status karyawan'), berhenti: col('tgl berhenti'), nipAtasan: col('nip atasan'), namaAtasan: col('nama atasan'),
      bpjsTk: col('no bpjs tk'), bpjsKes: col('no bpjs kes'), npwp: col('npwp'), bank: col('bank'), rek: col('no rek'), rekAn: col('rek an'), pajak: col('status pajak'),
      masaKerja: col('masa kerja'), hariKerja: col('hari kerja'), finger: col('id finger'),
    }
    const at = (row: string[], i: number) => (i >= 0 ? row[i] : '')
    const employees: EmployeeRow[] = []
    for (let r = index + 1; r < tab.rows.length; r++) {
      const row = tab.rows[r] ?? []
      const nip = idText(at(row, c.nip), 30)
      const nama = [clean(at(row, c.depan)), clean(at(row, c.belakang))].filter(Boolean).join(' ').slice(0, 150)
      if (!nip || !nama) continue
      const pendidikan = [clean(at(row, c.pendidikan)), clean(at(row, c.sekolah)), clean(at(row, c.major))].filter(Boolean).join(' · ')
      employees.push({
        nip, nama, nama_key: nameKey(nama), email: text(at(row, c.email), 255), handphone: idText(at(row, c.hp), 40), jenis_kelamin: text(at(row, c.jk), 20),
        tempat_lahir: text(at(row, c.tempat), 100), tgl_lahir: parseDate(at(row, c.lahir)), agama: text(at(row, c.agama), 30), status_menikah: text(at(row, c.menikah), 30),
        pendidikan: pendidikan.slice(0, 150) || null, tgl_masuk: parseDate(at(row, c.masuk)) ?? parseDate(at(row, c.bergabung)), departemen: text(at(row, c.dept), 100),
        divisi: text(at(row, c.divisi), 100), jabatan: text(at(row, c.jabatan), 100), level_posisi: text(at(row, c.level), 60), status_karyawan: text(at(row, c.status), 40),
        tgl_akhir_percobaan: parseDate(at(row, c.percobaan)), tgl_berhenti: parseDate(at(row, c.berhenti)), nip_atasan: idText(at(row, c.nipAtasan), 30),
        nama_atasan: text(at(row, c.namaAtasan), 150), masa_kerja: text(at(row, c.masaKerja), 80), hari_kerja: text(at(row, c.hariKerja), 80), id_finger: idText(at(row, c.finger), 40),
        no_id: idText(at(row, c.noId), 40), alamat_id: text(at(row, c.alamatId), 1000), alamat_tinggal: text(at(row, c.alamat), 1000), no_bpjs_tk: idText(at(row, c.bpjsTk), 40),
        no_bpjs_kes: idText(at(row, c.bpjsKes), 40), npwp: idText(at(row, c.npwp), 40), bank: text(at(row, c.bank), 80), no_rek: idText(at(row, c.rek), 60),
        rek_an: text(at(row, c.rekAn), 150), status_pajak: text(at(row, c.pajak), 30), nama_ibu: text(at(row, c.ibu), 150),
        jumlah_anak: parseNumber(at(row, c.anak)), sheet_row: r + 1,
      })
    }
    return { tab: tab.title, employees }
  }
  return { tab: null, employees: [] as EmployeeRow[] }
}

// ---------- Grade operator ----------
export type GradeScore = { penilai: string; teknis: number | null; qc: number | null; total: number | null }
export type GradeRow = { no: number | null; nama: string; nama_key: string; skor: GradeScore[]; rata_rata: number | null; grade: string | null; sheet_row: number }
export type GradeRule = { grade: string; jumlah: number | null; kriteria: string }

export function parseGradeTab(tab: SheetTab) {
  const index = tab.rows.slice(0, 20).findIndex((r) => r.some((c) => norm(c) === 'nama') && r.some((c) => norm(c) === 'grade') && r.some((c) => /kashift|kepala shift|penilai/.test(norm(c))))
  if (index < 0) return null
  const header = tab.rows[index]
  const sub = (tab.rows[index + 1] ?? []).map(norm)
  const no = header.findIndex((c) => /^no\.?$/.test(norm(c)))
  const nama = header.findIndex((c) => norm(c) === 'nama')
  const gradeCol = header.findIndex((c) => norm(c) === 'grade')
  // Tiap kepala shift: 3 kolom (TEKNIS MESIN, QC PRODUCT, TOTAL) mulai dari kolom judulnya
  const penilai = header.map((c, j) => ({ c: clean(c), j })).filter((x) => /kashift|kepala shift|penilai/i.test(x.c)).map((x) => {
    const span = [x.j, x.j + 1, x.j + 2]
    const find = (re: RegExp) => span.find((j) => re.test(sub[j] ?? '')) ?? -1
    return { nama: x.c.replace(/^kashift\s*/i, '').replace(/^kepala shift\s*/i, ''), teknis: find(/teknis/), qc: find(/qc/), total: find(/total/) }
  })
  const rows: GradeRow[] = []
  const rules: GradeRule[] = []
  for (let r = index + 2; r < tab.rows.length; r++) {
    const row = tab.rows[r] ?? []
    // Tabel ringkasan di bawah: "Grade A | 3 | 85% - 90%"
    const ruleAt = row.findIndex((c) => /^grade [a-e]$/i.test(clean(c)))
    if (ruleAt >= 0 && !clean(row[nama])) {
      rules.push({ grade: clean(row[ruleAt]).slice(-1).toUpperCase(), jumlah: parseNumber(row[ruleAt + 1]), kriteria: clean(row[ruleAt + 2]) })
      continue
    }
    const name = clean(row[nama])
    if (!name || /^total$/i.test(name)) continue
    const skor = penilai.map((p) => ({ penilai: p.nama, teknis: parseNumber(row[p.teknis]), qc: parseNumber(row[p.qc]), total: parseNumber(row[p.total]) }))
    // Rata-rata dihitung ulang dari total tiap kepala shift yang sudah menilai (total 0 / kosong = belum dinilai)
    const totals = skor.map((s) => s.total ?? (s.teknis !== null && s.qc !== null ? (s.teknis + s.qc) / 2 : null)).filter((t): t is number => t !== null && t > 0)
    rows.push({
      no: parseNumber(row[no]), nama: name.slice(0, 150), nama_key: nameKey(name), skor,
      rata_rata: totals.length ? Math.round((totals.reduce((a, b) => a + b, 0) / totals.length) * 100) / 100 : null,
      grade: clean(row[gradeCol]).toUpperCase().slice(0, 5) || null, sheet_row: r + 1,
    })
  }
  return { tab: tab.title, penilai: penilai.map((p) => p.nama), rows, rules }
}

// ---------- Kebijakan gaji ----------
export type SalaryRow = {
  no: number | null; nama: string; nama_key: string; no_rek_cimb: string | null; no_rek_lain: string | null; upah_harian: number | null; grade: string | null
  nominal_grade: number | null; upah_harian_total: number | null; upah_bulanan: number | null; kenaikan_harian: number | null; kenaikan_bulanan: number | null
  kenaikan_persen: number | null; tunjangan: number | null; total_terima: number | null; bpjs_laka: number | null; bpjs_kematian: number | null; bpjs_kesehatan: number | null
  thr: number | null; total_bpjs_thr: number | null; tanpa_thr: number | null; tarif_jam: number | null; lembur_jam: number | null; lembur_libur_jam: number | null; sheet_row: number
}
export type SalaryPolicy = {
  judul: string | null; wilayah: string | null; tab: string; hari_kerja: number; faktor_lembur: number | null; faktor_lembur_libur: number | null
  tingkat: { label: string; nilai: number }[]; grade: { grade: string; nominal: number }[]; total: Record<string, number | null>
}

export function parseSalaryTab(tab: SheetTab) {
  const index = tab.rows.slice(0, 20).findIndex((r) => r.some((c) => norm(c) === 'nama') && r.some((c) => /upah .*jam kerja/.test(norm(c))))
  if (index < 0) return null
  const header = tab.rows[index].map(norm)
  const subs = [tab.rows[index + 1] ?? [], tab.rows[index + 2] ?? [], tab.rows[index + 3] ?? []]
  const col = (re: RegExp) => header.findIndex((h) => re.test(h))
  const lastCol = (re: RegExp) => header.reduce((found, h, j) => (re.test(h) ? j : found), -1)
  const c = {
    no: col(/^no\.?$/), nama: col(/^nama$/), cimb: col(/rek cimb/), lain: col(/rek bank lain/), upah: col(/^upah .*jam kerja$/), grade: col(/^grade$/),
    nominal: col(/^nominal grade/), harianTotal: col(/jam kerja \+ tunjangan/), bulanan: col(/^upah \d+ hari kerja/), kenaikan: col(/^kenaikan/),
    tunjangan: col(/^tunjangan$/), total: col(/^total terima$/), bpjs: col(/bpjs/), thr: col(/^thr$/), totalPlus: col(/total terima \(\+/), tanpaThr: col(/tanpa thr/),
    // Tarif per jam muncul dua kali (nilai asli & dibulatkan): pakai yang terakhir (dibulatkan)
    tarif: lastCol(/tarif gaji per-?jam/),
  }
  if (c.nama < 0) return null
  const num = (row: string[], i: number) => (i >= 0 ? parseNumber(row[i]) : null)
  const rows: SalaryRow[] = []
  let total: Record<string, number | null> = {}
  let end = tab.rows.length
  for (let r = index + 1; r < tab.rows.length; r++) {
    const row = tab.rows[r] ?? []
    const name = clean(row[c.nama])
    if (/^total$/i.test(name)) {
      total = { upah_bulanan: num(row, c.bulanan), tunjangan: num(row, c.tunjangan), total_terima: num(row, c.total), total_bpjs_thr: num(row, c.totalPlus), tanpa_thr: num(row, c.tanpaThr) }
      end = r
      break
    }
    // Baris judul lanjutan (Laka Kerja, NOMINAL, ...) tidak punya nama karyawan
    if (!name || parseNumber(row[c.no]) === null) continue
    rows.push({
      no: num(row, c.no), nama: name.slice(0, 150), nama_key: nameKey(name), no_rek_cimb: c.cimb >= 0 ? idText(row[c.cimb]) : null, no_rek_lain: c.lain >= 0 ? text(row[c.lain], 150) : null,
      upah_harian: num(row, c.upah), grade: c.grade >= 0 ? clean(row[c.grade]).toUpperCase().slice(0, 5) || null : null, nominal_grade: num(row, c.nominal),
      upah_harian_total: num(row, c.harianTotal), upah_bulanan: num(row, c.bulanan), kenaikan_harian: num(row, c.kenaikan), kenaikan_bulanan: c.kenaikan >= 0 ? num(row, c.kenaikan + 1) : null,
      kenaikan_persen: c.kenaikan >= 0 ? num(row, c.kenaikan + 2) : null, tunjangan: num(row, c.tunjangan), total_terima: num(row, c.total),
      bpjs_laka: num(row, c.bpjs), bpjs_kematian: c.bpjs >= 0 ? num(row, c.bpjs + 1) : null, bpjs_kesehatan: c.bpjs >= 0 ? num(row, c.bpjs + 2) : null,
      thr: num(row, c.thr), total_bpjs_thr: num(row, c.totalPlus), tanpa_thr: num(row, c.tanpaThr),
      tarif_jam: num(row, c.tarif), lembur_jam: c.tarif >= 0 ? num(row, c.tarif + 1) : null, lembur_libur_jam: c.tarif >= 0 ? num(row, c.tarif + 2) : null, sheet_row: r + 1,
    })
  }
  void end
  // Kebijakan di atas tabel: "95% dari UMR | 2.375.000", "Grade A | 5.000", judul & wilayah UMR; faktor lembur di baris judul tarif (1,2 / 1,5)
  const above = tab.rows.slice(0, index)
  const tingkat: { label: string; nilai: number }[] = []
  const grade: { grade: string; nominal: number }[] = []
  let judul: string | null = null
  let wilayah: string | null = null
  for (const row of above) {
    row.forEach((cell, j) => {
      const v = clean(cell)
      const next = row.slice(j + 1).map((x) => parseNumber(x)).find((x) => x !== null) ?? null
      if (/dari umr/i.test(v) && next !== null) tingkat.push({ label: v, nilai: next })
      else if (/^grade [a-e]$/i.test(v) && next !== null) grade.push({ grade: v.slice(-1).toUpperCase(), nominal: next })
      else if (/kebijakan gaji/i.test(v)) judul = v
      else if (/^umr\b/i.test(v)) wilayah = v
    })
  }
  // Faktor lembur (mis. 1,2 & 1,5) ditulis di bawah judul kolom lembur pada salah satu kelompok tarif
  const tarifCols = header.map((h, j) => (/tarif gaji per-?jam/.test(h) ? j : -1)).filter((j) => j >= 0)
  const faktor = subs.flatMap((row) => tarifCols.map((t) => [parseNumber(row[t + 1]), parseNumber(row[t + 2])])).find(([a, b]) => a !== null && b !== null && a < 5 && b < 5) ?? [null, null]
  const hari = parseNumber(subs.map((row) => row[c.bulanan]).find((x) => parseNumber(x) !== null)) ?? parseNumber(header[c.bulanan]?.match(/\d+/)?.[0]) ?? 25
  const policy: SalaryPolicy = { judul, wilayah, tab: tab.title, hari_kerja: hari, faktor_lembur: faktor[0], faktor_lembur_libur: faktor[1], tingkat, grade, total }
  return { tab: tab.title, rows, policy }
}

export function parseGradeTabs(tabs: SheetTab[]) {
  const grade = tabs.map(parseGradeTab).find((g) => g && g.rows.length) ?? null
  const salary = tabs.map(parseSalaryTab).find((s) => s && s.rows.length) ?? null
  return { grade, salary }
}

// ---------- Baca spreadsheet & simpan ----------
export async function readEmployeeSheet() {
  const url = await loadSheetUrl(KARYAWAN_SETTING)
  const id = spreadsheetId(url) ?? fail(400, 'Link spreadsheet Data Karyawan belum diisi.')
  const tabs = await readSpreadsheet(id)
  return { url, tabs: tabs.map((t) => t.title), ...parseEmployeeTabs(tabs) }
}
export async function readGradeSheet() {
  const url = await loadSheetUrl(GRADE_SETTING)
  const id = spreadsheetId(url) ?? fail(400, 'Link spreadsheet Grade & Gaji belum diisi.')
  const tabs = await readSpreadsheet(id)
  return { url, tabs: tabs.map((t) => t.title), ...parseGradeTabs(tabs) }
}

const EMPLOYEE_COLS = ['nip', 'nama', 'nama_key', 'email', 'handphone', 'jenis_kelamin', 'tempat_lahir', 'tgl_lahir', 'agama', 'status_menikah', 'pendidikan', 'tgl_masuk',
  'departemen', 'divisi', 'jabatan', 'level_posisi', 'status_karyawan', 'tgl_akhir_percobaan', 'tgl_berhenti', 'nip_atasan', 'nama_atasan', 'masa_kerja', 'hari_kerja',
  'id_finger', 'no_id', 'alamat_id', 'alamat_tinggal', 'no_bpjs_tk', 'no_bpjs_kes', 'npwp', 'bank', 'no_rek', 'rek_an', 'status_pajak', 'nama_ibu', 'jumlah_anak', 'sheet_row'] as const

export async function importEmployees(employees: EmployeeRow[]) {
  if (!employees.length) fail(400, 'Tidak ada data karyawan yang dikenali. Pastikan ada baris judul kolom NIP dan Nama Depan.')
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    // NIP yang tidak ada lagi di spreadsheet dihapus; sisanya diperbarui
    await conn.query('DELETE FROM employees WHERE nip NOT IN (?)', [employees.map((e) => e.nip)])
    await conn.query(
      `INSERT INTO employees (${EMPLOYEE_COLS.join(', ')}, synced_at) VALUES ?
       ON DUPLICATE KEY UPDATE ${EMPLOYEE_COLS.filter((k) => k !== 'nip').map((k) => `${k} = VALUES(${k})`).join(', ')}, synced_at = NOW()`,
      [employees.map((e) => [...EMPLOYEE_COLS.map((k) => e[k]), new Date()])],
    )
    await conn.query("INSERT INTO app_settings (`key`, value) VALUES ('hrd.karyawan_synced_at', NOW()) ON DUPLICATE KEY UPDATE value = NOW()")
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
  const aktif = employees.filter((e) => !/resign|keluar|berhenti/i.test(e.status_karyawan ?? '') && !e.tgl_berhenti).length
  return { karyawan: employees.length, aktif }
}

export async function importGrades(parsed: ReturnType<typeof parseGradeTabs>) {
  if (!parsed.grade && !parsed.salary) fail(400, 'Tab Grade (NAMA, KASHIFT, GRADE) maupun tab Kebijakan Gaji (NAMA, UPAH ... JAM KERJA) tidak ditemukan.')
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    if (parsed.grade) {
      await conn.query('DELETE FROM employee_grades')
      await conn.query('INSERT INTO employee_grades (no, nama, nama_key, skor, rata_rata, grade, sheet_row) VALUES ?', [
        parsed.grade.rows.map((g) => [g.no, g.nama, g.nama_key, JSON.stringify(g.skor), g.rata_rata, g.grade, g.sheet_row]),
      ])
    }
    if (parsed.salary) {
      const cols = ['no', 'nama', 'nama_key', 'no_rek_cimb', 'no_rek_lain', 'upah_harian', 'grade', 'nominal_grade', 'upah_harian_total', 'upah_bulanan', 'kenaikan_harian',
        'kenaikan_bulanan', 'kenaikan_persen', 'tunjangan', 'total_terima', 'bpjs_laka', 'bpjs_kematian', 'bpjs_kesehatan', 'thr', 'total_bpjs_thr', 'tanpa_thr',
        'tarif_jam', 'lembur_jam', 'lembur_libur_jam', 'sheet_row'] as const
      await conn.query('DELETE FROM employee_salaries')
      await conn.query(`INSERT INTO employee_salaries (${cols.join(', ')}) VALUES ?`, [parsed.salary.rows.map((s) => cols.map((k) => s[k]))])
    }
    const meta = {
      penilai: parsed.grade?.penilai ?? [], aturan: parsed.grade?.rules ?? [], grade_tab: parsed.grade?.tab ?? null,
      kebijakan: parsed.salary?.policy ?? null, synced_at: new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 19).replace('T', ' '),
    }
    await conn.query("INSERT INTO app_settings (`key`, value) VALUES ('hrd.grade_meta', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [JSON.stringify(meta)])
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
  return { grade: parsed.grade?.rows.length ?? 0, gaji: parsed.salary?.rows.length ?? 0 }
}

// Dipakai cron Drive: sinkron otomatis tanpa pengguna (lewati bila link belum diisi)
export async function syncHrSheets() {
  const out: Record<string, unknown> = {}
  if (spreadsheetId(await loadSheetUrl(KARYAWAN_SETTING))) out.karyawan = await importEmployees((await readEmployeeSheet()).employees)
  if (spreadsheetId(await loadSheetUrl(GRADE_SETTING))) out.grade = await importGrades(await readGradeSheet())
  // Materi training dari folder Drive (bila link sudah diisi)
  const { loadTrainingFolderUrl, syncTraining } = await import('@/lib/training')
  if (await loadTrainingFolderUrl()) out.training = await syncTraining().catch((error) => ({ error: (error as Error).message }))
  // Laporan kehadiran Altius (bila link sudah diisi)
  const absensiUrl = await loadSheetUrl('hrd.absensi_sheet_url')
  if (spreadsheetId(absensiUrl)) {
    const { importAttendance, readAttendanceSheet } = await import('@/lib/attendance')
    out.absensi = await importAttendance((await readAttendanceSheet(absensiUrl)).days, 'drive')
  }
  return out
}
