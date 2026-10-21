// Standar setting penggunaan mesin (Guidance Tehnik: "Membuat standar setting penggunaan mesin", "Dokumen standar settingan mesin").
// Parameter per mesin; kolom produk kosong = setting umum, terisi = setting khusus produk / ukuran / jenis bahan.
import type { RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'
import { requireMachine } from '@/lib/teknik'

export const SETTING_SELECT = `SELECT s.id, s.machine_id, s.produk, s.parameter, s.nilai, s.satuan, s.toleransi, s.urut, s.catatan, s.updated_at, u.name AS updated_name
  FROM machine_settings s LEFT JOIN users u ON u.id = s.updated_by`

export async function readSettingInput(body: Record<string, unknown>) {
  const machine = await requireMachine(body.machine_id)
  const parameter = str(body.parameter, 150)
  if (!parameter) fail(400, 'Isi nama parameter (mis. Suhu zona 1, Kecepatan screw).')
  const nilai = str(body.nilai, 100)
  if (!nilai) fail(400, `Isi nilai standar untuk ${parameter}.`)
  return {
    machineId: machine.id,
    produk: str(body.produk, 200) || null,
    parameter,
    nilai,
    satuan: str(body.satuan, 40) || null,
    toleransi: str(body.toleransi, 60) || null,
    catatan: str(body.catatan, 500) || null,
  }
}

export async function loadSetting(id: number) {
  const [[row]] = await db.query<RowDataPacket[]>(`${SETTING_SELECT} WHERE s.id = ?`, [id])
  return row ?? fail(404, 'Parameter tidak ditemukan.')
}
