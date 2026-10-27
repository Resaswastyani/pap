// Tambah / ubah / hapus karyawan oleh HRD di PAP-MS (form Data Diri, Pekerjaan, Payroll seperti HRIS Altius).
// Karyawan yang disimpan di sini ditandai sumber = 'pap' sehingga sinkron spreadsheet Data Karyawan tidak menimpanya;
// NIP yang dihapus dicatat di employee_deletions agar tidak muncul lagi dari spreadsheet.
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'
import { nameKey } from '@/lib/hrd'
import type { UserProfile } from '@/lib/users'

type Row = RowDataPacket & Record<string, unknown>

// Kolom yang diisi dari form (pendidikan = "Jenjang · Tempat · Jurusan", sama dengan hasil sinkron)
const COLS = ['nip', 'id_finger', 'nama', 'nama_depan', 'nama_belakang', 'nama_key', 'email', 'handphone', 'tempat_lahir', 'tgl_lahir', 'golongan_darah',
  'tipe_id', 'no_id', 'tgl_akhir_id', 'jenis_kelamin', 'status_menikah', 'agama', 'nama_ibu', 'jumlah_anak', 'kontak_darurat', 'hp_darurat', 'pendidikan',
  'kode_pos', 'alamat_id', 'alamat_tinggal',
  'tgl_masuk', 'departemen', 'divisi', 'jabatan', 'level_posisi', 'nip_atasan', 'nama_atasan', 'hari_kerja', 'status_karyawan', 'tgl_akhir_kontrak',
  'tgl_akhir_percobaan', 'tgl_berhenti', 'masa_kerja',
  'no_bpjs_tk', 'no_bpjs_kes', 'npwp', 'status_pajak', 'bank', 'no_rek', 'rek_an'] as const
type Col = (typeof COLS)[number]
export type EmployeeInput = Record<Col, string | number | null>

const opt = (v: unknown, max: number) => str(typeof v === 'number' ? String(v) : v, max) || null
const date = (v: unknown, label: string) => {
  const s = str(v, 10)
  if (!s) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) fail(400, `${label} tidak valid.`)
  return s
}

// "2 tahun 3 bulan" dari tanggal masuk sampai tanggal berhenti / hari ini (format sama dengan ekspor HRIS)
export function masaKerja(masuk: string | null, sampai: string | null) {
  if (!masuk) return null
  const end = sampai ?? new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
  let bulan = (Number(end.slice(0, 4)) - Number(masuk.slice(0, 4))) * 12 + (Number(end.slice(5, 7)) - Number(masuk.slice(5, 7)))
  if (Number(end.slice(8, 10)) < Number(masuk.slice(8, 10))) bulan--
  if (bulan < 0) return null
  const t = Math.floor(bulan / 12)
  const b = bulan % 12
  return [t ? `${t} tahun` : '', b || !t ? `${b} bulan` : ''].filter(Boolean).join(' ')
}

