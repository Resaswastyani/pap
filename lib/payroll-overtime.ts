// Validasi isian lembur variabel manual (menu Grade & Gaji > Lembur)
import type { RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'

export async function readOvertime(body: Record<string, unknown>) {
  const nip = str(body.nip, 30) || fail(400, 'Pilih karyawan.')
  const [[emp]] = await db.query<RowDataPacket[]>('SELECT nip FROM employees WHERE nip = ?', [nip])
  if (!emp) fail(400, 'Karyawan tidak ada di Data Karyawan.')
  const tanggal = str(body.tanggal, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) fail(400, 'Tanggal tidak valid.')
  const jam = Number(String(body.jam ?? '').replace(',', '.'))
  if (!Number.isFinite(jam) || jam < 0 || jam > 24 || Math.round(jam * 100) !== jam * 100) fail(400, 'Jam lembur harus 0–24 (maks. 2 desimal).')
  const hari = body.hari === 'libur' ? 'libur' : 'kerja'
  const mode = body.mode === 'ganti' ? 'ganti' : 'tambah'
  if (!jam && mode === 'tambah') fail(400, 'Isi jam lembur, atau pilih "ganti lembur otomatis" dengan 0 jam untuk membatalkan lembur otomatis.')
  return { nip, tanggal, jam, hari, mode, keterangan: str(body.keterangan, 500) || null }
}
