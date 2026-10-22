import { NextResponse } from 'next/server'
import type { RowDataPacket } from 'mysql2'
import { fail, handle, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageHr, canViewPayroll } from '@/lib/hrd'

type Row = RowDataPacket & Record<string, unknown>
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
// Lembur di hari Minggu / shift OFF dihitung dengan tarif lembur hari libur
const LIBUR = "(DAYOFWEEK(a.tanggal) = 1 OR a.shift REGEXP '^(off|libur)')"

// Absensi: ?periode=YYYY-MM (rekap bulanan) &tanggal=YYYY-MM-DD (daftar harian; default tanggal terakhir yang ada datanya)
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  if (!user.menus.includes('absensi' as never)) fail(403, 'Anda tidak punya akses ke menu Absensi.')
  const params = new URL(request.url).searchParams
  const now = new Date(Date.now() + 7 * 3600e3).toISOString()
  let periode = /^\d{4}-\d{2}$/.test(params.get('periode') ?? '') ? params.get('periode')! : null
  // Bulan default: bulan terakhir yang punya data absensi
  if (!periode) {
    const [[last]] = await db.query<Row[]>('SELECT DATE_FORMAT(MAX(tanggal), "%Y-%m") AS p FROM attendance_days')
    periode = (last?.p as string) ?? now.slice(0, 7)
  }
  const range = ["a.tanggal >= CONCAT(?, '-01')", "a.tanggal < CONCAT(?, '-01') + INTERVAL 1 MONTH"]
  const [[lastDay]] = await db.query<Row[]>(`SELECT MAX(a.tanggal) AS t FROM attendance_days a WHERE ${range.join(' AND ')}`, [periode, periode])
  const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(params.get('tanggal') ?? '') ? params.get('tanggal')! : (lastDay?.t as string) ?? null
  const payroll = canViewPayroll(user)

  const [daily] = tanggal
    ? await db.query<Row[]>(
      `SELECT a.id, a.nip, a.nama, a.tanggal, a.shift, a.jadwal_masuk, a.jadwal_pulang, a.jam_masuk, a.jam_pulang, a.scan, a.status, a.status_asli, a.keterangan,
         a.terlambat_menit, a.pulang_cepat_menit, a.lembur_menit, e.id AS employee_id, e.divisi, e.jabatan
       FROM attendance_days a LEFT JOIN employees e ON e.nip = a.nip
       WHERE a.tanggal = ? ORDER BY FIELD(a.status, 'tidak_hadir', 'terlambat', 'tanpa_scan', 'izin', 'sakit', 'cuti', 'dinas', 'hadir', 'libur'), a.nama`,
      [tanggal],
    )
    : [[] as Row[]]
  const [rekap] = await db.query<Row[]>(
    `SELECT a.nip, MAX(a.nama) AS nama, MAX(e.id) AS employee_id, MAX(e.divisi) AS divisi, MAX(e.jabatan) AS jabatan,
       SUM(a.status IN ('hadir', 'terlambat', 'tanpa_scan')) AS hadir, SUM(a.status = 'terlambat') AS terlambat, SUM(a.terlambat_menit) AS terlambat_menit,
       SUM(a.status = 'tidak_hadir') AS tidak_hadir, SUM(a.status = 'izin') AS izin, SUM(a.status = 'sakit') AS sakit, SUM(a.status = 'cuti') AS cuti,
       SUM(a.status = 'tanpa_scan') AS tanpa_scan, SUM(a.pulang_cepat_menit) AS pulang_cepat_menit,
       SUM(IF(${LIBUR}, 0, a.lembur_menit)) AS lembur_menit, SUM(IF(${LIBUR}, a.lembur_menit, 0)) AS lembur_libur_menit
       ${payroll ? ', MAX(s.lembur_jam) AS tarif_lembur, MAX(s.lembur_libur_jam) AS tarif_lembur_libur' : ''}
     FROM attendance_days a LEFT JOIN employees e ON e.nip = a.nip
     ${payroll ? 'LEFT JOIN employee_salaries s ON s.nama_key = a.nama_key' : ''}
     WHERE ${range.join(' AND ')} GROUP BY a.nip ORDER BY nama`,
    [periode, periode],
  )
  const [perDay] = await db.query<Row[]>(
    `SELECT a.tanggal, SUM(a.status IN ('hadir', 'terlambat', 'tanpa_scan')) AS hadir, SUM(a.status = 'terlambat') AS terlambat, SUM(a.status = 'tidak_hadir') AS tidak_hadir,
       SUM(a.status IN ('izin', 'sakit', 'cuti', 'dinas')) AS izin
     FROM attendance_days a WHERE ${range.join(' AND ')} GROUP BY a.tanggal ORDER BY a.tanggal`,
    [periode, periode],
  )
  const [months] = await db.query<Row[]>('SELECT DISTINCT DATE_FORMAT(tanggal, "%Y-%m") AS p FROM attendance_days ORDER BY p DESC LIMIT 24')
  const [[synced]] = await db.query<Row[]>("SELECT value FROM app_settings WHERE `key` = 'hrd.absensi_synced_at'")
  const num = (r: Row, keys: string[]) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, keys.includes(k) ? Number(v ?? 0) : v]))
  const COUNTS = ['hadir', 'terlambat', 'terlambat_menit', 'tidak_hadir', 'izin', 'sakit', 'cuti', 'tanpa_scan', 'pulang_cepat_menit', 'lembur_menit', 'lembur_libur_menit']
  return NextResponse.json({
    periode, tanggal, months: months.map((m) => m.p),
    daily,
    rekap: rekap.map((r) => {
      const row = num(r, COUNTS) as Record<string, unknown>
      if (payroll) {
        const tarif = n(r.tarif_lembur)
        const tarifLibur = n(r.tarif_lembur_libur)
        row.upah_lembur = tarif === null && tarifLibur === null ? null
          : Math.round(((Number(row.lembur_menit) / 60) * (tarif ?? 0)) + ((Number(row.lembur_libur_menit) / 60) * (tarifLibur ?? tarif ?? 0)))
      }
      return row
    }),
    perDay: perDay.map((d) => num(d, ['hadir', 'terlambat', 'tidak_hadir', 'izin'])),
    synced_at: synced?.value ?? null,
    can: { manage: canManageHr(user), payroll },
  })
})
