import { NextResponse } from 'next/server'
import type { RowDataPacket } from 'mysql2'
import { fail, handle, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageHr, canViewPayroll } from '@/lib/hrd'

type Row = RowDataPacket & Record<string, unknown>
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
// Lembur di hari Minggu / shift OFF dihitung dengan tarif lembur hari libur
const LIBUR = "(DAYOFWEEK(a.tanggal) = 1 OR a.shift REGEXP '^(off|libur)')"
// Status tampilan: laporan Altius ikut memuat jadwal hari-hari mendatang dengan status "Tidak Hadir" (belum ada scan).
// Tanggal yang belum terjadi = terjadwal; hari ini tanpa scan = belum scan (bukan tidak hadir).
const STATUS = `CASE
  WHEN a.tanggal > CURDATE() AND a.jam_masuk IS NULL AND a.status IN ('tidak_hadir', 'tanpa_scan', 'hadir', 'terlambat') THEN 'terjadwal'
  WHEN a.tanggal = CURDATE() AND a.jam_masuk IS NULL AND a.status = 'tidak_hadir' THEN 'belum_scan'
  ELSE a.status END`

// Absensi: ?periode=YYYY-MM (matriks & rekap bulanan) &tanggal=YYYY-MM-DD (daftar harian)
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  if (!user.menus.includes('absensi' as never)) fail(403, 'Anda tidak punya akses ke menu Absensi.')
  const params = new URL(request.url).searchParams
  const [[today]] = await db.query<Row[]>('SELECT CURDATE() AS t')
  const todayStr = String(today.t)
  let periode = /^\d{4}-\d{2}$/.test(params.get('periode') ?? '') ? params.get('periode')! : null
  // Bulan default: bulan ini bila sudah ada datanya, selain itu bulan terakhir yang punya data sampai hari ini
  if (!periode) {
    const [[last]] = await db.query<Row[]>('SELECT DATE_FORMAT(MAX(tanggal), "%Y-%m") AS p FROM attendance_days WHERE tanggal <= CURDATE()')
    periode = (last?.p as string) ?? todayStr.slice(0, 7)
  }
  const range = ["a.tanggal >= CONCAT(?, '-01')", "a.tanggal < CONCAT(?, '-01') + INTERVAL 1 MONTH"]
  // Tanggal default: hari ini, atau hari terakhir yang sudah lewat di bulan itu
  const [[lastDay]] = await db.query<Row[]>(
    `SELECT COALESCE(MAX(IF(a.tanggal <= CURDATE(), a.tanggal, NULL)), MIN(a.tanggal)) AS t FROM attendance_days a WHERE ${range.join(' AND ')}`, [periode, periode],
  )
  const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(params.get('tanggal') ?? '') ? params.get('tanggal')! : (lastDay?.t as string) ?? null
  const payroll = canViewPayroll(user)

  const [daily] = tanggal
    ? await db.query<Row[]>(
      `SELECT a.id, a.nip, a.nama, a.tanggal, a.shift, a.jadwal_masuk, a.jadwal_pulang, a.jam_masuk, a.jam_pulang, a.scan, ${STATUS} AS status, a.status_asli, a.keterangan,
         a.terlambat_menit, a.pulang_cepat_menit, a.lembur_menit, e.id AS employee_id, e.divisi, e.jabatan
       FROM attendance_days a LEFT JOIN employees e ON e.nip = a.nip
       WHERE a.tanggal = ? ORDER BY FIELD(${STATUS}, 'tidak_hadir', 'terlambat', 'tanpa_scan', 'belum_scan', 'izin', 'sakit', 'cuti', 'dinas', 'hadir', 'terjadwal', 'libur'), a.nama`,
      [tanggal],
    )
    : [[] as Row[]]
  // Matriks sebulan (seperti Jadwal Shift): satu baris per karyawan, satu sel per tanggal
  const [cells] = await db.query<Row[]>(
    `SELECT a.nip, a.nama, DAY(a.tanggal) AS hari, a.shift, ${STATUS} AS status, a.jam_masuk, a.jam_pulang, a.terlambat_menit, a.lembur_menit, a.keterangan,
       e.jabatan, e.divisi
     FROM attendance_days a LEFT JOIN employees e ON e.nip = a.nip WHERE ${range.join(' AND ')} ORDER BY a.nama, a.tanggal`,
    [periode, periode],
  )
  const rows = new Map<string, { nip: string; nama: string; jabatan: string | null; divisi: string | null; cells: Record<number, unknown> }>()
  for (const c of cells) {
    const key = String(c.nip)
    const row = rows.get(key) ?? { nip: key, nama: String(c.nama), jabatan: (c.jabatan as string) ?? null, divisi: (c.divisi as string) ?? null, cells: {} }
    row.cells[Number(c.hari)] = {
      s: c.status, sh: c.shift ?? null, m: c.jam_masuk ? String(c.jam_masuk).slice(0, 5) : null, p: c.jam_pulang ? String(c.jam_pulang).slice(0, 5) : null,
      t: Number(c.terlambat_menit ?? 0), l: Number(c.lembur_menit ?? 0), k: c.keterangan ?? null,
    }
    rows.set(key, row)
  }
  // Rekap hanya sampai hari ini (jadwal mendatang tidak dihitung)
  const [rekap] = await db.query<Row[]>(
    `SELECT a.nip, MAX(a.nama) AS nama, MAX(e.id) AS employee_id, MAX(e.divisi) AS divisi, MAX(e.jabatan) AS jabatan,
       SUM(a.status IN ('hadir', 'terlambat', 'tanpa_scan')) AS hadir, SUM(a.status = 'terlambat') AS terlambat, SUM(a.terlambat_menit) AS terlambat_menit,
       SUM(${STATUS} = 'tidak_hadir') AS tidak_hadir, SUM(a.status = 'izin') AS izin, SUM(a.status = 'sakit') AS sakit, SUM(a.status = 'cuti') AS cuti,
       SUM(a.status = 'tanpa_scan') AS tanpa_scan, SUM(a.pulang_cepat_menit) AS pulang_cepat_menit,
       SUM(IF(${LIBUR}, 0, a.lembur_menit)) AS lembur_menit, SUM(IF(${LIBUR}, a.lembur_menit, 0)) AS lembur_libur_menit
       ${payroll ? ', MAX(s.lembur_jam) AS tarif_lembur, MAX(s.lembur_libur_jam) AS tarif_lembur_libur' : ''}
     FROM attendance_days a LEFT JOIN employees e ON e.nip = a.nip
     ${payroll ? 'LEFT JOIN employee_salaries s ON s.nama_key = a.nama_key' : ''}
     WHERE ${range.join(' AND ')} AND a.tanggal <= CURDATE() GROUP BY a.nip ORDER BY nama`,
    [periode, periode],
  )
  const [perDay] = await db.query<Row[]>(
    `SELECT a.tanggal, SUM(a.status IN ('hadir', 'terlambat', 'tanpa_scan')) AS hadir, SUM(a.status = 'terlambat') AS terlambat, SUM(${STATUS} = 'tidak_hadir') AS tidak_hadir,
       SUM(a.status IN ('izin', 'sakit', 'cuti', 'dinas')) AS izin
     FROM attendance_days a WHERE ${range.join(' AND ')} AND a.tanggal <= CURDATE() GROUP BY a.tanggal ORDER BY a.tanggal`,
    [periode, periode],
  )
  const [months] = await db.query<Row[]>('SELECT DISTINCT DATE_FORMAT(tanggal, "%Y-%m") AS p FROM attendance_days ORDER BY p DESC LIMIT 24')
  const [[synced]] = await db.query<Row[]>("SELECT value FROM app_settings WHERE `key` = 'hrd.absensi_synced_at'")
  const num = (r: Row, keys: string[]) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, keys.includes(k) ? Number(v ?? 0) : v]))
  const COUNTS = ['hadir', 'terlambat', 'terlambat_menit', 'tidak_hadir', 'izin', 'sakit', 'cuti', 'tanpa_scan', 'pulang_cepat_menit', 'lembur_menit', 'lembur_libur_menit']
  return NextResponse.json({
    periode, tanggal, today: todayStr, months: months.map((m) => m.p),
    daily,
    matrix: [...rows.values()],
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
