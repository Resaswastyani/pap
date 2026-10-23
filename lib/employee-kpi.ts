// KPI & performa karyawan per bulan (Guidance HR "pendataan KPI"; Produksi "pelaporan dan penanggulangan performa operator").
// Indikator otomatis: kehadiran & ketepatan waktu (Absensi), grade operator (Draft Grade kepala shift).
// Indikator penilaian atasan (skala 1-5): produktivitas, kualitas kerja, sikap & kerja sama, plus tindak lanjut pembinaan.
import type { RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageHr } from '@/lib/hrd'
import type { UserProfile } from '@/lib/users'

type Row = RowDataPacket & Record<string, unknown>

export const KPI_INDIKATOR = {
  kehadiran: { label: 'Kehadiran', bobot: 25, auto: true, hint: 'Hari hadir dibanding hari kerja (cuti & libur tidak dihitung)' },
  ketepatan: { label: 'Ketepatan waktu', bobot: 15, auto: true, hint: 'Hari hadir tanpa terlambat' },
  grade: { label: 'Grade operator', bobot: 15, auto: true, hint: 'Rata-rata nilai teknis mesin & QC dari kepala shift' },
  produktivitas: { label: 'Produktivitas', bobot: 20, auto: false, hint: 'Capaian target / output kerja' },
  kualitas: { label: 'Kualitas kerja', bobot: 15, auto: false, hint: 'Ketelitian, reject, kepatuhan SOP' },
  sikap: { label: 'Sikap & kerja sama', bobot: 10, auto: false, hint: 'Disiplin, tanggung jawab, kerja tim' },
} as const
export type Indikator = keyof typeof KPI_INDIKATOR
export const MANUAL = ['produktivitas', 'kualitas', 'sikap'] as const
export type Manual = (typeof MANUAL)[number]

export function predikat(skor: number | null) {
  if (skor === null) return null
  return skor >= 90 ? { kode: 'A', label: 'Sangat baik' } : skor >= 80 ? { kode: 'B', label: 'Baik' } : skor >= 70 ? { kode: 'C', label: 'Cukup' } : skor >= 60 ? { kode: 'D', label: 'Kurang' } : { kode: 'E', label: 'Perlu pembinaan' }
}

export function requireEmployeeKpi(user: UserProfile) {
  if (!user.menus.includes('kpi-karyawan' as never)) fail(403, 'Anda tidak punya akses ke menu KPI Karyawan.')
}
// Penilai: HRD / GM / admin, kepala Produksi & PPIC (atasan operator)
export const canScoreKpi = (user: UserProfile) => canManageHr(user) || ['produksi', 'ppic'].includes(user.division.code)

export function readPeriode(value: unknown) {
  const p = str(value, 7)
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(p) ? p : new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7)
}
const monthEnd = (p: string) => new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)), 0)).toISOString().slice(0, 10)
const r1 = (v: number) => Math.round(v * 10) / 10