export async function readEmployeeInput(body: Record<string, unknown>): Promise<EmployeeInput> {
  const nip = str(body.nip, 30)
  if (!nip) fail(400, 'Nomor Induk Pegawai wajib diisi.')
  if (!/^[\w.-]+$/.test(nip)) fail(400, 'NIP hanya boleh huruf, angka, titik, atau tanda hubung.')
  const depan = str(body.nama_depan, 100)
  if (!depan) fail(400, 'Nama depan wajib diisi.')
  const belakang = str(body.nama_belakang, 100)
  const nama = [depan, belakang].filter(Boolean).join(' ').slice(0, 150)
  const email = opt(body.email, 255)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Format email tidak valid.')
  const anakRaw = str(String(body.jumlah_anak ?? ''), 3)
  const anak = anakRaw === '' ? null : Number(anakRaw)
  if (anak !== null && (!Number.isInteger(anak) || anak < 0 || anak > 30)) fail(400, 'Jumlah anak tidak valid.')
  const tglMasuk = date(body.tgl_masuk, 'Tanggal bergabung')
  if (!tglMasuk) fail(400, 'Tanggal bergabung wajib diisi.')
  const status = str(body.status_karyawan, 40)
  if (!status) fail(400, 'Status pekerjaan wajib diisi.')
  const tglBerhenti = date(body.tgl_berhenti, 'Tanggal berhenti')
  const pendidikan = [str(body.pendidikan_jenjang, 40), str(body.pendidikan_tempat, 100), str(body.pendidikan_jurusan, 100)].filter(Boolean).join(' · ').slice(0, 150) || null

  // Atasan dipilih dari daftar karyawan
  const nipAtasan = opt(body.nip_atasan, 30)
  let namaAtasan: string | null = null
  if (nipAtasan) {
    if (nipAtasan === nip) fail(400, 'Atasan tidak boleh karyawan itu sendiri.')
    const [[a]] = await db.query<Row[]>('SELECT nama FROM employees WHERE nip = ?', [nipAtasan])
    if (!a) fail(400, 'Atasan tidak ditemukan di data karyawan.')
    namaAtasan = String(a.nama)
  }

  return {
    nip, id_finger: opt(body.id_finger, 40), nama, nama_depan: depan, nama_belakang: belakang || null, nama_key: nameKey(nama), email, handphone: opt(body.handphone, 40),
    tempat_lahir: opt(body.tempat_lahir, 100), tgl_lahir: date(body.tgl_lahir, 'Tanggal lahir'), golongan_darah: opt(body.golongan_darah, 5),
    tipe_id: opt(body.tipe_id, 20), no_id: opt(body.no_id, 40), tgl_akhir_id: date(body.tgl_akhir_id, 'Tanggal berakhir identitas'),
    jenis_kelamin: opt(body.jenis_kelamin, 20), status_menikah: opt(body.status_menikah, 30), agama: opt(body.agama, 30), nama_ibu: opt(body.nama_ibu, 150),
    jumlah_anak: anak, kontak_darurat: opt(body.kontak_darurat, 150), hp_darurat: opt(body.hp_darurat, 40), pendidikan, kode_pos: opt(body.kode_pos, 10),
    alamat_id: opt(body.alamat_id, 1000), alamat_tinggal: opt(body.alamat_tinggal, 1000),
    tgl_masuk: tglMasuk, departemen: opt(body.departemen, 100), divisi: opt(body.divisi, 100), jabatan: opt(body.jabatan, 100), level_posisi: opt(body.level_posisi, 60),
    nip_atasan: nipAtasan, nama_atasan: namaAtasan, hari_kerja: opt(body.hari_kerja, 80), status_karyawan: status, tgl_akhir_kontrak: date(body.tgl_akhir_kontrak, 'Tanggal berakhir kontrak'),
    tgl_akhir_percobaan: date(body.tgl_akhir_percobaan, 'Akhir masa percobaan'), tgl_berhenti: tglBerhenti, masa_kerja: masaKerja(tglMasuk, tglBerhenti),
    no_bpjs_tk: opt(body.no_bpjs_tk, 40), no_bpjs_kes: opt(body.no_bpjs_kes, 40), npwp: opt(body.npwp, 40), status_pajak: opt(body.status_pajak, 30),
    bank: opt(body.bank, 80), no_rek: opt(body.no_rek, 60), rek_an: opt(body.rek_an, 150),
  }
}

const duplicateNip = (error: unknown, nip: unknown): never => {
  if ((error as { code?: string }).code === 'ER_DUP_ENTRY') fail(400, `NIP ${nip} sudah dipakai karyawan lain.`)
  throw error
}

export async function createEmployee(user: UserProfile, d: EmployeeInput) {
  try {
    const [res] = await db.query<ResultSetHeader>(
      `INSERT INTO employees (${COLS.join(', ')}, sumber, diubah_oleh, diubah_pada) VALUES (${COLS.map(() => '?').join(', ')}, 'pap', ?, NOW())`,
      [...COLS.map((c) => d[c]), user.id],
    )
    // NIP yang pernah dihapus lalu ditambah lagi tidak lagi dilewati sinkron
    await db.query('DELETE FROM employee_deletions WHERE nip = ?', [d.nip])
    return res.insertId
  } catch (error) {
    return duplicateNip(error, d.nip)
  }
}

export async function loadEmployeeRow(id: number) {
  const [[e]] = await db.query<Row[]>('SELECT * FROM employees WHERE id = ?', [id])
  return e ?? fail(404, 'Karyawan tidak ditemukan.')
}

export async function updateEmployee(user: UserProfile, id: number, d: EmployeeInput) {
  const old = await loadEmployeeRow(id)
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query(`UPDATE employees SET ${COLS.map((c) => `${c} = ?`).join(', ')}, sumber = 'pap', diubah_oleh = ?, diubah_pada = NOW() WHERE id = ?`, [...COLS.map((c) => d[c]), user.id, id])
    // NIP / nama berubah: bawahan ikut menunjuk atasan yang benar
    if (old.nip !== d.nip || old.nama !== d.nama) await conn.query('UPDATE employees SET nip_atasan = ?, nama_atasan = ? WHERE nip_atasan = ?', [d.nip, d.nama, old.nip])
    if (old.nip !== d.nip) await conn.query('INSERT IGNORE INTO employee_deletions (nip, nama, deleted_by) VALUES (?, ?, ?)', [old.nip, old.nama, user.id])
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    duplicateNip(error, d.nip)
  } finally {
    conn.release()
  }
}

export async function deleteEmployee(user: UserProfile, id: number) {
  const e = await loadEmployeeRow(id)
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('DELETE FROM employees WHERE id = ?', [id])
    await conn.query('UPDATE employees SET nip_atasan = NULL, nama_atasan = NULL WHERE nip_atasan = ?', [e.nip])
    await conn.query('INSERT INTO employee_deletions (nip, nama, deleted_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE nama = VALUES(nama), deleted_by = VALUES(deleted_by), deleted_at = NOW()', [e.nip, e.nama, user.id])
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
  return { nip: String(e.nip), nama: String(e.nama) }
}
