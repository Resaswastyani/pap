// Kendala Customer: keluhan customer + tracking penanganan (status, PIC, target, akar masalah, tindakan, solusi, kepuasan).
// Semua yang punya menu boleh melihat & mencatat keluhan baru. Yang boleh memproses (ubah status / isi penanganan): semua Marketing,
// pelapor, PIC, Kepala divisi (lead), General Manager & admin.
import type { RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'
import { notify } from '@/lib/notifications'
import { pushToUsers } from '@/lib/push'
import { isManagement, type UserProfile } from '@/lib/users'

export const CC_STATUS = { baru: 'Baru', investigasi: 'Investigasi', perbaikan: 'Perbaikan', konfirmasi: 'Konfirmasi customer', selesai: 'Selesai', ditolak: 'Ditolak' } as const
export type CcStatus = keyof typeof CC_STATUS
export const CC_FLOW: CcStatus[] = ['baru', 'investigasi', 'perbaikan', 'konfirmasi', 'selesai']
export const CC_KATEGORI = {
  kualitas: 'Kualitas produk (sobek / bocor / getas)', ukuran: 'Ukuran / ketebalan tidak sesuai', cetak: 'Cetakan / warna / logo', kemasan: 'Kemasan / packing',
  pengiriman: 'Pengiriman terlambat', kurang_kirim: 'Kurang kirim', salah_kirim: 'Salah kirim / salah produk', administrasi: 'Faktur / administrasi', pelayanan: 'Pelayanan', lainnya: 'Lainnya',
} as const
export const CC_PRIORITAS = { rendah: 'Rendah', normal: 'Normal', tinggi: 'Tinggi', kritis: 'Kritis' } as const
export const CC_CHANNEL = { whatsapp: 'WhatsApp', telepon: 'Telepon', email: 'Email', kunjungan: 'Kunjungan', marketplace: 'Marketplace', lainnya: 'Lainnya' } as const
export const CC_SOLUSI = { ganti_barang: 'Ganti barang', retur: 'Retur / refund', kirim_ulang: 'Kirim ulang / kirim kekurangan', potongan_harga: 'Potongan harga / kredit', perbaikan: 'Perbaikan / rework', penjelasan: 'Penjelasan / edukasi', lainnya: 'Lainnya' } as const
// Target penyelesaian bawaan per prioritas (hari)
export const CC_SLA_DAYS: Record<keyof typeof CC_PRIORITAS, number> = { kritis: 1, tinggi: 3, normal: 7, rendah: 14 }

export function requireComplaints(user: UserProfile) {
  if (!user.role.isAdmin && !user.menus.includes('kendala-customer' as never)) fail(403, 'Anda tidak punya akses ke menu Kendala Customer.')
}
export const canManageComplaints = (user: UserProfile) => isManagement(user) || user.role.code === 'lead'
// Semua Marketing (Marketing, Development, Maintenance, Digital; staff maupun lead) boleh memproses semua keluhan
export const isMarketing = (user: UserProfile) => user.division.code === 'marketing' || user.division.code.startsWith('marketing_')
export const canProcess = (user: UserProfile, c: { pic_id: number | null; dilaporkan_oleh: number | null }) =>
  canManageComplaints(user) || isMarketing(user) || c.pic_id === user.id || c.dilaporkan_oleh === user.id

type Row = RowDataPacket & Record<string, unknown>
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))

export const todayWib = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)

const SELECT = `SELECT c.*, DATE_FORMAT(c.tanggal, '%Y-%m-%d') AS tanggal, DATE_FORMAT(c.target_selesai, '%Y-%m-%d') AS target_selesai,
    up.name AS pic_nama, dp.name AS pic_divisi, ur.name AS pelapor_nama, cu.customer_no,
    (SELECT COUNT(*) FROM note_attachments na WHERE na.owner_type = 'complaint' AND na.owner_id = c.id) AS lampiran,
    (SELECT MAX(u.created_at) FROM customer_complaint_updates u WHERE u.complaint_id = c.id) AS update_terakhir
  FROM customer_complaints c
  LEFT JOIN users up ON up.id = c.pic_id LEFT JOIN divisions dp ON dp.id = up.division_id
  LEFT JOIN users ur ON ur.id = c.dilaporkan_oleh
  LEFT JOIN customers cu ON cu.id = c.customer_id`

