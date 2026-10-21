// Fase 4 Teknik (Guidance divisi Tehnik): jadwal & checkup perawatan, standar setting mesin,
// peralatan & sparepart (stok), dan pengajuan pembelian ke Purchasing.
import type { RowDataPacket } from 'mysql2'
import { fail } from '@/lib/api'
import { db } from '@/lib/db'
import { notify } from '@/lib/notifications'
import { pushToUsers } from '@/lib/push'
import { isManagement, type UserProfile } from '@/lib/users'

// ---------- Hak akses ----------
const hasMenu = (user: UserProfile, key: string) => user.menus.includes(key as never)
export function requireTeknikMenu(user: UserProfile, key: 'perawatan-mesin' | 'standar-setting' | 'sparepart' | 'pengajuan-pembelian', label: string) {
  if (!hasMenu(user, key)) fail(403, `Anda tidak punya akses ke menu ${label}.`)
}
// Pengelola data teknik: divisi Teknik, GM, admin
export const canManageTeknik = (user: UserProfile) => isManagement(user) || user.division.code === 'teknik'
// Pemroses pengajuan pembelian: divisi Purchasing, GM, admin
export const canProcessPurchase = (user: UserProfile) => isManagement(user) || user.division.code === 'purchasing'

// ---------- Label ----------
export const CHECKUP_RESULT = { baik: 'Baik', perlu_tindakan: 'Perlu tindakan', rusak: 'Rusak' } as const
export type CheckupResult = keyof typeof CHECKUP_RESULT
export const ITEM_JENIS = { sparepart: 'Sparepart', peralatan: 'Peralatan', bahan: 'Bahan (oli, grease, dll.)' } as const
export type ItemJenis = keyof typeof ITEM_JENIS
export const ITEM_KONDISI = { baik: 'Baik', perlu_perbaikan: 'Perlu perbaikan', rusak: 'Rusak' } as const
export type ItemKondisi = keyof typeof ITEM_KONDISI
export const MOVE_JENIS = { masuk: 'Masuk', keluar: 'Keluar', penyesuaian: 'Penyesuaian (stok opname)' } as const
export type MoveJenis = keyof typeof MOVE_JENIS
export const PR_STATUS = { diajukan: 'Diajukan', disetujui: 'Disetujui', dipesan: 'Dipesan', diterima: 'Diterima', ditolak: 'Ditolak', batal: 'Batal' } as const
export type PrStatus = keyof typeof PR_STATUS
export const PR_PRIORITY = { darurat: 'Darurat', tinggi: 'Tinggi', normal: 'Normal' } as const
export type PrPriority = keyof typeof PR_PRIORITY

// ---------- Pembantu ----------
export const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
export function todayWib() {
  return new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
}
export function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
export function decimal(value: unknown, label: string, { required = true, allowNegative = false } = {}) {
  if (value === null || value === undefined || value === '') return required ? fail(400, `${label} wajib diisi.`) : 0
  const n = Number(String(value).replace(',', '.'))
  if (!Number.isFinite(n) || (!allowNegative && n < 0) || Math.abs(n) > 1e12) fail(400, `${label} tidak valid.`)
  return n
}
export async function requireMachine(id: unknown) {
  const machineId = Number(id)
  if (!Number.isInteger(machineId) || machineId <= 0) fail(400, 'Pilih mesin.')
  const [[row]] = await db.query<(RowDataPacket & { id: number; nama: string })[]>('SELECT id, nama FROM machines WHERE id = ?', [machineId])
  return row ?? fail(400, 'Mesin tidak ditemukan.')
}

// Penerima notifikasi per divisi (aktif)
export async function divisionUserIds(codes: string[], leadOnly = false) {
  const [rows] = await db.query<(RowDataPacket & { id: number })[]>(
    `SELECT u.id FROM users u JOIN divisions d ON d.id = u.division_id JOIN roles r ON r.id = u.role_id
     WHERE u.is_active = 1 AND d.code IN (?)${leadOnly ? " AND r.code = 'lead'" : ''}`,
    [codes],
  )
  return rows.map((r) => r.id)
}

