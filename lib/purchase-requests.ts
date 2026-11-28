// Pengajuan pembelian dari Teknik (peralatan / sparepart) dan PPIC (bahan baku / pendukung) ke Purchasing
// (Guidance Tehnik & Purchasing: "Request pembelian barang tehnik oleh divisi tehnik", "PPIC request pembelian bahan").
// Purchasing mencatat nomor PO Accurate yang memenuhi pengajuan (po_number).
// Alur: diajukan -> diperiksa Purchasing -> disetujui (GM dulu, lalu Accounting) -> dipesan -> diterima (stok sparepart bertambah otomatis); bisa ditolak / dibatalkan.
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { fail, int, str } from '@/lib/api'
import { db } from '@/lib/db'
import { notify } from '@/lib/notifications'
import { pushToUsers } from '@/lib/push'
import { canCheckPurchase, decimal, divisionUserIds, isDate, PR_PRIORITY, PR_STATUS, type PrPriority, type PrStatus } from '@/lib/teknik'
import type { UserProfile } from '@/lib/users'

export const PR_SELECT = `SELECT p.id, p.nomor, p.keperluan, p.prioritas, p.dibutuhkan, p.status, p.repair_id, r.nomor AS repair_nomor, rm.nama AS repair_mesin,
  p.vendor_accurate_id, av.name AS vendor_name, COALESCE(av.mobile_phone, av.work_phone) AS vendor_phone,
  p.catatan_purchasing, p.po_number, po.accurate_id AS po_accurate_id, po.status_name AS po_status, po.percent_shipped AS po_percent, p.requested_by, ur.name AS requested_name, ud.name AS requester_division, p.processed_by, upr.name AS processed_name,
  p.processed_at, p.checked_at, uck.name AS checked_name, p.gm_approved_at, ugm.name AS gm_approved_name, p.acc_approved_at, uacc.name AS acc_approved_name,
  p.gm_ttd_nama, p.gm_ttd_jabatan, p.gm_ttd_token, p.acc_ttd_nama, p.acc_ttd_jabatan, p.acc_ttd_token, p.received_at, p.created_at, p.updated_at,
  (SELECT COUNT(*) FROM purchase_request_items i WHERE i.request_id = p.id) AS item_count,
  (SELECT GROUP_CONCAT(i.nama ORDER BY i.urut SEPARATOR ', ') FROM purchase_request_items i WHERE i.request_id = p.id) AS item_names
  FROM purchase_requests p
  JOIN users ur ON ur.id = p.requested_by
  JOIN divisions ud ON ud.id = ur.division_id
  LEFT JOIN users upr ON upr.id = p.processed_by
  LEFT JOIN users uck ON uck.id = p.checked_by
  LEFT JOIN users ugm ON ugm.id = p.gm_approved_by
  LEFT JOIN users uacc ON uacc.id = p.acc_approved_by
  LEFT JOIN machine_repairs r ON r.id = p.repair_id
  LEFT JOIN machines rm ON rm.id = r.machine_id
  LEFT JOIN accurate_vendors av ON av.accurate_id = p.vendor_accurate_id
  LEFT JOIN accurate_purchase_orders po ON po.number = p.po_number`

type PrRow = RowDataPacket & { id: number; nomor: string; status: string; checked_name: string | null; gm_approved_name: string | null; acc_approved_name: string | null; gm_ttd_nama: string | null; gm_ttd_jabatan: string | null; gm_ttd_token: string | null; acc_ttd_nama: string | null; acc_ttd_jabatan: string | null; acc_ttd_token: string | null; prioritas: string; requested_by: number; requested_name: string; item_names: string | null; dibutuhkan: string | null; catatan_purchasing: string | null; vendor_name: string | null; po_number: string | null }
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

