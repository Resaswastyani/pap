// Pengajuan Pembelian GA: kebutuhan umum kantor (ATK, kebersihan, pulsa / paket data, langganan, perlengkapan, perbaikan gedung)
// diajukan ke General Affair; terpisah dari Pengajuan Pembelian Purchasing (bahan baku / sparepart).
// Alur: diajukan -> disetujui (GA / GM) -> dibeli (GA mencatat toko & harga realisasi) -> selesai (barang diserahkan);
// bisa ditolak atau dibatalkan pengaju selama belum dibeli.
import type { RowDataPacket } from 'mysql2'
import { fail, int, str } from '@/lib/api'
import { db } from '@/lib/db'
import { notify } from '@/lib/notifications'
import { pushToUsers } from '@/lib/push'
import { divisionUserIds } from '@/lib/teknik'
import { isManagement, type UserProfile } from '@/lib/users'

export const GA_PR_STATUS = { diajukan: 'Diajukan', disetujui: 'Disetujui', dibeli: 'Dibeli', selesai: 'Selesai', ditolak: 'Ditolak', batal: 'Dibatalkan' } as const
export type GaPrStatus = keyof typeof GA_PR_STATUS
export const GA_PR_PRIORITY = { darurat: 'Darurat', tinggi: 'Tinggi', normal: 'Normal' } as const
export const GA_PR_CATEGORIES = ['ATK', 'Kebersihan', 'Konsumsi', 'Pulsa / paket data', 'Langganan aplikasi', 'Internet / WiFi', 'Perlengkapan kantor', 'Perbaikan gedung', 'Lainnya'] as const

// Langkah berikutnya yang boleh dari tiap status
export const GA_PR_FLOW: Record<GaPrStatus, GaPrStatus[]> = {
  diajukan: ['disetujui', 'ditolak', 'batal'],
  disetujui: ['dibeli', 'batal'],
  dibeli: ['selesai'],
  selesai: [],
  ditolak: [],
  batal: [],
}

const hasMenu = (user: UserProfile, key: string) => user.menus.includes(key as never)
export const canRequestGa = (user: UserProfile) => hasMenu(user, 'ga-pengajuan')
// Proses (setuju, tolak, dibeli, selesai) & lihat semua pengajuan: General Affair, GM, admin
export const canProcessGa = (user: UserProfile) => isManagement(user) || user.division.code === 'general_affair'
export function requireGaRequest(user: UserProfile) {
  if (!canRequestGa(user)) fail(403, 'Anda tidak punya akses ke menu Pengajuan GA.')
}

export const GA_PR_SELECT = `SELECT r.*, u.name AS requested_name, d.name AS requested_division, a.name AS approved_name,
    (SELECT COUNT(*) FROM ga_purchase_request_items i WHERE i.request_id = r.id) AS item_count,
    (SELECT GROUP_CONCAT(i.nama ORDER BY i.id SEPARATOR ', ') FROM ga_purchase_request_items i WHERE i.request_id = r.id) AS item_names,
    (SELECT SUM(i.jumlah * COALESCE(i.harga_estimasi, 0)) FROM ga_purchase_request_items i WHERE i.request_id = r.id) AS total_estimasi,
    (SELECT SUM(i.jumlah * i.harga_realisasi) FROM ga_purchase_request_items i WHERE i.request_id = r.id) AS total_realisasi
  FROM ga_purchase_requests r JOIN users u ON u.id = r.requested_by JOIN divisions d ON d.id = u.division_id LEFT JOIN users a ON a.id = r.approved_by`

export async function loadGaPr(id: number, user: UserProfile) {
  const [[row]] = await db.query<(RowDataPacket & Record<string, unknown>)[]>(`${GA_PR_SELECT} WHERE r.id = ?`, [id])
  if (!row || (!canProcessGa(user) && row.requested_by !== user.id)) fail(404, 'Pengajuan tidak ditemukan.')
  return row!
}
export async function loadGaPrItems(id: number) {
  const [rows] = await db.query<(RowDataPacket & Record<string, unknown>)[]>('SELECT * FROM ga_purchase_request_items WHERE request_id = ? ORDER BY id', [id])
  return rows.map((i) => ({ id: Number(i.id), nama: String(i.nama), satuan: String(i.satuan), catatan: (i.catatan as string | null) ?? null, jumlah: Number(i.jumlah), harga_estimasi: i.harga_estimasi === null ? null : Number(i.harga_estimasi), harga_realisasi: i.harga_realisasi === null ? null : Number(i.harga_realisasi) }))
}
export const serializeGaPr = (r: Record<string, unknown>) => ({
  ...r, item_count: Number(r.item_count ?? 0), total_estimasi: r.total_estimasi === null ? null : Number(r.total_estimasi), total_realisasi: r.total_realisasi === null ? null : Number(r.total_realisasi),
})

