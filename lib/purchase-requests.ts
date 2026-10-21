// Pengajuan pembelian dari Teknik (peralatan / sparepart) dan PPIC (bahan baku / pendukung) ke Purchasing
// (Guidance Tehnik & Purchasing: "Request pembelian barang tehnik oleh divisi tehnik", "PPIC request pembelian bahan").
// Purchasing mencatat nomor PO Accurate yang memenuhi pengajuan (po_number).
// Alur: diajukan -> disetujui -> dipesan -> diterima (stok sparepart bertambah otomatis); bisa ditolak / dibatalkan.
import type { RowDataPacket } from 'mysql2'
import { fail, int, str } from '@/lib/api'
import { db } from '@/lib/db'
import { notify } from '@/lib/notifications'
import { pushToUsers } from '@/lib/push'
import { decimal, divisionUserIds, isDate, PR_PRIORITY, PR_STATUS, type PrPriority, type PrStatus } from '@/lib/teknik'
import type { UserProfile } from '@/lib/users'

export const PR_SELECT = `SELECT p.id, p.nomor, p.keperluan, p.prioritas, p.dibutuhkan, p.status, p.repair_id, r.nomor AS repair_nomor, rm.nama AS repair_mesin,
  p.vendor_accurate_id, av.name AS vendor_name, COALESCE(av.mobile_phone, av.work_phone) AS vendor_phone,
  p.catatan_purchasing, p.po_number, po.accurate_id AS po_accurate_id, po.status_name AS po_status, po.percent_shipped AS po_percent, p.requested_by, ur.name AS requested_name, ud.name AS requester_division, p.processed_by, upr.name AS processed_name,
  p.processed_at, p.received_at, p.created_at, p.updated_at,
  (SELECT COUNT(*) FROM purchase_request_items i WHERE i.request_id = p.id) AS item_count,
  (SELECT GROUP_CONCAT(i.nama ORDER BY i.urut SEPARATOR ', ') FROM purchase_request_items i WHERE i.request_id = p.id) AS item_names
  FROM purchase_requests p
  JOIN users ur ON ur.id = p.requested_by
  JOIN divisions ud ON ud.id = ur.division_id
  LEFT JOIN users upr ON upr.id = p.processed_by
  LEFT JOIN machine_repairs r ON r.id = p.repair_id
  LEFT JOIN machines rm ON rm.id = r.machine_id
  LEFT JOIN accurate_vendors av ON av.accurate_id = p.vendor_accurate_id
  LEFT JOIN accurate_purchase_orders po ON po.number = p.po_number`

type PrRow = RowDataPacket & { id: number; nomor: string; status: string; prioritas: string; requested_by: number; requested_name: string; item_names: string | null; dibutuhkan: string | null; catatan_purchasing: string | null; vendor_name: string | null; po_number: string | null }
export const serializePr = (r: RowDataPacket) => ({ ...(r as PrRow), item_count: Number(r.item_count ?? 0), po_percent: r.po_percent === null ? null : Number(r.po_percent) })

export async function loadPr(id: number) {
  const [[row]] = await db.query<RowDataPacket[]>(`${PR_SELECT} WHERE p.id = ?`, [id])
  return row ? serializePr(row) : fail(404, 'Pengajuan pembelian tidak ditemukan.')
}

