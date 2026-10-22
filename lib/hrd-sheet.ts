// Tulis balik menu Grade (grade operator & kebijakan gaji) ke spreadsheet "Data Grade dan Kenaikan Gaji".
// Spreadsheet tetap sumber utama: SIMPAP menulis ke sheet lebih dulu, lalu sinkron ulang, sehingga kolom berumus
// (total, rata-rata, upah bulanan, BPJS, THR, tarif lembur, baris TOTAL) tetap dihitung oleh spreadsheet.
// Sel berumus tidak pernah ditimpa; hanya sel isian yang ditulis.
import type { RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageHr, canViewPayroll, GRADE_SETTING, gradeLayout, importGrades, loadSheetUrl, nameKey, parseGradeTab, parseSalaryTab, readGradeSheet, salaryLayout } from '@/lib/hrd'
import type { UserProfile } from '@/lib/users'
import { colLetter, deleteRow, insertRowAtEnd, isFormula, openSheet, readFormulas, readTab, SheetWriteError, writeCells, type Sheet } from '@/lib/sheet-write'

export type HrJenis = 'grade' | 'gaji'
type Cell = string | number
type Values = Record<string, Cell>
export type HrRow = { id: number; nama: string; nama_key: string; sheet_row: number | null }

export const SALARY_FIELDS = ['no', 'nama', 'no_rek_cimb', 'no_rek_lain', 'upah_harian', 'grade', 'nominal_grade', 'upah_harian_total', 'upah_bulanan', 'kenaikan_harian',
  'kenaikan_bulanan', 'kenaikan_persen', 'tunjangan', 'total_terima', 'bpjs_laka', 'bpjs_kematian', 'bpjs_kesehatan', 'thr', 'total_bpjs_thr', 'tanpa_thr',
  'tarif_jam', 'lembur_jam', 'lembur_libur_jam'] as const
const TEXT_FIELDS = ['nama', 'no_rek_cimb', 'no_rek_lain', 'grade']

// Tambah, ubah, hapus: HRD / GM / admin
export function requireGradeEditor(user: UserProfile) {
  if (!canViewPayroll(user) || !canManageHr(user)) fail(403, 'Data Grade dikelola HRD.')
}
export const jenisOf = (value: string | null): HrJenis => (value === 'gaji' ? 'gaji' : value === 'grade' ? 'grade' : fail(400, 'Jenis data tidak dikenal.'))

// ---------- Isian form ----------
const num = (v: unknown, label: string) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : fail(400, `${label} harus berupa angka.`)
}
const sheetText = (v: string) => (/^\d{6,}$/.test(v) ? `'${v}` : v) // nomor rekening panjang tetap teks (tidak jadi 7.6E11)

export function readGradeInput(body: Record<string, unknown>, penilai: string[]): Values {
  const nama = str(body.nama, 150) || fail(400, 'Nama operator wajib diisi.')
  const skor = Array.isArray(body.skor) ? (body.skor as Record<string, unknown>[]) : []
  const out: Values = { no: num(body.no, 'No') ?? '', nama, grade: str(body.grade, 5).toUpperCase() }
  penilai.forEach((p, i) => {
    const s = skor.find((x) => str(x.penilai, 150) === p)
    const teknis = num(s?.teknis, `Nilai Teknis Mesin (${p})`)
    const qc = num(s?.qc, `Nilai QC Product (${p})`)
    for (const v of [teknis, qc]) if (v !== null && (v < 0 || v > 100)) fail(400, 'Nilai harus di antara 0 dan 100.')
    out[`teknis:${i}`] = teknis ?? ''
    out[`qc:${i}`] = qc ?? ''
    out[`total:${i}`] = teknis !== null && qc !== null ? Math.round(((teknis + qc) / 2) * 100) / 100 : ''
  })
  return out
}

export function readSalaryInput(body: Record<string, unknown>): Values {
  const out: Values = {}
  for (const k of SALARY_FIELDS) {
    if (TEXT_FIELDS.includes(k)) out[k] = sheetText(str(body[k], 150))
    else {
      const v = num(body[k], k.replace(/_/g, ' '))
      // Persen ditulis sebagai pecahan (sel berformat persen): 5,95% -> 0.0595
      out[k] = v === null ? '' : k === 'kenaikan_persen' ? v / 100 : v
    }
  }
  out.grade = String(out.grade).toUpperCase().slice(0, 5)
  if (!out.nama) fail(400, 'Nama karyawan wajib diisi.')
  return out
}