export function serializeComplaint(r: Row) {
  const status = String(r.status) as CcStatus
  const today = todayWib()
  const open = status !== 'selesai' && status !== 'ditolak'
  const target = (r.target_selesai as string) ?? null
  return {
    id: Number(r.id), nomor: String(r.nomor), tanggal: String(r.tanggal), customer_id: num(r.customer_id), customer_nama: String(r.customer_nama), customer_no: (r.customer_no as string) ?? null,
    kontak: (r.kontak as string) ?? null, channel: String(r.channel), judul: String(r.judul), kategori: String(r.kategori), prioritas: String(r.prioritas), deskripsi: String(r.deskripsi),
    produk: (r.produk as string) ?? null, item_accurate_id: num(r.item_accurate_id), referensi: (r.referensi as string) ?? null, qty_terdampak: num(r.qty_terdampak), satuan: (r.satuan as string) ?? null,
    status, pic_id: num(r.pic_id), pic_nama: (r.pic_nama as string) ?? null, pic_divisi: (r.pic_divisi as string) ?? null, divisi_terkait: (r.divisi_terkait as string) ?? null,
    target_selesai: target, terlambat: open && !!target && target < today,
    akar_masalah: (r.akar_masalah as string) ?? null, tindakan_perbaikan: (r.tindakan_perbaikan as string) ?? null, tindakan_pencegahan: (r.tindakan_pencegahan as string) ?? null,
    solusi: (r.solusi as string) ?? null, solusi_detail: (r.solusi_detail as string) ?? null, nilai_kompensasi: num(r.nilai_kompensasi),
    kepuasan: num(r.kepuasan), catatan_penutupan: (r.catatan_penutupan as string) ?? null, selesai_at: r.selesai_at ? String(r.selesai_at) : null,
    dilaporkan_oleh: num(r.dilaporkan_oleh), pelapor_nama: (r.pelapor_nama as string) ?? null, created_at: String(r.created_at), updated_at: String(r.updated_at),
    lampiran: Number(r.lampiran) || 0, update_terakhir: r.update_terakhir ? String(r.update_terakhir) : null,
    umur_hari: Math.max(0, Math.round((Date.parse(open ? today : String(r.selesai_at ?? r.updated_at).slice(0, 10)) - Date.parse(String(r.tanggal))) / 864e5)),
  }
}
export type Complaint = ReturnType<typeof serializeComplaint>

export async function loadComplaint(id: number) {
  const [[r]] = await db.query<Row[]>(`${SELECT} WHERE c.id = ?`, [id])
  if (!r) fail(404, 'Kendala customer tidak ditemukan.')
  return serializeComplaint(r!)
}