const money = (v: unknown, label: string) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : fail(400, `${label} harus angka positif.`)
}

export type GaPrItem = { nama: string; jumlah: number; satuan: string; harga_estimasi: number | null; catatan: string | null }
export function readGaPrInput(body: Record<string, unknown>) {
  const judul = str(body.judul, 200) || fail(400, 'Judul pengajuan wajib diisi.')
  const kategori = str(body.kategori, 60)
  if (!(GA_PR_CATEGORIES as readonly string[]).includes(kategori)) fail(400, 'Pilih kategori pengajuan.')
  const prioritas = str(body.prioritas, 10) || 'normal'
  if (!(prioritas in GA_PR_PRIORITY)) fail(400, 'Prioritas tidak dikenal.')
  const dibutuhkan = str(body.dibutuhkan, 10) || null
  if (dibutuhkan && !/^\d{4}-\d{2}-\d{2}$/.test(dibutuhkan)) fail(400, 'Tanggal dibutuhkan tidak valid.')
  const raw = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : []
  const items: GaPrItem[] = raw.filter((i) => str(i.nama, 200)).slice(0, 50).map((i, n) => {
    const jumlah = Number(i.jumlah)
    if (!Number.isFinite(jumlah) || jumlah <= 0) fail(400, `Jumlah barang ke-${n + 1} harus lebih dari 0.`)
    return { nama: str(i.nama, 200), jumlah, satuan: str(i.satuan, 40) || 'pcs', harga_estimasi: money(i.harga_estimasi, `Perkiraan harga barang ke-${n + 1}`), catatan: str(i.catatan, 500) || null }
  })
  if (!items.length) fail(400, 'Isi minimal satu barang / jasa.')
  return { judul, kategori, prioritas, dibutuhkan, keperluan: str(body.keperluan, 5000) || null, items }
}

export async function saveGaPrItems(id: number, items: GaPrItem[]) {
  await db.query('DELETE FROM ga_purchase_request_items WHERE request_id = ?', [id])
  await db.query('INSERT INTO ga_purchase_request_items (request_id, nama, jumlah, satuan, harga_estimasi, catatan) VALUES ?', [
    items.map((i) => [id, i.nama, i.jumlah, i.satuan, i.harga_estimasi, i.catatan]),
  ])
}

// Realisasi harga per barang saat ditandai dibeli: [{ id, harga_realisasi }]
export async function saveGaRealisasi(id: number, list: unknown) {
  if (!Array.isArray(list)) return
  for (const r of list as Record<string, unknown>[]) {
    const itemId = int(r.id)
    if (itemId) await db.query('UPDATE ga_purchase_request_items SET harga_realisasi = ? WHERE id = ? AND request_id = ?', [money(r.harga_realisasi, 'Harga realisasi'), itemId, id])
  }
}

// Kabar ke General Affair (pengajuan baru; darurat juga ke GM) atau ke pengaju (status berubah)
export async function notifyGaPr(id: number, actor: UserProfile, isNew: boolean) {
  const [[pr]] = await db.query<(RowDataPacket & Record<string, unknown>)[]>(`${GA_PR_SELECT} WHERE r.id = ?`, [id])
  if (!pr) return
  const recipients = isNew
    ? [...(await divisionUserIds(['general_affair'])), ...(pr.prioritas === 'darurat' ? await divisionUserIds(['general_manager']) : [])]
    : [Number(pr.requested_by)]
  const status = pr.status as GaPrStatus
  await pushToUsers(await notify(recipients.filter((uid) => uid !== actor.id), {
    type: 'pengajuan_pembelian',
    title: isNew ? `${pr.prioritas === 'darurat' ? 'DARURAT · ' : ''}Pengajuan GA ${pr.nomor}: ${pr.judul}` : `Pengajuan GA ${pr.nomor}: ${GA_PR_STATUS[status]}`,
    body: [pr.item_names, `dari ${pr.requested_name}`, pr.dibutuhkan && `dibutuhkan ${pr.dibutuhkan}`, !isNew && pr.catatan_ga].filter(Boolean).join(' · '),
    page: 'Pengajuan GA',
    pageId: Number(pr.id),
    refKey: `ga-pr:${pr.id}:${status}`,
  }))
}
