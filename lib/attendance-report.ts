// Laporan absensi (unduh XLS / cetak PDF) untuk rentang tanggal bebas, mis. laporan HRD ke Keuangan tiap Senin (minggu lalu).
// Hari libur & jam kerja / lembur dihitung sama dengan Grade & Gaji (lib/payroll-weekly.ts: hari libur dari Jadwal Shift).
import type { RowDataPacket } from 'mysql2'
import { db } from '@/lib/db'
import { loadSettings } from '@/lib/payroll'
import { HARI_ID, loadPeriodData, loadRestInfo, weeklyHours } from '@/lib/payroll-weekly'
import { writeXlsx, type XlsxCell } from '@/lib/xlsx-write'

type Row = RowDataPacket & Record<string, unknown>
export const isDate = (v: string | null | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)
const addDay = (d: string, n = 1) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10)
const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
export const tglId = (d: string) => `${Number(d.slice(8, 10))} ${BLN[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`

// Kode sel (seperti laporan Altius): jam masuk–pulang, OFF, TK (tanpa keterangan), S, I, C, DL, NSO (tidak scan pulang)
export function cellCode(c: { status: string; masuk: string | null; pulang: string | null; libur: boolean }, future: boolean) {
  if (c.masuk || c.pulang) return `${c.masuk ?? '--:--'}-${c.pulang ?? 'NSO'}`
  if (future) return ''
  if (c.libur || c.status === 'libur') return 'OFF'
  return ({ izin: 'I', sakit: 'S', cuti: 'C', dinas: 'DL', tidak_hadir: 'TK', tanpa_scan: 'NSI' } as Record<string, string>)[c.status] ?? ''
}

export type ReportRow = {
  no: number; nip: string; nama: string; jabatan: string | null; divisi: string | null; tgl_masuk: string | null; libur_rutin: string
  cells: string[]; offCells: boolean[]
  hadir: number; terlambat: number; terlambat_menit: number; tk: number; izin: number; sakit: number; cuti: number; dinas: number; off: number; tanpa_scan: number
  jam_kerja: number; lembur_rutin: number; lembur_variabel: number; lembur_libur: number
}

export async function attendanceReport(dari: string, sampai: string) {
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
  const dates: string[] = []
  for (let d = dari; d <= sampai; d = addDay(d)) dates.push(d)
  const [att] = await db.query<Row[]>(
    `SELECT a.nip, a.nama, DATE_FORMAT(a.tanggal, '%Y-%m-%d') AS tanggal, a.status, a.shift, TIME_FORMAT(a.jam_masuk, '%H:%i') AS masuk, TIME_FORMAT(a.jam_pulang, '%H:%i') AS pulang,
       a.terlambat_menit, e.jabatan, e.divisi, DATE_FORMAT(e.tgl_masuk, '%Y-%m-%d') AS tgl_masuk
     FROM attendance_days a LEFT JOIN employees e ON e.nip = a.nip WHERE a.tanggal BETWEEN ? AND ? ORDER BY a.nama, a.tanggal`,
    [dari, sampai],
  )
  const settings = await loadSettings()
  const restOf = await loadRestInfo()
  const period = await loadPeriodData({ dari, sampai })
  const people = new Map<string, Row[]>()
  for (const a of att) {
    const k = String(a.nip)
    if (!people.has(k)) people.set(k, [])
    people.get(k)!.push(a)
  }
  const rows: ReportRow[] = []
  for (const [nip, list] of people) {
    const first = list[0]
    const rest = restOf(nip, String(first.nama))
    const w = weeklyHours({ dari, sampai: sampai < today ? sampai : today }, rest, period.attendance.get(nip) ?? [], period.manual.get(nip) ?? [], settings)
    const byDate = new Map(list.map((a) => [String(a.tanggal), a]))
    const offOf = (d: string) => rest.dates.get(d) ?? new Date(`${d}T00:00:00Z`).getUTCDay() === rest.offDay
    const r: ReportRow = {
      no: rows.length + 1, nip, nama: String(first.nama), jabatan: (first.jabatan as string) ?? null, divisi: (first.divisi as string) ?? null, tgl_masuk: (first.tgl_masuk as string) ?? null,
      libur_rutin: rest.source === 'jadwal' ? HARI_ID[rest.offDay] : 'Minggu*', cells: [], offCells: [],
      hadir: 0, terlambat: 0, terlambat_menit: 0, tk: 0, izin: 0, sakit: 0, cuti: 0, dinas: 0, off: 0, tanpa_scan: 0,
      jam_kerja: w.minggu.reduce((t, m) => t + m.jam_kerja, 0), lembur_rutin: w.lembur_rutin, lembur_variabel: w.lembur_variabel, lembur_libur: w.lembur_libur,
    }
    for (const d of dates) {
      const a = byDate.get(d)
      const off = offOf(d)
      const future = d > today
      const status = String(a?.status ?? '')
      const code = a ? cellCode({ status, masuk: (a.masuk as string) ?? null, pulang: (a.pulang as string) ?? null, libur: off }, future) : future ? '' : off ? 'OFF' : ''
      r.cells.push(code)
      r.offCells.push(off)
      if (future || !a) { if (!a && off && !future) r.off++; continue }
      if (a.masuk || a.pulang) {
        r.hadir++
        if (status === 'terlambat') { r.terlambat++; r.terlambat_menit += Number(a.terlambat_menit ?? 0) }
        if (!a.pulang || !a.masuk) r.tanpa_scan++
      } else if (off || status === 'libur') r.off++
      else if (status === 'tidak_hadir') r.tk++
      else if (status === 'izin') r.izin++
      else if (status === 'sakit') r.sakit++
      else if (status === 'cuti') r.cuti++
      else if (status === 'dinas') r.dinas++
    }
    rows.push(r)
  }
  return { dari, sampai, dates, rows, today }
}