// Daftar + ringkasan periode: ?from&to&status&kategori&prioritas&pic&q
export async function listComplaints(params: URLSearchParams) {
  const date = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
  const from = date(params.get('from'))
  const to = date(params.get('to'))
  const where: string[] = []
  const args: unknown[] = []
  if (from) where.push('c.tanggal >= ?'), args.push(from)
  if (to) where.push('c.tanggal <= ?'), args.push(to)
  const kategori = params.get('kategori')
  if (kategori && kategori in CC_KATEGORI) where.push('c.kategori = ?'), args.push(kategori)
  const prioritas = params.get('prioritas')
  if (prioritas && prioritas in CC_PRIORITAS) where.push('c.prioritas = ?'), args.push(prioritas)
  const pic = Number(params.get('pic'))
  if (Number.isInteger(pic) && pic > 0) where.push('c.pic_id = ?'), args.push(pic)
  const q = str(params.get('q'), 100)
  if (q) where.push('(c.nomor LIKE ? OR c.judul LIKE ? OR c.customer_nama LIKE ? OR c.produk LIKE ? OR c.referensi LIKE ? OR c.deskripsi LIKE ?)'), args.push(...Array(6).fill(`%${q}%`))
  const base = where.length ? `WHERE ${where.join(' AND ')}` : ''
  // Filter status dipisah supaya ringkasan per status tetap menghitung semua status dalam periode
  const status = params.get('status') ?? ''
  const today = todayWib()
  const statusSql = status === 'terbuka' ? "c.status NOT IN ('selesai','ditolak')"
    : status === 'terlambat' ? `c.status NOT IN ('selesai','ditolak') AND c.target_selesai < '${today}'`
    : status in CC_STATUS ? `c.status = ${db.escape(status)}` : ''
  const listWhere = [base.replace(/^WHERE /, ''), statusSql].filter(Boolean).join(' AND ')
  const [[rows], [[stats]], [perStatus], [perKategori], [perBulan], [topCustomer]] = await Promise.all([
    db.query<Row[]>(`${SELECT} ${listWhere ? `WHERE ${listWhere}` : ''} ORDER BY FIELD(c.status, 'baru','investigasi','perbaikan','konfirmasi','selesai','ditolak'), FIELD(c.prioritas, 'kritis','tinggi','normal','rendah'), c.tanggal DESC, c.id DESC LIMIT 1000`, args),
    db.query<Row[]>(
      `SELECT COUNT(*) AS total, SUM(c.status NOT IN ('selesai','ditolak')) AS terbuka, SUM(c.status = 'selesai') AS selesai,
         SUM(c.status NOT IN ('selesai','ditolak') AND c.target_selesai < ?) AS terlambat,
         SUM(c.prioritas IN ('kritis','tinggi') AND c.status NOT IN ('selesai','ditolak')) AS prioritas_tinggi,
         AVG(IF(c.status = 'selesai' AND c.selesai_at IS NOT NULL, DATEDIFF(c.selesai_at, c.tanggal), NULL)) AS rata_hari,
         SUM(c.status = 'selesai' AND (c.target_selesai IS NULL OR DATE(c.selesai_at) <= c.target_selesai)) AS tepat_waktu,
         AVG(c.kepuasan) AS kepuasan, SUM(COALESCE(c.nilai_kompensasi, 0)) AS kompensasi
       FROM customer_complaints c ${base}`,
      [today, ...args],
    ),
    db.query<Row[]>(`SELECT c.status, COUNT(*) AS n FROM customer_complaints c ${base} GROUP BY c.status`, args),
    db.query<Row[]>(`SELECT c.kategori, COUNT(*) AS n FROM customer_complaints c ${base} GROUP BY c.kategori ORDER BY n DESC`, args),
    db.query<Row[]>(
      `SELECT DATE_FORMAT(c.tanggal, '%Y-%m') AS bulan, COUNT(*) AS n, SUM(c.status = 'selesai') AS selesai FROM customer_complaints c ${base}
       GROUP BY bulan ORDER BY bulan DESC LIMIT 12`,
      args,
    ),
    db.query<Row[]>(`SELECT c.customer_nama, COUNT(*) AS n, SUM(c.status NOT IN ('selesai','ditolak')) AS terbuka FROM customer_complaints c ${base} GROUP BY c.customer_nama ORDER BY n DESC LIMIT 6`, args),
  ])
  const selesai = Number(stats.selesai) || 0
  return {
    items: rows.map(serializeComplaint),
    stats: {
      total: Number(stats.total) || 0, terbuka: Number(stats.terbuka) || 0, selesai, terlambat: Number(stats.terlambat) || 0, prioritas_tinggi: Number(stats.prioritas_tinggi) || 0,
      rata_hari: stats.rata_hari === null ? null : Number(stats.rata_hari), tepat_waktu: selesai ? ((Number(stats.tepat_waktu) || 0) / selesai) * 100 : null,
      kepuasan: stats.kepuasan === null ? null : Number(stats.kepuasan), kompensasi: Number(stats.kompensasi) || 0,
    },
    per_status: Object.fromEntries(perStatus.map((r) => [String(r.status), Number(r.n)])),
    per_kategori: perKategori.map((r) => ({ kategori: String(r.kategori), n: Number(r.n) })),
    per_bulan: perBulan.reverse().map((r) => ({ bulan: String(r.bulan), n: Number(r.n), selesai: Number(r.selesai) || 0 })),
    top_customer: topCustomer.map((r) => ({ nama: String(r.customer_nama), n: Number(r.n), terbuka: Number(r.terbuka) || 0 })),
  }
}

