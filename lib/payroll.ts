// Grade & Gaji: pengaturan payroll (seperti Pengaturan Payroll HRIS Altius), pengaturan gaji per karyawan
// (seperti isian Payroll pada data Pegawai Altius), dan hitung gaji per periode cut off dari Absensi.
// PPh 21 belum dihitung; metode pajak & status PTKP disimpan untuk perhitungan berikutnya.
import { loadPeriodData, loadRestInfo, weeklyHours, type WeeklyResult } from '@/lib/payroll-weekly'
import type { RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'

type Row = RowDataPacket & Record<string, unknown>
const n = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))

// ---------- Pengaturan payroll ----------
export const SETTING_NUMBERS = ['bpjs_kes_perusahaan', 'bpjs_jht_perusahaan', 'bpjs_jkk', 'bpjs_jkm', 'bpjs_jpn_perusahaan', 'usia_pensiun',
  'bpjs_kes_pegawai', 'bpjs_jht_pegawai', 'bpjs_jpn_pegawai', 'max_bpjs_kes', 'max_bpjs_jpn', 'umr', 'cutoff_tanggal', 'hari_kerja_fix',
  'jam_kerja_harian', 'istirahat_jam', 'batas_jam_mingguan', 'faktor_lembur', 'faktor_lembur_libur', 'toleransi_lembur_menit'] as const
export const PRORATA = { bulan_berjalan: 'Prorata Bulan Berjalan', hari_kerja_fix: 'Hari Kerja Fix', tidak: 'Tanpa Prorata' } as const
export const METODE_PAJAK = { non_gross_up: 'Non Gross Up', gross_up: 'Gross Up' } as const
export const HARI = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'] as const

export type PayrollSettings = Record<(typeof SETTING_NUMBERS)[number], number> & {
  lembur_umr: boolean; cutoff_mingguan: string | null; prorata: keyof typeof PRORATA; metode_pajak: keyof typeof METODE_PAJAK; updated_at: string | null
}

export async function loadSettings(): Promise<PayrollSettings> {
  const [[row]] = await db.query<Row[]>('SELECT * FROM payroll_settings WHERE id = 1')
  if (!row) fail(500, 'Pengaturan payroll belum ada. Jalankan migrasi 058_payroll_karyawan.sql.')
  const out = Object.fromEntries(SETTING_NUMBERS.map((k) => [k, Number(row[k])])) as Record<(typeof SETTING_NUMBERS)[number], number>
  return { ...out, lembur_umr: !!row.lembur_umr, cutoff_mingguan: (row.cutoff_mingguan as string) ?? null, prorata: row.prorata as PayrollSettings['prorata'],
    metode_pajak: row.metode_pajak as PayrollSettings['metode_pajak'], updated_at: row.updated_at ? String(row.updated_at) : null }
}

export async function saveSettings(body: Record<string, unknown>, userId: number) {
  const v: Record<string, unknown> = {}
  for (const k of SETTING_NUMBERS) {
    const x = n(body[k])
    if (x === null || !Number.isFinite(x) || x < 0) fail(400, `Isian ${k.replace(/_/g, ' ')} harus angka 0 atau lebih.`)
    v[k] = x
  }
  if (Number(v.cutoff_tanggal) < 1 || Number(v.cutoff_tanggal) > 31) fail(400, 'Tanggal cut off bulanan harus 1–31.')
  const prorata = str(body.prorata, 20)
  const metode = str(body.metode_pajak, 20)
  const mingguan = str(body.cutoff_mingguan, 10)
  if (!(prorata in PRORATA)) fail(400, 'Tipe prorata tidak dikenal.')
  if (!(metode in METODE_PAJAK)) fail(400, 'Metode perhitungan pajak tidak dikenal.')
  if (mingguan && !HARI.includes(mingguan as (typeof HARI)[number])) fail(400, 'Hari cut off mingguan tidak dikenal.')
  await db.query(
    `UPDATE payroll_settings SET ${SETTING_NUMBERS.map((k) => `${k} = ?`).join(', ')}, lembur_umr = ?, cutoff_mingguan = ?, prorata = ?, metode_pajak = ?, updated_by = ? WHERE id = 1`,
    [...SETTING_NUMBERS.map((k) => v[k]), body.lembur_umr ? 1 : 0, mingguan || null, prorata, metode, userId],
  )
}

