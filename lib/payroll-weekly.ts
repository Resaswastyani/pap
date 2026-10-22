// Jam kerja mingguan, Lembur Rutin & Lembur Variabel (sama seperti slip gaji Altius PT PAP).
//   - Minggu dihitung mulai hari libur rutin karyawan (dari Jadwal Shift; bawaan hari Minggu), dipotong periode cut off.
//   - Hari kerja: jam = durasi scan (dibulatkan ke jam, toleransi 15 menit) − 1 jam istirahat, maks 7 jam;
//     kelebihan di atas 8 jam shift = Lembur Variabel (tarif lembur hari kerja).
//   - Bekerja di hari libur rutin / OFF di Jadwal Shift: seluruh jam = Lembur Variabel (tarif lembur hari libur).
//   - Per minggu: jam kerja dibayar maks 40 jam; kelebihannya = Lembur Rutin (6 hari × 7 jam = 42 jam -> 2 jam).
//   - Lembur Variabel manual (overtime_entries) ditambahkan, atau mengganti lembur otomatis di tanggal itu.
import type { RowDataPacket } from 'mysql2'
import { db } from '@/lib/db'

type Row = RowDataPacket & Record<string, unknown>
export type WeeklySettings = { jam_kerja_harian: number; istirahat_jam: number; batas_jam_mingguan: number; toleransi_lembur_menit: number }
export type DayCalc = {
  tanggal: string; libur: boolean; masuk: string | null; pulang: string | null; status: string | null
  jam: number; kerja: number; variabel: number; variabel_libur: number; manual: number; manual_libur: number; catatan: string | null
}
export type WeekCalc = {
  no: number; dari: string; sampai: string; jam_kerja: number; jam_dibayar: number; lembur_rutin: number; lembur_variabel: number; lembur_libur: number; hari: DayCalc[]
}
export type WeeklyResult = { libur_rutin: number; sumber_libur: 'jadwal' | 'bawaan'; minggu: WeekCalc[]; jam_dibayar: number; lembur_rutin: number; lembur_variabel: number; lembur_libur: number; hadir: number }

export const HARI_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay()
const addDay = (d: string, n = 1) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10)
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const r2 = (v: number) => Math.round(v * 100) / 100
const normName = (s: string) => s.toUpperCase().replace(/\s+/g, ' ').trim()

// ---------- Hari libur dari Jadwal Shift ----------
export type RestInfo = { offDay: number; source: 'jadwal' | 'bawaan'; dates: Map<string, boolean> }
// Semua jadwal shift: per karyawan (NIP / nama) tanggal OFF + hari libur rutin (hari yang paling sering OFF)
export async function loadRestInfo() {
  const [rows] = await db.query<Row[]>(
    'SELECT s.periode, r.nama, r.nomor_induk, r.jadwal FROM shift_schedule_rows r JOIN shift_schedules s ON s.id = r.schedule_id ORDER BY s.periode',
  )
  const byKey = new Map<string, { counts: number[]; dates: Map<string, boolean> }>()
  for (const r of rows) {
    let jadwal: string[] = []
    try {
      jadwal = JSON.parse(String(r.jadwal))
    } catch {}
    const keys = [r.nomor_induk ? `nip:${String(r.nomor_induk).trim()}` : null, `nama:${normName(String(r.nama))}`].filter(Boolean) as string[]
    const entry = keys.map((k) => byKey.get(k)).find(Boolean) ?? { counts: [0, 0, 0, 0, 0, 0, 0], dates: new Map<string, boolean>() }
    jadwal.forEach((kode, i) => {
      if (kode === '_') return
      const tanggal = `${r.periode}-${String(i + 1).padStart(2, '0')}`
      const off = kode === ''
      entry.dates.set(tanggal, off)
      if (off) entry.counts[weekday(tanggal)]++
    })
    for (const k of keys) byKey.set(k, entry)
  }
  return (nip: string, nama: string): RestInfo => {
    const e = byKey.get(`nip:${nip}`) ?? byKey.get(`nama:${normName(nama)}`)
    if (!e || !e.counts.some(Boolean)) return { offDay: 0, source: 'bawaan', dates: e?.dates ?? new Map() }
    return { offDay: e.counts.indexOf(Math.max(...e.counts)), source: 'jadwal', dates: e.dates }
  }
}

// ---------- Hitung per karyawan ----------
export type AttendanceRow = { tanggal: string; status: string; jam_masuk: string | null; jam_pulang: string | null; lembur_menit: number }
export type ManualEntry = { tanggal: string; jam: number; hari: 'kerja' | 'libur'; mode: 'tambah' | 'ganti' }