export async function complaintUpdates(id: number) {
  const [rows] = await db.query<Row[]>(
    `SELECT u.id, u.jenis, u.status_dari, u.status_ke, u.pesan, u.created_at, u.user_id, us.name AS user_nama
     FROM customer_complaint_updates u LEFT JOIN users us ON us.id = u.user_id WHERE u.complaint_id = ? ORDER BY u.created_at, u.id`,
    [id],
  )
  return rows.map((r) => ({
    id: Number(r.id), jenis: String(r.jenis), status_dari: (r.status_dari as string) ?? null, status_ke: (r.status_ke as string) ?? null,
    pesan: String(r.pesan), created_at: String(r.created_at), user_id: num(r.user_id), user_nama: (r.user_nama as string) ?? null,
  }))
}

export async function addUpdate(complaintId: number, userId: number, jenis: 'komentar' | 'status' | 'tindakan' | 'sistem', pesan: string, from: string | null = null, to: string | null = null) {
  await db.query('INSERT INTO customer_complaint_updates (complaint_id, user_id, jenis, status_dari, status_ke, pesan) VALUES (?, ?, ?, ?, ?, ?)', [complaintId, userId, jenis, from, to, pesan.slice(0, 10000)])
}

export async function nextComplaintNumber() {
  const year = new Date(Date.now() + 7 * 3600e3).getUTCFullYear()
  const prefix = `KC-${year}-`
  const [[r]] = await db.query<Row[]>('SELECT MAX(CAST(SUBSTRING(nomor, ?) AS UNSIGNED)) AS n FROM customer_complaints WHERE nomor LIKE ?', [prefix.length + 1, `${prefix}%`])
  return `${prefix}${String((Number(r?.n) || 0) + 1).padStart(4, '0')}`
}

const addDays = (ymd: string, n: number) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