// ---------- Gaji per karyawan ----------
export const TIPE_KALKULASI = { kehadiran_cutoff: 'Kehadiran Periode Cut Off', bulanan_tetap: 'Gaji Bulanan Tetap' } as const
export const DITANGGUNG = { pegawai: 'Di Tanggung Pegawai', perusahaan: 'Di Tanggung Perusahaan' } as const
export const PTKP = ['TK/0', 'TK/1', 'TK/2', 'TK/3', 'K/0', 'K/1', 'K/2', 'K/3'] as const

const MONEY = ['gaji_pokok', 'gaji_harian', 'gaji_per_jam', 'tunjangan_lain', 'pendapatan_lain', 'potongan_lain', 'pendapatan_harian', 'lembur_per_jam',
  'lembur_per_jam_libur', 'pokok_lembur', 'cuti_diuangkan', 'nilai_bpjs_tk', 'nilai_bpjs_kes'] as const
const REQUIRED_ZERO = ['gaji_pokok', 'tunjangan_lain', 'pendapatan_lain', 'potongan_lain', 'pendapatan_harian', 'cuti_diuangkan'] // NOT NULL di tabel
const TEXT: [string, number][] = [['no_bpjs_tk', 40], ['no_bpjs_kes', 40], ['npwp', 40], ['bank', 80], ['no_rekening', 60], ['nama_pemilik', 150]]
// Data pribadi: hanya HRD / GM / admin
export const PRIVATE_PAYROLL = ['npwp', 'bank', 'no_rekening', 'nama_pemilik', 'no_bpjs_tk', 'no_bpjs_kes']

export type EmployeePayroll = Record<(typeof MONEY)[number], number | null> & {
  id: number; nip: string; nama: string; jabatan: string | null; divisi: string | null; status_karyawan: string | null; tgl_masuk: string | null
  tgl_berhenti: string | null; tgl_lahir: string | null; tanggal_berlaku: string | null; gaji_per_jam_aktif: boolean; fix_hari_kerja: number | null
  tipe_kalkulasi: keyof typeof TIPE_KALKULASI; bpjs_tk_ditanggung: keyof typeof DITANGGUNG; bpjs_kes_ditanggung: keyof typeof DITANGGUNG
  no_bpjs_tk: string | null; no_bpjs_kes: string | null; npwp: string | null; status_ptkp: string | null; metode_pajak: string | null
  bank: string | null; no_rekening: string | null; nama_pemilik: string | null
}

// Karyawan aktif yang belum punya pengaturan gaji: diisi dari Data Karyawan + tab kebijakan gaji spreadsheet (dicocokkan lewat nama)
export async function seedPayrolls(userId: number | null) {
  const [res] = await db.query<import('mysql2').ResultSetHeader>(
    `INSERT IGNORE INTO employee_payrolls (nip, tanggal_berlaku, gaji_harian, gaji_per_jam_aktif, gaji_per_jam, tunjangan_lain, tipe_kalkulasi,
       lembur_per_jam, lembur_per_jam_libur, no_bpjs_tk, no_bpjs_kes, npwp, status_ptkp, bank, no_rekening, nama_pemilik, updated_by)
     SELECT e.nip, e.tgl_masuk, COALESCE(s.upah_harian_total, s.upah_harian), s.tarif_jam IS NOT NULL, s.tarif_jam, COALESCE(s.tunjangan, 0), 'kehadiran_cutoff',
       s.lembur_jam, s.lembur_libur_jam, e.no_bpjs_tk, e.no_bpjs_kes, e.npwp, LEFT(e.status_pajak, 10), e.bank, e.no_rek, e.rek_an, ?
     FROM employees e
     LEFT JOIN (SELECT nama_key, MAX(upah_harian) AS upah_harian, MAX(upah_harian_total) AS upah_harian_total, MAX(tarif_jam) AS tarif_jam,
       MAX(lembur_jam) AS lembur_jam, MAX(lembur_libur_jam) AS lembur_libur_jam, MAX(tunjangan) AS tunjangan FROM employee_salaries GROUP BY nama_key) s ON s.nama_key = e.nama_key
     WHERE e.tgl_berhenti IS NULL AND COALESCE(e.status_karyawan, '') NOT REGEXP 'resign|keluar|berhenti'`,
    [userId],
  )
  return res.affectedRows
}