// ---------- Tab & kolom ----------
async function findTab(sheet: Sheet, jenis: HrJenis) {
  const [[meta]] = await db.query<(RowDataPacket & { value: string })[]>("SELECT value FROM app_settings WHERE `key` = 'hrd.grade_meta'")
  const m = meta ? JSON.parse(meta.value) : null
  const preferred: string | null = jenis === 'grade' ? m?.grade_tab : m?.kebijakan?.tab
  const titles = [...new Set([preferred, ...sheet.tabs.map((t) => t.title)])].filter((t): t is string => !!t && sheet.tabs.some((x) => x.title === t))
  for (const title of titles) {
    const rows = await readTab(sheet, title)
    if (jenis === 'grade') {
      const layout = gradeLayout(rows)
      const parsed = layout && parseGradeTab({ title, rows })
      if (layout && parsed?.rows.length) {
        const cols: Record<string, number> = { no: layout.no, nama: layout.nama, grade: layout.grade }
        layout.penilai.forEach((p, i) => Object.assign(cols, { [`teknis:${i}`]: p.teknis, [`qc:${i}`]: p.qc, [`total:${i}`]: p.total }))
        return { title, cols, width: layout.width, entries: parsed.rows, penilai: layout.penilai.map((p) => p.nama) }
      }
    } else {
      const layout = salaryLayout(rows)
      const parsed = layout && parseSalaryTab({ title, rows })
      if (layout && parsed?.rows.length) {
        const { c } = layout
        const next = (col: number, step: number) => (col >= 0 ? col + step : -1)
        const cols: Record<string, number> = {
          no: c.no, nama: c.nama, no_rek_cimb: c.cimb, no_rek_lain: c.lain, upah_harian: c.upah, grade: c.grade, nominal_grade: c.nominal,
          upah_harian_total: c.harianTotal, upah_bulanan: c.bulanan, kenaikan_harian: c.kenaikan, kenaikan_bulanan: next(c.kenaikan, 1), kenaikan_persen: next(c.kenaikan, 2),
          tunjangan: c.tunjangan, total_terima: c.total, bpjs_laka: c.bpjs, bpjs_kematian: next(c.bpjs, 1), bpjs_kesehatan: next(c.bpjs, 2), thr: c.thr,
          total_bpjs_thr: c.totalPlus, tanpa_thr: c.tanpaThr, tarif_jam: c.tarif, lembur_jam: next(c.tarif, 1), lembur_libur_jam: next(c.tarif, 2),
        }
        return { title, cols, width: layout.width, entries: parsed.rows, penilai: [] as string[] }
      }
    }
  }
  throw new SheetWriteError(jenis === 'grade'
    ? 'Tab grade (kolom NAMA, KASHIFT ..., GRADE) dengan minimal satu operator tidak ditemukan di spreadsheet.'
    : 'Tab kebijakan gaji (kolom NAMA, UPAH ... JAM KERJA) dengan minimal satu karyawan tidak ditemukan di spreadsheet.')
}

type Tab = Awaited<ReturnType<typeof findTab>>

// Isi sel tanpa rumus pada satu baris; `clear` = kosongkan juga sel isian lain di dalam tabel (baris baru hasil salinan)
async function writeRow(sheet: Sheet, tab: Tab, row: number, values: Values, clear: boolean) {
  const formulas = (await readFormulas(sheet, tab.title, `A${row}:${colLetter(Math.max(tab.width, 1) - 1)}${row}`))[0] ?? []
  const used = new Set<number>()
  const cells: { row: number; col: number; value: Cell }[] = []
  for (const [key, value] of Object.entries(values)) {
    const col = tab.cols[key]
    if (col === undefined || col < 0 || used.has(col) || isFormula(formulas[col])) continue
    used.add(col)
    cells.push({ row, col, value })
  }
  if (clear) formulas.forEach((f, col) => { if (f && !isFormula(f) && !used.has(col) && col < tab.width) cells.push({ row, col, value: '' }) })
  await writeCells(sheet, tab.title, cells)
}

async function open(jenis: HrJenis) {
  const sheet = await openSheet(await loadSheetUrl(GRADE_SETTING))
  return { sheet, tab: await findTab(sheet, jenis) }
}

// Baris di sheet harus masih milik orang yang sama (sheet bisa sudah bergeser sejak sinkron terakhir)
function locate(tab: Tab, old: HrRow) {
  const entry = tab.entries.find((e) => e.sheet_row === old.sheet_row)
  if (!entry || entry.nama_key !== old.nama_key) throw new SheetWriteError(`Baris "${old.nama}" sudah berubah di spreadsheet. Klik Sinkron dulu, lalu ulangi.`)
  return entry
}

// ---------- Tambah / ubah / hapus ----------
export async function hrSheetCreate(jenis: HrJenis, body: Record<string, unknown>) {
  const { sheet, tab } = await open(jenis)
  const values = jenis === 'grade' ? readGradeInput(body, tab.penilai) : readSalaryInput(body)
  const key = nameKey(String(values.nama).replace(/^'/, ''))
  if (tab.entries.some((e) => e.nama_key === key)) fail(400, `"${values.nama}" sudah ada di tab ${tab.title}.`)
  if (values.no === '') values.no = Math.max(0, ...tab.entries.map((e) => e.no ?? 0)) + 1
  const last = Math.max(...tab.entries.map((e) => e.sheet_row))
  const row = await insertRowAtEnd(sheet, tab.title, last)
  await writeRow(sheet, tab, row, values, true)
  return resync()
}

export async function hrSheetUpdate(jenis: HrJenis, old: HrRow, body: Record<string, unknown>) {
  const { sheet, tab } = await open(jenis)
  const entry = locate(tab, old)
  const values = jenis === 'grade' ? readGradeInput(body, tab.penilai) : readSalaryInput(body)
  const key = nameKey(String(values.nama).replace(/^'/, ''))
  if (tab.entries.some((e) => e.nama_key === key && e.sheet_row !== entry.sheet_row)) fail(400, `"${values.nama}" sudah ada di tab ${tab.title}.`)
  // Nomor wajib ada (baris gaji tanpa nomor tidak terbaca saat sinkron)
  if (values.no === '') values.no = entry.no ?? ''
  await writeRow(sheet, tab, entry.sheet_row, values, false)
  return resync()
}

export async function hrSheetDelete(jenis: HrJenis, old: HrRow) {
  const { sheet, tab } = await open(jenis)
  const entry = locate(tab, old)
  await deleteRow(sheet, tab.title, entry.sheet_row)
  return resync()
}

// Data SIMPAP = isi spreadsheet setelah ditulis (nilai rumus ikut terbaru)
const resync = async () => importGrades(await readGradeSheet())