const SUMMARY_HEAD = ['Hadir', 'Terlambat (x)', 'Terlambat (menit)', 'Tanpa Keterangan', 'Izin', 'Sakit', 'Cuti', 'Dinas', 'OFF / Libur', 'Scan tidak lengkap', 'Jam kerja', 'Lembur rutin (jam)', 'Lembur variabel (jam)', 'Lembur hari libur (jam)']
export const summaryValues = (r: ReportRow) => [r.hadir, r.terlambat, r.terlambat_menit, r.tk, r.izin, r.sakit, r.cuti, r.dinas, r.off, r.tanpa_scan, r.jam_kerja, r.lembur_rutin, r.lembur_variabel, r.lembur_libur]

export async function attendanceXlsx(dari: string, sampai: string) {
  const rep = await attendanceReport(dari, sampai)
  const title = `LAPORAN ABSENSI KARYAWAN ${tglId(dari)} s/d ${tglId(sampai)}`
  const info = ['NO', 'NIP', 'Nama', 'Jabatan', 'Divisi', 'Tgl Masuk', 'Libur rutin']
  const head = (v: string) => ({ v, s: 'head' as const })
  const rekap: XlsxCell[][] = [
    [{ v: title, s: 'title' }],
    [{ v: `Dicetak dari PAP-MS ${tglId(rep.today)}. Hari libur mengikuti Jadwal Shift (* = belum ada di Jadwal Shift, dianggap Minggu). Jam kerja & lembur dihitung seperti Grade & Gaji.`, s: 'note' }],
    [...info.map(head), ...SUMMARY_HEAD.map(head)],
    ...rep.rows.map((r) => [
      { v: r.no, s: 'center' as const }, { v: r.nip, s: 'cell' as const }, { v: r.nama, s: 'cell' as const }, { v: r.jabatan, s: 'cell' as const }, { v: r.divisi, s: 'cell' as const },
      { v: r.tgl_masuk, s: 'center' as const }, { v: r.libur_rutin, s: 'center' as const }, ...summaryValues(r).map((v) => ({ v, s: 'num' as const })),
    ]),
    [{ v: 'TOTAL', s: 'total' }, ...Array(6).fill({ v: null, s: 'total' }), ...SUMMARY_HEAD.map((_, i) => ({ v: Math.round(rep.rows.reduce((t, r) => t + summaryValues(r)[i], 0) * 100) / 100, s: 'total' as const }))],
  ]
  const harian: XlsxCell[][] = [
    [{ v: title, s: 'title' }],
    [{ v: 'Kode: jam masuk-jam pulang, OFF = libur (Jadwal Shift), TK = tanpa keterangan, I = izin, S = sakit, C = cuti, DL = dinas luar, NSO = tidak scan pulang, NSI = tidak scan masuk.', s: 'note' }],
    [...info.slice(0, 4).map(head), ...rep.dates.map((d) => ({ v: `${HARI_ID[new Date(`${d}T00:00:00Z`).getUTCDay()].slice(0, 3)} ${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`, s: 'head' as const })), head('Hadir'), head('TK'), head('OFF')],
    ...rep.rows.map((r) => [
      { v: r.no, s: 'center' as const }, { v: r.nip, s: 'cell' as const }, { v: r.nama, s: 'cell' as const }, { v: r.jabatan, s: 'cell' as const },
      ...r.cells.map((c, i) => ({ v: c || null, s: (r.offCells[i] && !c.includes(':') ? 'off' : c === 'TK' ? 'sunday' : 'center') as 'off' | 'sunday' | 'center' })),
      { v: r.hadir, s: 'num' as const }, { v: r.tk, s: 'num' as const }, { v: r.off, s: 'num' as const },
    ]),
  ]
  const nameCol = 4
  return {
    filename: `Laporan Absensi ${dari} sd ${sampai}.xlsx`,
    buffer: writeXlsx([
      { title: 'Rekap', rows: rekap, widths: [5, 9, 28, 20, 16, 12, 11, ...SUMMARY_HEAD.map(() => 11)], freeze: { row: 3, col: 3 } },
      { title: 'Harian', rows: harian, widths: [5, 9, 28, 18, ...rep.dates.map(() => 12), 7, 6, 6], freeze: { row: 3, col: nameCol } },
    ]),
  }
}