// Isian data keluhan (dari form tambah / ubah)
export async function readComplaintInput(body: Record<string, unknown>) {
  const judul = str(body.judul, 200) || fail(400, 'Isi ringkasan keluhan.')
  const deskripsi = str(body.deskripsi, 10000) || fail(400, 'Jelaskan keluhan customer.')
  const date = (v: unknown, label: string) => {
    const t = str(v, 10)
    if (!t) return null
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || Number.isNaN(Date.parse(t))) fail(400, `${label} tidak valid.`)
    return t
  }
  const tanggal = date(body.tanggal, 'Tanggal keluhan') ?? todayWib()
  const prioritas = (String(body.prioritas) in CC_PRIORITAS ? String(body.prioritas) : 'normal') as keyof typeof CC_PRIORITAS
  let customerId = num(body.customer_id)
  let customerNama = str(body.customer_nama, 255)
  if (customerId) {
    const [[c]] = await db.query<Row[]>('SELECT id, name FROM customers WHERE id = ?', [customerId])
    if (!c) customerId = null
    else customerNama = String(c.name)
  }
  if (!customerNama) fail(400, 'Pilih atau isi nama customer.')
  const picId = num(body.pic_id)
  if (picId) {
    const [[u]] = await db.query<Row[]>('SELECT id FROM users WHERE id = ? AND is_active = 1', [picId])
    if (!u) fail(400, 'PIC tidak ditemukan.')
  }
  const qty = num(body.qty_terdampak)
  if (qty !== null && (!Number.isFinite(qty) || qty < 0 || qty > 1e12)) fail(400, 'Jumlah terdampak tidak valid.')
  return {
    tanggal, customer_id: customerId, customer_nama: customerNama!, kontak: str(body.kontak, 150) || null,
    channel: String(body.channel) in CC_CHANNEL ? String(body.channel) : 'whatsapp',
    judul: judul!, kategori: String(body.kategori) in CC_KATEGORI ? String(body.kategori) : 'kualitas', prioritas, deskripsi: deskripsi!,
    produk: str(body.produk, 255) || null, item_accurate_id: num(body.item_accurate_id), referensi: str(body.referensi, 150) || null,
    qty_terdampak: qty, satuan: str(body.satuan, 40) || null, pic_id: picId, divisi_terkait: str(body.divisi_terkait, 80) || null,
    target_selesai: date(body.target_selesai, 'Target selesai') ?? addDays(tanggal, CC_SLA_DAYS[prioritas]),
  }
}

// Isian penanganan (akar masalah, tindakan, solusi, kompensasi)
export function readHandlingInput(body: Record<string, unknown>) {
  const komp = num(body.nilai_kompensasi)
  if (komp !== null && (!Number.isFinite(komp) || komp < 0 || komp > 1e13)) fail(400, 'Nilai kompensasi tidak valid.')
  return {
    akar_masalah: str(body.akar_masalah, 10000) || null, tindakan_perbaikan: str(body.tindakan_perbaikan, 10000) || null, tindakan_pencegahan: str(body.tindakan_pencegahan, 10000) || null,
    solusi: String(body.solusi) in CC_SOLUSI ? String(body.solusi) : null, solusi_detail: str(body.solusi_detail, 500) || null, nilai_kompensasi: komp,
  }
}

// Notifikasi ke PIC / pelapor (dibuka ke menu Kendala Customer pada keluhan itu)
export async function notifyComplaint(userIds: (number | null)[], c: { id: number; nomor: string; judul: string; customer_nama: string }, title: string, body: string | null, key: string) {
  const users = [...new Set(userIds.filter((x): x is number => !!x))]
  if (!users.length) return
  await pushToUsers(await notify(users, {
    type: 'kendala_customer', title, body: `${c.nomor} · ${c.customer_nama} · ${c.judul}${body ? ` — ${body}` : ''}`, page: 'Kendala Customer', pageId: c.id, refKey: `kc:${c.id}:${key}`,
  }))
}

// Pilihan form: customer (cari), PIC (user aktif), divisi
export async function complaintOptions(q: string) {
  const like = `%${q}%`
  const [[customers], [users], [divisions]] = await Promise.all([
    db.query<Row[]>(`SELECT id, name, customer_no, COALESCE(mobile_phone, work_phone) AS phone FROM customers ${q ? 'WHERE name LIKE ? OR customer_no LIKE ?' : ''} ORDER BY name LIMIT 20`, q ? [like, like] : []),
    db.query<Row[]>("SELECT u.id, u.name, d.name AS divisi FROM users u LEFT JOIN divisions d ON d.id = u.division_id WHERE u.is_active = 1 ORDER BY u.name"),
    db.query<Row[]>('SELECT name FROM divisions ORDER BY name'),
  ])
  return {
    customers: customers.map((c) => ({ id: Number(c.id), name: String(c.name), customer_no: (c.customer_no as string) ?? null, phone: (c.phone as string) ?? null })),
    users: users.map((u) => ({ id: Number(u.id), name: String(u.name), divisi: (u.divisi as string) ?? null })),
    divisions: divisions.map((d) => String(d.name)),
  }
}