// Simpan pengajuan + barangnya (nomor PP-YYYYMM-00001), lalu kabari Purchasing
export async function createPr(input: Awaited<ReturnType<typeof readPrInput>>, user: UserProfile) {
  const conn = await db.getConnection()
  let id: number
  try {
    await conn.beginTransaction()
    const [res] = await conn.query<ResultSetHeader>(
      // Dibuat Purchasing sendiri: langsung dianggap sudah diperiksa Purchasing (lanjut ke GM)
      'INSERT INTO purchase_requests (keperluan, prioritas, dibutuhkan, repair_id, requested_by, checked_by, checked_at) VALUES (?, ?, ?, ?, ?, ?, IF(? IS NULL, NULL, NOW()))',
      [input.keperluan, input.prioritas, input.dibutuhkan, input.repairId, user.id, ...Array(2).fill(canCheckPurchase(user) ? user.id : null)],
    )
    id = res.insertId
    await conn.query("UPDATE purchase_requests SET nomor = CONCAT('PP-', DATE_FORMAT(created_at, '%Y%m'), '-', LPAD(id, 5, '0')) WHERE id = ?", [id])
    await conn.query(
      'INSERT INTO purchase_request_items (request_id, item_id, nama, spesifikasi, jumlah, satuan, urut) VALUES ?',
      [input.items.map((it, i) => [id, it.itemId, it.nama, it.spesifikasi, it.jumlah, it.satuan, i + 1])],
    )
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
  await notifyPr(id!, user, true)
  return id!
}

// Transisi status yang boleh
export const PR_FLOW: Record<PrStatus, PrStatus[]> = {
  // diajukan -> disetujui hanya lewat persetujuan GM + Accounting (approvePr), bukan ubah status langsung
  diajukan: ['ditolak', 'batal'],
  disetujui: ['dipesan', 'diterima', 'ditolak', 'batal'],
  dipesan: ['diterima', 'batal'],
  diterima: [],
  ditolak: [],
  batal: [],
}

// Kabar per tahap: pengajuan baru -> Purchasing (periksa); diperiksa -> GM; disetujui GM -> Accounting;
// tiap tahap juga ke pengaju. Disetujui penuh / ditolak -> pengaju & Purchasing (yang memesan).
type PrStep = 'purchasing' | 'gm' | 'accounting'
export async function notifyPr(id: number, actor: UserProfile, isNew: boolean, step?: PrStep) {
  const pr = await loadPr(id)
  const purchasing = await divisionUserIds(['purchasing'])
  const darurat = pr.prioritas === 'darurat' ? 'DARURAT · ' : ''
  const body = (extra: (string | false | null | undefined)[]) => [pr.item_names, pr.dibutuhkan && `dibutuhkan ${pr.dibutuhkan}`, ...extra].filter(Boolean).join(' · ')
  const send = async (users: number[], title: string, text: string, key: string) =>
    pushToUsers(await notify([...new Set(users)].filter((uid) => uid !== actor.id), { type: 'pengajuan_pembelian', title, body: text, page: 'Pengajuan Pembelian', pageId: pr.id, refKey: `pr:${pr.id}:${key}` }))
  // Giliran berikutnya yang harus bertindak
  const ask = async (who: 'purchasing' | 'gm' | 'accounting') => {
    const users = who === 'purchasing' ? purchasing : await divisionUserIds([who === 'gm' ? 'general_manager' : 'accounting'])
    const title = who === 'purchasing'
      ? `${darurat}Perlu diperiksa Purchasing: pengajuan pembelian ${pr.nomor} dari ${pr.requested_name}`
      : `${darurat}Perlu persetujuan ${who === 'gm' ? 'GM' : 'Accounting'}: pengajuan pembelian ${pr.nomor} (${who === 'gm' ? 'sudah diperiksa Purchasing' : 'sudah disetujui GM'})`
    await send(users, title, body([`diajukan ${pr.requested_name}`, pr.vendor_name && `supplier ${pr.vendor_name}`, pr.catatan_purchasing]), `minta-${who}`)
  }
  if (isNew) return ask(pr.checked_name ? 'gm' : 'purchasing')
  if (step && pr.status === 'diajukan') {
    const next = step === 'purchasing' ? 'GM' : 'Accounting'
    await send([pr.requested_by, ...(step === 'gm' ? purchasing : [])], `Pengajuan ${pr.nomor} ${step === 'purchasing' ? 'sudah diperiksa Purchasing' : 'disetujui GM'}, menunggu ${next}`, body([pr.vendor_name && `supplier ${pr.vendor_name}`]), `ok-${step}`)
    return ask(step === 'purchasing' ? 'gm' : 'accounting')
  }
  await send(
    [pr.requested_by, ...(['disetujui', 'ditolak'].includes(pr.status) ? purchasing : [])],
    `Pengajuan ${pr.nomor}: ${PR_STATUS[pr.status as PrStatus]}${pr.status === 'disetujui' ? ' GM & Accounting' : ''}`,
    body([pr.vendor_name && `supplier ${pr.vendor_name}`, pr.po_number && `PO ${pr.po_number}`, pr.catatan_purchasing]),
    pr.status,
  )
}

// Gambar tanda tangan persetujuan GM / Accounting lewat token acak (dipakai /api/ttd/<token> untuk halaman cetak & Word)
export async function prSignatureImage(token: string) {
  if (!/^[a-f0-9]{32}$/.test(token)) return null
  const [[r]] = await db.query<RowDataPacket[]>(
    'SELECT IF(gm_ttd_token = ?, gm_ttd_image, acc_ttd_image) AS image FROM purchase_requests WHERE gm_ttd_token = ? OR acc_ttd_token = ? LIMIT 1',
    [token, token, token],
  )
  const m = r ? String(r.image ?? '').match(/^data:(image\/(?:png|jpeg));base64,(.+)$/) : null
  return m ? { type: m[1], data: Buffer.from(m[2], 'base64') } : null
}