const PAYROLL_SELECT = `SELECT p.*, COALESCE(e.nama, p.nip) AS nama, e.jabatan, e.divisi, e.status_karyawan, e.tgl_masuk, e.tgl_berhenti, e.tgl_lahir
  FROM employee_payrolls p LEFT JOIN employees e ON e.nip = p.nip`

function toPayroll(r: Row): EmployeePayroll {
  const out: Record<string, unknown> = { ...r }
  for (const k of MONEY) out[k] = n(r[k])
  out.gaji_per_jam_aktif = !!r.gaji_per_jam_aktif
  out.fix_hari_kerja = n(r.fix_hari_kerja)
  for (const k of ['tanggal_berlaku', 'tgl_masuk', 'tgl_berhenti', 'tgl_lahir']) out[k] = r[k] ? String(r[k]).slice(0, 10) : null
  delete out.updated_by
  return out as EmployeePayroll
}

export async function listPayrolls() {
  const [rows] = await db.query<Row[]>(`${PAYROLL_SELECT} ORDER BY e.tgl_berhenti IS NOT NULL, nama`)
  return rows.map(toPayroll)
}

function readPayrollInput(body: Record<string, unknown>) {
  const v: Record<string, unknown> = {}
  for (const k of MONEY) {
    const x = n(body[k])
    if (x !== null && (!Number.isFinite(x) || x < 0)) fail(400, `Isian ${k.replace(/_/g, ' ')} harus angka 0 atau lebih.`)
    v[k] = x ?? (REQUIRED_ZERO.includes(k) ? 0 : null)
  }
  for (const [k, max] of TEXT) v[k] = str(body[k], max) || null
  const tanggal = str(body.tanggal_berlaku, 10)
  if (tanggal && !/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) fail(400, 'Tanggal berlaku tidak valid.')
  const fix = n(body.fix_hari_kerja)
  if (fix !== null && (!Number.isInteger(fix) || fix < 1 || fix > 31)) fail(400, 'Fix hari kerja harus 1–31.')
  const tipe = str(body.tipe_kalkulasi, 30)
  const tk = str(body.bpjs_tk_ditanggung, 12) || 'pegawai'
  const kes = str(body.bpjs_kes_ditanggung, 12) || 'pegawai'
  const ptkp = str(body.status_ptkp, 10)
  const metode = str(body.metode_pajak, 20)
  if (!(tipe in TIPE_KALKULASI)) fail(400, 'Tipe kalkulasi wajib dipilih.')
  if (!(tk in DITANGGUNG) || !(kes in DITANGGUNG)) fail(400, 'Pilihan BPJS ditanggung tidak dikenal.')
  if (ptkp && !PTKP.includes(ptkp as (typeof PTKP)[number])) fail(400, 'Status PTKP tidak dikenal.')
  if (metode && !(metode in METODE_PAJAK)) fail(400, 'Metode perhitungan pajak tidak dikenal.')
  return {
    ...v, tanggal_berlaku: tanggal || null, gaji_per_jam_aktif: body.gaji_per_jam_aktif ? 1 : 0, fix_hari_kerja: fix, tipe_kalkulasi: tipe,
    bpjs_tk_ditanggung: tk, bpjs_kes_ditanggung: kes, status_ptkp: ptkp || null, metode_pajak: metode || null,
  }
}