export function weeklyHours(range: { dari: string; sampai: string }, rest: RestInfo, att: AttendanceRow[], manual: ManualEntry[], s: WeeklySettings): WeeklyResult {
  const byDate = new Map(att.map((a) => [a.tanggal, a]))
  const shift = s.jam_kerja_harian + s.istirahat_jam
  const minggu: WeekCalc[] = []
  let hadir = 0
  for (let d = range.dari; d <= range.sampai; d = addDay(d)) {
    if (!minggu.length || (d !== range.dari && weekday(d) === rest.offDay)) {
      minggu.push({ no: minggu.length + 1, dari: d, sampai: d, jam_kerja: 0, jam_dibayar: 0, lembur_rutin: 0, lembur_variabel: 0, lembur_libur: 0, hari: [] })
    }
    const week = minggu[minggu.length - 1]
    week.sampai = d
    const a = byDate.get(d)
    const libur = rest.dates.get(d) ?? weekday(d) === rest.offDay
    const day: DayCalc = { tanggal: d, libur, masuk: a?.jam_masuk?.slice(0, 5) ?? null, pulang: a?.jam_pulang?.slice(0, 5) ?? null, status: a?.status ?? null, jam: 0, kerja: 0, variabel: 0, variabel_libur: 0, manual: 0, manual_libur: 0, catatan: null }
    if (a?.jam_masuk && a?.jam_pulang) {
      let menit = toMin(a.jam_pulang) - toMin(a.jam_masuk)
      if (menit < 0) menit += 1440
      day.jam = Math.floor((menit + s.toleransi_lembur_menit) / 60)
      if (libur) day.variabel_libur = day.jam
      else {
        day.kerja = Math.min(s.jam_kerja_harian, Math.max(0, day.jam - s.istirahat_jam))
        day.variabel = Math.max(0, day.jam - shift, Math.floor((a.lembur_menit ?? 0) / 60))
      }
    } else if ((a?.jam_masuk || a?.jam_pulang) && !libur) {
      // Hanya satu scan: dihitung satu hari kerja penuh
      day.kerja = s.jam_kerja_harian
      day.catatan = 'Scan tidak lengkap, dihitung 1 hari kerja'
    }
    for (const m of manual.filter((x) => x.tanggal === d)) {
      if (m.mode === 'ganti') {
        day.variabel = 0
        day.variabel_libur = 0
      }
    }
    for (const m of manual.filter((x) => x.tanggal === d)) {
      if (m.hari === 'libur') day.manual_libur += m.jam
      else day.manual += m.jam
    }
    if (day.kerja || day.variabel_libur) hadir++
    week.jam_kerja += day.kerja
    week.lembur_variabel += day.variabel + day.manual
    week.lembur_libur += day.variabel_libur + day.manual_libur
    week.hari.push(day)
  }
  for (const w of minggu) {
    w.jam_kerja = r2(w.jam_kerja)
    w.jam_dibayar = Math.min(s.batas_jam_mingguan, w.jam_kerja)
    w.lembur_rutin = r2(Math.max(0, w.jam_kerja - s.batas_jam_mingguan))
    w.lembur_variabel = r2(w.lembur_variabel)
    w.lembur_libur = r2(w.lembur_libur)
  }
  const sum = (k: 'jam_dibayar' | 'lembur_rutin' | 'lembur_variabel' | 'lembur_libur') => r2(minggu.reduce((t, w) => t + w[k], 0))
  return {
    libur_rutin: rest.offDay, sumber_libur: rest.source, minggu, hadir,
    jam_dibayar: sum('jam_dibayar'), lembur_rutin: sum('lembur_rutin'), lembur_variabel: sum('lembur_variabel'), lembur_libur: sum('lembur_libur'),
  }
}

// Absensi & lembur manual semua karyawan dalam periode
export async function loadPeriodData(range: { dari: string; sampai: string }) {
  const [att] = await db.query<Row[]>(
    `SELECT nip, DATE_FORMAT(tanggal, '%Y-%m-%d') AS tanggal, status, TIME_FORMAT(jam_masuk, '%H:%i') AS jam_masuk, TIME_FORMAT(jam_pulang, '%H:%i') AS jam_pulang, lembur_menit
     FROM attendance_days WHERE tanggal BETWEEN ? AND LEAST(?, CURDATE())`,
    [range.dari, range.sampai],
  )
  const [manual] = await db.query<Row[]>(
    "SELECT nip, DATE_FORMAT(tanggal, '%Y-%m-%d') AS tanggal, jam, hari, mode FROM overtime_entries WHERE tanggal BETWEEN ? AND ?",
    [range.dari, range.sampai],
  )
  const group = <T>(rows: Row[], map: (r: Row) => T) => {
    const m = new Map<string, T[]>()
    for (const r of rows) {
      const k = String(r.nip)
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(map(r))
    }
    return m
  }
  return {
    attendance: group<AttendanceRow>(att, (r) => ({ tanggal: String(r.tanggal), status: String(r.status), jam_masuk: (r.jam_masuk as string) ?? null, jam_pulang: (r.jam_pulang as string) ?? null, lembur_menit: Number(r.lembur_menit ?? 0) })),
    manual: group<ManualEntry>(manual, (r) => ({ tanggal: String(r.tanggal), jam: Number(r.jam), hari: r.hari as 'kerja' | 'libur', mode: r.mode as 'tambah' | 'ganti' })),
  }
}