// ---------- Stok sparepart ----------
// Catat mutasi stok dan perbarui stok barang. Stok tidak boleh minus (kecuali penyesuaian ke angka nyata).
// Bila stok turun sampai batas minimum: notifikasi Teknik & Purchasing (sekali per barang per hari).
export async function moveStock(input: {
  itemId: number; jenis: 'masuk' | 'keluar' | 'penyesuaian'; jumlah: number; tanggal: string; keterangan?: string | null
  repairId?: number | null; purchaseRequestId?: number | null; userId: number
}) {
  const conn = await db.getConnection()
  let item: RowDataPacket & { id: number; nama: string; kode: string; stok: string; stok_minimum: string; satuan: string }
  let after: number
  try {
    await conn.beginTransaction()
    const [[row]] = await conn.query<(typeof item)[]>('SELECT id, kode, nama, stok, stok_minimum, satuan FROM tech_items WHERE id = ? FOR UPDATE', [input.itemId])
    if (!row) fail(404, 'Barang tidak ditemukan.')
    item = row
    const stok = Number(item.stok)
    const delta = input.jenis === 'masuk' ? input.jumlah : input.jenis === 'keluar' ? -input.jumlah : input.jumlah
    after = stok + delta
    if (after < 0) fail(400, `Stok ${item.nama} tidak cukup (tersisa ${stok.toLocaleString('id-ID')} ${item.satuan}).`)
    await conn.query('UPDATE tech_items SET stok = ? WHERE id = ?', [after, item.id])
    await conn.query(
      `INSERT INTO tech_item_moves (item_id, tanggal, jenis, jumlah, stok_setelah, repair_id, purchase_request_id, keterangan, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [item.id, input.tanggal, input.jenis, input.jumlah, after, input.repairId ?? null, input.purchaseRequestId ?? null, input.keterangan ?? null, input.userId],
    )
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
  const minimum = Number(item!.stok_minimum)
  if (minimum > 0 && after! <= minimum && after! < Number(item!.stok)) {
    const recipients = (await divisionUserIds(['teknik', 'purchasing'])).filter((id) => id !== input.userId)
    await pushToUsers(await notify(recipients, {
      type: 'stok_sparepart',
      title: `Stok menipis: ${item!.nama}`,
      body: `Sisa ${after!.toLocaleString('id-ID')} ${item!.satuan} (minimum ${minimum.toLocaleString('id-ID')}) · ${item!.kode}`,
      page: 'Sparepart & Peralatan',
      pageId: item!.id,
      refKey: `stok:${item!.id}:${todayWib()}`,
    }))
  }
  return after!
}

// ---------- Pengingat perawatan (dipanggil cron reminders) ----------
// Jadwal perawatan yang jatuh tempo hari ini / terlambat: notifikasi ke PIC (atau semua Teknik bila tanpa PIC),
// sekali per jadwal per tanggal jatuh tempo.
export async function createMaintenanceReminders(userId?: number) {
  const [rows] = await db.query<(RowDataPacket & { id: number; judul: string; berikutnya: string; pic_id: number | null; mesin: string })[]>(
    `SELECT p.id, p.judul, p.berikutnya, p.pic_id, m.nama AS mesin FROM maintenance_plans p JOIN machines m ON m.id = p.machine_id
     WHERE p.aktif = 1 AND p.berikutnya <= ? AND p.berikutnya > ? - INTERVAL 30 DAY`,
    [todayWib(), todayWib()],
  )
  if (!rows.length) return []
  const teknik = await divisionUserIds(['teknik'])
  const created: number[] = []
  for (const plan of rows) {
    const recipients = (plan.pic_id ? [plan.pic_id] : teknik).filter((id) => !userId || id === userId)
    if (!recipients.length) continue
    const late = plan.berikutnya < todayWib()
    created.push(...(await notify(recipients, {
      type: 'perawatan_mesin',
      title: `${late ? 'Terlambat · ' : ''}Perawatan ${plan.mesin}: ${plan.judul}`,
      body: `Jatuh tempo ${plan.berikutnya}. Catat checkup setelah dikerjakan.`,
      page: 'Perawatan Mesin',
      pageId: plan.id,
      refKey: `perawatan:${plan.id}:${plan.berikutnya}`,
    })))
  }
  return created
}