export async function createPayroll(body: Record<string, unknown>, userId: number) {
  const nip = str(body.nip, 30) || fail(400, 'Pilih karyawan.')
  const [[emp]] = await db.query<Row[]>('SELECT nip FROM employees WHERE nip = ?', [nip])
  if (!emp) fail(400, 'Karyawan tidak ada di Data Karyawan.')
  const [[dup]] = await db.query<Row[]>('SELECT id FROM employee_payrolls WHERE nip = ?', [nip])
  if (dup) fail(400, 'Karyawan ini sudah punya pengaturan gaji.')
  const v = { ...readPayrollInput(body), nip, updated_by: userId }
  const keys = Object.keys(v)
  await db.query(`INSERT INTO employee_payrolls (${keys.join(', ')}) VALUES (?)`, [keys.map((k) => v[k as keyof typeof v])])
}

export async function updatePayroll(id: number, body: Record<string, unknown>, userId: number) {
  const v = { ...readPayrollInput(body), updated_by: userId }
  const keys = Object.keys(v)
  const [res] = await db.query<import('mysql2').ResultSetHeader>(`UPDATE employee_payrolls SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => v[k as keyof typeof v]), id])
  if (!res.affectedRows) fail(404, 'Pengaturan gaji tidak ditemukan.')
}

// ---------- Periode cut off ----------
const iso = (d: Date) => d.toISOString().slice(0, 10)
// Periode "YYYY-MM" = sehari setelah cut off bulan sebelumnya s/d tanggal cut off bulan itu
// (cut off melewati akhir bulan = akhir bulan, jadi cut off 31 = satu bulan kalender)
export function periodRange(periode: string, cutoff: number) {
  const [y, m] = periode.split('-').map(Number)
  const cut = (yy: number, mm: number) => new Date(Date.UTC(yy, mm - 1, Math.min(cutoff, new Date(Date.UTC(yy, mm, 0)).getUTCDate())))
  const prev = cut(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1)
  return { dari: iso(new Date(prev.getTime() + 86_400_000)), sampai: iso(cut(y, m)) }
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1

// ---------- Hitung gaji ----------
export type Kehadiran = { hadir: number; cuti: number; lembur_menit: number; lembur_libur_menit: number }
export type SlipGaji = {
  nip: string; nama: string; jabatan: string | null; tipe: string; hadir: number; cuti: number; lembur_jam: number; lembur_libur_jam: number
  upah: number; pendapatan_harian: number; lembur: number; tunjangan: number; pendapatan_lain: number; cuti_dibayar: number; bruto: number
  bpjs_pegawai: { jht: number; jpn: number; kes: number }; potongan_bpjs: number; potongan_lain: number; diterima: number
  bpjs_perusahaan: { kes: number; jht: number; jkk: number; jkm: number; jpn: number; total: number }; catatan: string[]
  lembur_rutin_jam: number; tgl_masuk: string | null; divisi: string | null
  // Baris slip gaji (seperti Altius): penghasilan, penghasilan tambahan, potongan
  rincian: { penghasilan: SlipLine[]; tambahan: SlipLine[]; potongan: SlipLine[] }
  mingguan: WeeklyResult | null
}
export type SlipLine = { label: string; nominal: number }

const round = (v: number) => Math.round(v)
const ageAt = (lahir: string | null, tanggal: string) => {
  if (!lahir) return null
  const [ly, lm, ld] = lahir.split('-').map(Number)
  const [ty, tm, td] = tanggal.split('-').map(Number)
  return ty - ly - (tm < lm || (tm === lm && td < ld) ? 1 : 0)
}

export function hitungGaji(p: EmployeePayroll, s: PayrollSettings, k: Kehadiran, range: { dari: string; sampai: string }, w: WeeklyResult | null = null): SlipGaji {
  const catatan: string[] = []
  const tambahan: SlipLine[] = []
  // Pekerja per jam (Kehadiran Periode Cut Off + gaji per jam): upah per minggu maks 40 jam + Lembur Rutin + Lembur Variabel
  const perJam = !!w && p.tipe_kalkulasi !== 'bulanan_tetap' && p.gaji_per_jam_aktif && !!p.gaji_per_jam
  if (w) k = { ...k, hadir: w.hadir }
  const fix = p.fix_hari_kerja || s.hari_kerja_fix || 25
  // Upah harian: isian gaji harian, atau gaji per jam × 7 jam, atau gaji pokok / hari kerja
  const harian = p.gaji_harian ?? (p.gaji_per_jam_aktif && p.gaji_per_jam ? p.gaji_per_jam * 7 : p.gaji_pokok ? p.gaji_pokok / fix : 0)
  let upah: number
  if (p.tipe_kalkulasi === 'bulanan_tetap') {
    const pokok = p.gaji_pokok ?? 0
    if (s.prorata === 'hari_kerja_fix') {
      upah = Math.min(pokok, (pokok / fix) * k.hadir)
      if (k.hadir < fix) catatan.push(`Prorata ${k.hadir} dari ${fix} hari kerja`)
    } else if (s.prorata === 'bulan_berjalan') {
      // Masuk / berhenti di tengah periode: dibayar sebanding hari kalender sebagai karyawan
      const mulai = p.tgl_masuk && p.tgl_masuk > range.dari ? p.tgl_masuk : range.dari
      const akhir = p.tgl_berhenti && p.tgl_berhenti < range.sampai ? p.tgl_berhenti : range.sampai
      const total = daysBetween(range.dari, range.sampai)
      const aktif = Math.max(0, daysBetween(mulai, akhir))
      upah = aktif < total ? (pokok * aktif) / total : pokok
      if (aktif < total) catatan.push(`Prorata ${aktif} dari ${total} hari periode`)
    } else upah = pokok
  } else if (perJam) {
    upah = 0
    for (const m of w!.minggu) {
      const nominal = round(m.jam_dibayar * p.gaji_per_jam!)
      upah += nominal
      if (m.jam_dibayar) tambahan.push({ label: `Minggu ${m.no}-Jam Kerja ${fmtJam(m.jam_dibayar)} Jam`, nominal })
    }
  } else {
    upah = harian * k.hadir
    if (!harian) catatan.push('Gaji harian / per jam / pokok belum diisi')
  }
  // Lembur: tarif per jam di pengaturan karyawan; bila kosong dari dasar lembur / 173 (×1,5 hari kerja, ×2 hari libur)
  const dasarLembur = p.pokok_lembur ?? (s.lembur_umr ? s.umr : p.gaji_pokok || harian * fix)
  const tarif = p.lembur_per_jam ?? (dasarLembur / 173) * 1.5
  const tarifLibur = p.lembur_per_jam_libur ?? (p.lembur_per_jam ?? (dasarLembur / 173) * 2)
  let lemburJam = k.lembur_menit / 60
  let lemburLiburJam = k.lembur_libur_menit / 60
  let lembur = lemburJam * tarif + lemburLiburJam * tarifLibur
  let rutinJam = 0
  if (w) {
    // Tarif pekerja per jam: tarif lembur karyawan, atau tarif per jam × faktor (1,2 hari kerja / 1,5 hari libur)
    const tl = p.lembur_per_jam ?? (perJam ? p.gaji_per_jam! * s.faktor_lembur : tarif)
    const tlLibur = p.lembur_per_jam_libur ?? (perJam ? p.gaji_per_jam! * s.faktor_lembur_libur : tarifLibur)
    rutinJam = perJam ? w.lembur_rutin : 0
    lembur = 0
    const lines: SlipLine[] = []
    if (rutinJam) {
      const nominal = round(rutinJam * tl)
      lembur += nominal
      lines.push({ label: `Lembur Rutin ${fmtJam(rutinJam)} Jam`, nominal })
    }
    for (const m of w.minggu) {
      if (m.lembur_variabel) { const nominal = round(m.lembur_variabel * tl); lembur += nominal; tambahan.push({ label: `Minggu ${m.no}-Lembur Variabel ${fmtJam(m.lembur_variabel)} Jam`, nominal }) }
      if (m.lembur_libur) { const nominal = round(m.lembur_libur * tlLibur); lembur += nominal; tambahan.push({ label: `Minggu ${m.no}-Lembur Variabel ${fmtJam(m.lembur_libur)} Jam (libur)`, nominal }) }
    }
    tambahan.unshift(...lines)
    lemburJam = w.lembur_variabel + rutinJam
    lemburLiburJam = w.lembur_libur
  }
  const pendapatanHarian = (p.pendapatan_harian ?? 0) * k.hadir
  const cuti = (p.cuti_diuangkan ?? 0) * k.cuti
  const tunjangan = p.tunjangan_lain ?? 0
  const lain = p.pendapatan_lain ?? 0
  const bruto = upah + pendapatanHarian + lembur + tunjangan + lain + cuti

  // BPJS: dasar = nilai BPJS di pengaturan karyawan (> 1), selain itu gaji bulanan (pokok, atau harian × hari kerja, minimal UMR)
  const bulanan = Math.max(p.gaji_pokok || harian * fix, s.umr)
  const dasarTk = p.nilai_bpjs_tk && p.nilai_bpjs_tk > 1 ? p.nilai_bpjs_tk : bulanan
  const dasarKes = Math.min(p.nilai_bpjs_kes && p.nilai_bpjs_kes > 1 ? p.nilai_bpjs_kes : bulanan, s.max_bpjs_kes)
  const ikutTk = !!p.no_bpjs_tk
  const ikutKes = !!p.no_bpjs_kes
  const umur = ageAt(p.tgl_lahir, range.sampai)
  const ikutJpn = ikutTk && (umur === null || umur < s.usia_pensiun)
  if (ikutTk && !ikutJpn) catatan.push(`Usia ${umur} ≥ usia pensiun: tanpa JP`)
  const dasarJpn = Math.min(dasarTk, s.max_bpjs_jpn)
  const pct = (base: number, rate: number, ikut: boolean) => (ikut ? round((base * rate) / 100) : 0)
  const pegawai = { jht: pct(dasarTk, s.bpjs_jht_pegawai, ikutTk), jpn: pct(dasarJpn, s.bpjs_jpn_pegawai, ikutJpn), kes: pct(dasarKes, s.bpjs_kes_pegawai, ikutKes) }
  // Ditanggung perusahaan: iuran bagian pegawai dibayar perusahaan (tidak memotong gaji)
  const potongTk = p.bpjs_tk_ditanggung === 'pegawai' ? pegawai.jht + pegawai.jpn : 0
  const potongKes = p.bpjs_kes_ditanggung === 'pegawai' ? pegawai.kes : 0
  const perusahaan = {
    kes: pct(dasarKes, s.bpjs_kes_perusahaan, ikutKes) + (potongKes ? 0 : pegawai.kes),
    jht: pct(dasarTk, s.bpjs_jht_perusahaan, ikutTk) + (potongTk ? 0 : pegawai.jht),
    jkk: pct(dasarTk, s.bpjs_jkk, ikutTk), jkm: pct(dasarTk, s.bpjs_jkm, ikutTk),
    jpn: pct(dasarJpn, s.bpjs_jpn_perusahaan, ikutJpn) + (potongTk ? 0 : pegawai.jpn),
    total: 0,
  }
  perusahaan.total = perusahaan.kes + perusahaan.jht + perusahaan.jkk + perusahaan.jkm + perusahaan.jpn
  if (!ikutTk) catatan.push('Belum ada No. BPJS Ketenagakerjaan')
  if (!ikutKes) catatan.push('Belum ada No. BPJS Kesehatan')
  const potonganBpjs = potongTk + potongKes
  const potonganLain = p.potongan_lain ?? 0
  // Baris slip: gaji pokok (bulanan) di Penghasilan; upah per minggu, lembur, dan pendapatan lain di Penghasilan Tambahan
  const penghasilan: SlipLine[] = [{ label: 'Gaji Pokok', nominal: perJam ? 0 : round(upah) }]
  if (!perJam && !w) tambahan.unshift({ label: `Lembur ${fmtJam(lemburJam + lemburLiburJam)} Jam`, nominal: round(lembur) })
  else if (!perJam && w && !tambahan.length && lembur) tambahan.push({ label: 'Lembur', nominal: round(lembur) })
  if (pendapatanHarian) tambahan.push({ label: `Pendapatan Harian ${k.hadir} Hari`, nominal: round(pendapatanHarian) })
  if (tunjangan) tambahan.push({ label: 'Tunjangan', nominal: round(tunjangan) })
  if (lain) tambahan.push({ label: 'Pendapatan Lain', nominal: round(lain) })
  if (cuti) tambahan.push({ label: `Cuti Diuangkan ${k.cuti} Hari`, nominal: round(cuti) })
  const potongan: SlipLine[] = []
  if (potongKes) potongan.push({ label: 'BPJS K Employee', nominal: potongKes })
  if (potongTk) potongan.push({ label: 'BPJS TK Employee (JHT + JP)', nominal: potongTk })
  if (potonganLain) potongan.push({ label: 'Potongan Lain', nominal: round(potonganLain) })
  const filtered = tambahan.filter((l) => l.nominal)
  return {
    nip: p.nip, nama: p.nama, jabatan: p.jabatan, tipe: TIPE_KALKULASI[p.tipe_kalkulasi] ?? p.tipe_kalkulasi, hadir: k.hadir, cuti: k.cuti,
    lembur_jam: Math.round(lemburJam * 100) / 100, lembur_libur_jam: Math.round(lemburLiburJam * 100) / 100,
    upah: round(upah), pendapatan_harian: round(pendapatanHarian), lembur: round(lembur), tunjangan: round(tunjangan), pendapatan_lain: round(lain), cuti_dibayar: round(cuti),
    bruto: round(bruto), bpjs_pegawai: pegawai, potongan_bpjs: potonganBpjs, potongan_lain: round(potonganLain),
    diterima: round(bruto) - potonganBpjs - round(potonganLain), bpjs_perusahaan: perusahaan, catatan,
    lembur_rutin_jam: rutinJam, tgl_masuk: p.tgl_masuk, divisi: p.divisi,
    rincian: { penghasilan, tambahan: filtered, potongan }, mingguan: w,
  }
}
const fmtJam = (v: number) => String(Math.round(v * 100) / 100).replace('.', ',')

// Lembur di hari OFF Jadwal Shift (atau Minggu bila tidak ada jadwal) memakai tarif lembur hari libur (sama dengan menu Absensi)
const LIBUR = "(a.shift REGEXP '^(off|libur)' OR (a.shift IS NULL AND DAYOFWEEK(a.tanggal) = 1))"

export async function hitungPeriode(periode: string) {
  const s = await loadSettings()
  const range = periodRange(periode, s.cutoff_tanggal)
  const [att] = await db.query<Row[]>(
    `SELECT a.nip, SUM(a.status IN ('hadir', 'terlambat', 'tanpa_scan', 'dinas')) AS hadir, SUM(a.status = 'cuti') AS cuti,
       SUM(IF(${LIBUR}, 0, a.lembur_menit)) AS lembur_menit, SUM(IF(${LIBUR}, a.lembur_menit, 0)) AS lembur_libur_menit
     FROM attendance_days a WHERE a.tanggal BETWEEN ? AND LEAST(?, CURDATE()) GROUP BY a.nip`,
    [range.dari, range.sampai],
  )
  const byNip = new Map(att.map((r) => [String(r.nip), r]))
  const restOf = await loadRestInfo()
  const period = await loadPeriodData(range)
  const payrolls = (await listPayrolls()).filter((p) => !p.tgl_berhenti || p.tgl_berhenti >= range.dari)
  const slips = payrolls
    .filter((p) => !p.tanggal_berlaku || p.tanggal_berlaku <= range.sampai)
    .map((p) => {
      const a = byNip.get(p.nip)
      const weekly = weeklyHours(range, restOf(p.nip, p.nama), period.attendance.get(p.nip) ?? [], period.manual.get(p.nip) ?? [], s)
      const slip = hitungGaji(p, s, { hadir: Number(a?.hadir ?? 0), cuti: Number(a?.cuti ?? 0), lembur_menit: Number(a?.lembur_menit ?? 0), lembur_libur_menit: Number(a?.lembur_libur_menit ?? 0) }, range, weekly)
      if (weekly.sumber_libur === 'bawaan') slip.catatan.push('Libur rutin belum ada di Jadwal Shift, dianggap hari Minggu')
      if (!a) slip.catatan.unshift('Tidak ada data absensi di periode ini')
      return slip
    })
  return { periode, ...range, settings: s, slips }
}