export async function loadPrItems(id: number) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT i.id, i.item_id, t.kode AS item_kode, t.stok AS item_stok, i.nama, i.spesifikasi, i.jumlah, i.satuan
     FROM purchase_request_items i LEFT JOIN tech_items t ON t.id = i.item_id WHERE i.request_id = ? ORDER BY i.urut, i.id`,
    [id],
  )
  return rows.map((r) => ({ ...(r as RowDataPacket & { id: number; item_id: number | null; nama: string; satuan: string }), jumlah: Number(r.jumlah), item_stok: r.item_stok === null ? null : Number(r.item_stok) }))
}

export type PrItemInput = { itemId: number | null; nama: string; spesifikasi: string | null; jumlah: number; satuan: string }

// { keperluan, prioritas, dibutuhkan, repair_id, items: [{ item_id?, nama, spesifikasi, jumlah, satuan }] }
export async function readPrInput(body: Record<string, unknown>) {
  const keperluan = str(body.keperluan, 5000)
  if (!keperluan) fail(400, 'Tuliskan keperluan / alasan pembelian.')
  const prioritas = (str(body.prioritas, 20) || 'normal') as PrPriority
  if (!(prioritas in PR_PRIORITY)) fail(400, 'Prioritas tidak valid.')
  const dibutuhkan = str(body.dibutuhkan, 10) || null
  if (dibutuhkan && !isDate(dibutuhkan)) fail(400, 'Tanggal dibutuhkan tidak valid.')
  let repairId: number | null = null
  if (body.repair_id) {
    repairId = int(body.repair_id)
    const [[r]] = await db.query<RowDataPacket[]>('SELECT id FROM machine_repairs WHERE id = ?', [repairId])
    if (!r) fail(400, 'Laporan perbaikan tidak ditemukan.')
  }
  const raw = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : []
  if (!raw.length) fail(400, 'Tambahkan minimal satu barang.')
  if (raw.length > 50) fail(400, 'Maksimal 50 barang per pengajuan.')
  const itemIds = raw.map((r) => int(r?.item_id)).filter((v): v is number => !!v)
  const known = new Map<number, RowDataPacket>()
  if (itemIds.length) {
    const [rows] = await db.query<RowDataPacket[]>('SELECT id, nama, satuan FROM tech_items WHERE id IN (?)', [itemIds])
    for (const r of rows) known.set(r.id, r)
  }
  const items: PrItemInput[] = raw.map((r, i) => {
    const itemId = int(r?.item_id)
    const master = itemId ? known.get(itemId) : undefined
    if (itemId && !master) fail(400, `Barang ke-${i + 1} tidak ditemukan di data sparepart.`)
    const nama = str(r?.nama, 200) || master?.nama
    if (!nama) fail(400, `Isi nama barang ke-${i + 1}.`)
    const jumlah = decimal(r?.jumlah, `Jumlah barang ke-${i + 1}`)
    if (jumlah <= 0) fail(400, `Jumlah barang ke-${i + 1} harus lebih dari 0.`)
    return { itemId: master ? itemId : null, nama, spesifikasi: str(r?.spesifikasi, 500) || null, jumlah, satuan: str(r?.satuan, 40) || master?.satuan || 'pcs' }
  })
  return { keperluan, prioritas, dibutuhkan, repairId, items }
}

// Transisi status yang boleh
export const PR_FLOW: Record<PrStatus, PrStatus[]> = {
  diajukan: ['disetujui', 'ditolak', 'batal'],
  disetujui: ['dipesan', 'diterima', 'ditolak', 'batal'],
  dipesan: ['diterima', 'batal'],
  diterima: [],
  ditolak: [],
  batal: [],
}

// Kabar ke Purchasing (pengajuan baru) atau ke pengaju (status berubah)
export async function notifyPr(id: number, actor: UserProfile, isNew: boolean) {
  const pr = await loadPr(id)
  const recipients = isNew
    ? [...(await divisionUserIds(['purchasing'])), ...(pr.prioritas === 'darurat' ? await divisionUserIds(['general_manager']) : [])]
    : [pr.requested_by]
  const title = isNew
    ? `${pr.prioritas === 'darurat' ? 'DARURAT · ' : ''}Pengajuan pembelian ${pr.nomor} dari ${pr.requested_name}`
    : `Pengajuan ${pr.nomor}: ${PR_STATUS[pr.status as PrStatus]}`
  await pushToUsers(await notify(recipients.filter((uid) => uid !== actor.id), {
    type: 'pengajuan_pembelian',
    title,
    body: [pr.item_names, pr.dibutuhkan && `dibutuhkan ${pr.dibutuhkan}`, !isNew && pr.vendor_name && `supplier ${pr.vendor_name}`, !isNew && pr.po_number && `PO ${pr.po_number}`, !isNew && pr.catatan_purchasing].filter(Boolean).join(' · '),
    page: 'Pengajuan Pembelian',
    pageId: pr.id,
    refKey: `pr:${pr.id}:${pr.status}`,
  }))
}