export async function computeEmployeeKpi(periode: string) {
  const dari = `${periode}-01`
  const sampai = monthEnd(periode)
  const [emps] = await db.query<Row[]>(
    `SELECT e.nip, e.nama, e.divisi, e.jabatan, e.status_karyawan, g.rata_rata AS grade_nilai, g.grade
     FROM employees e LEFT JOIN employee_grades g ON g.nama_key = e.nama_key
     WHERE (e.tgl_masuk IS NULL OR e.tgl_masuk <= ?) AND (e.tgl_berhenti IS NULL OR e.tgl_berhenti >= ?)
     ORDER BY e.divisi, e.nama`,
    [sampai, dari],
  )
  const [att] = await db.query<Row[]>(
    `SELECT nip, SUM(status IN ('hadir', 'terlambat', 'tanpa_scan', 'dinas')) AS hadir, SUM(status = 'terlambat') AS terlambat, SUM(terlambat_menit) AS terlambat_menit,
       SUM(status = 'tidak_hadir') AS alpa, SUM(status = 'izin') AS izin, SUM(status = 'sakit') AS sakit, SUM(status = 'cuti') AS cuti, SUM(lembur_menit) AS lembur_menit
     FROM attendance_days WHERE tanggal BETWEEN ? AND LEAST(?, CURDATE()) GROUP BY nip`,
    [dari, sampai],
  )
  const [scores] = await db.query<Row[]>('SELECT k.nip, k.nilai, k.catatan, k.tindak_lanjut, u.name AS penilai, k.updated_at FROM employee_kpis k LEFT JOIN users u ON u.id = k.updated_by WHERE k.periode = ?', [periode])
  const attOf = new Map(att.map((a) => [String(a.nip), a]))
  const scoreOf = new Map(scores.map((s) => [String(s.nip), s]))
  const items = emps.map((e) => {
    const a = attOf.get(String(e.nip))
    const n = (k: string) => Number(a?.[k] ?? 0)
    const hariKerja = n('hadir') + n('alpa') + n('izin') + n('sakit')
    const s = scoreOf.get(String(e.nip))
    const nilai = (s?.nilai ? (typeof s.nilai === 'string' ? JSON.parse(s.nilai) : s.nilai) : {}) as Partial<Record<Manual, number>>
    const v: Record<Indikator, number | null> = {
      kehadiran: hariKerja ? r1((n('hadir') / hariKerja) * 100) : null,
      ketepatan: n('hadir') ? r1(100 - (n('terlambat') / n('hadir')) * 100) : null,
      grade: e.grade_nilai === null || e.grade_nilai === undefined ? null : Number(e.grade_nilai),
      produktivitas: nilai.produktivitas ? nilai.produktivitas * 20 : null,
      kualitas: nilai.kualitas ? nilai.kualitas * 20 : null,
      sikap: nilai.sikap ? nilai.sikap * 20 : null,
    }
    // Skor akhir: rata-rata berbobot dari indikator yang ada nilainya
    let w = 0
    let t = 0
    for (const k of Object.keys(KPI_INDIKATOR) as Indikator[]) if (v[k] !== null) { w += KPI_INDIKATOR[k].bobot; t += KPI_INDIKATOR[k].bobot * v[k]! }
    const skor = w ? r1(t / w) : null
    return {
      nip: String(e.nip), nama: String(e.nama), divisi: (e.divisi as string) ?? null, jabatan: (e.jabatan as string) ?? null, status_karyawan: (e.status_karyawan as string) ?? null,
      grade: (e.grade as string) ?? null, nilai: v, skor, predikat: predikat(skor), lengkap: MANUAL.every((m) => nilai[m]),
      skala: { produktivitas: nilai.produktivitas ?? null, kualitas: nilai.kualitas ?? null, sikap: nilai.sikap ?? null },
      absensi: { hari_kerja: hariKerja, hadir: n('hadir'), terlambat: n('terlambat'), terlambat_menit: n('terlambat_menit'), alpa: n('alpa'), izin: n('izin'), sakit: n('sakit'), cuti: n('cuti'), lembur_jam: r1(n('lembur_menit') / 60) },
      catatan: (s?.catatan as string) ?? null, tindak_lanjut: (s?.tindak_lanjut as string) ?? null, penilai: (s?.penilai as string) ?? null,
    }
  })
  return { periode, dari, sampai, items }
}

export async function saveEmployeeKpi(periode: string, body: Record<string, unknown>, userId: number) {
  const nip = str(body.nip, 30) || fail(400, 'Karyawan tidak valid.')
  const [[e]] = await db.query<Row[]>('SELECT nama FROM employees WHERE nip = ?', [nip])
  if (!e) fail(404, 'Karyawan tidak ditemukan.')
  const raw = (body.nilai ?? {}) as Record<string, unknown>
  const nilai: Partial<Record<Manual, number>> = {}
  for (const m of MANUAL) {
    if (raw[m] === '' || raw[m] == null) continue
    const x = Number(raw[m])
    if (!Number.isInteger(x) || x < 1 || x > 5) fail(400, `${KPI_INDIKATOR[m].label}: nilai 1–5.`)
    nilai[m] = x
  }
  await db.query(
    `INSERT INTO employee_kpis (periode, nip, nama, nilai, catatan, tindak_lanjut, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE nama = VALUES(nama), nilai = VALUES(nilai), catatan = VALUES(catatan), tindak_lanjut = VALUES(tindak_lanjut), updated_by = VALUES(updated_by)`,
    [periode, nip, e.nama, JSON.stringify(nilai), str(body.catatan, 1000) || null, str(body.tindak_lanjut, 1000) || null, userId],
  )
}
