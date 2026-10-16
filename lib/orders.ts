import type { RowDataPacket } from 'mysql2'
import { fail, int, str } from '@/lib/api'
import { db } from '@/lib/db'
import { toNumber } from '@/lib/hpp'
import type { UserProfile } from '@/lib/users'

// ---------- Ekspedisi ----------
export const canViewExpeditions = (user: UserProfile) => ['master-data', 'quotation'].some((m) => (user.menus as string[]).includes(m))
export const canEditExpeditions = (user: UserProfile) => user.role.isAdmin || user.division.code === 'general_manager' || user.division.code.startsWith('marketing')

export function readExpeditionInput(body: Record<string, unknown>) {
  const nama = str(body.nama, 150) || fail(400, 'Nama ekspedisi wajib diisi.')
  const tujuan = str(body.tujuan, 255) || fail(400, 'Isi kota / area tujuan.')
  const tarif = toNumber(String(body.tarif_per_kg ?? '').replace(/\./g, ''))
  const minimal = toNumber(body.minimal_kg)
  if ((tarif !== null && tarif < 0) || (minimal !== null && minimal < 0)) fail(400, 'Tarif / minimal tidak valid.')
  return {
    nama, tujuan, tarif_per_kg: tarif, minimal_kg: minimal,
    kontak: str(body.kontak, 150) || null, telepon: str(body.telepon, 40) || null,
    estimasi_hari: str(body.estimasi_hari, 30) || null, keterangan: str(body.keterangan, 500) || null,
    aktif: body.aktif === false || body.aktif === 0 || body.aktif === '0' ? 0 : 1,
  }
}

// ---------- Pembayaran ----------
export const PAYMENT_JENIS = { dp: 'DP', pelunasan: 'Pelunasan', lainnya: 'Lainnya' } as const
export const PAYMENT_STATUS = { menunggu: 'Menunggu verifikasi', diterima: 'Diterima', ditolak: 'Ditolak' } as const
export const PAYMENT_FILE_MAX = 4 * 1024 * 1024

export function requirePayments(user: UserProfile) {
  if (!(user.menus as string[]).includes('pembayaran')) fail(403, 'Anda tidak punya akses ke menu Pembayaran.')
}
export const canVerifyPayment = (user: UserProfile) => user.role.isAdmin || ['accounting', 'general_manager'].includes(user.division.code)
// Staff marketing melihat konfirmasi yang dibuatnya; Accounting/GM/Lead/admin semua
export const seesAllPayments = (user: UserProfile) => canVerifyPayment(user) || (user.division.code.startsWith('marketing') && user.role.code === 'lead')

export const PAYMENT_SELECT = `SELECT p.id, p.quotation_id, p.customer_id, p.pembayar, p.jenis, p.nominal, p.tanggal_bayar, p.metode, p.bukti_mime, p.bukti_name,
  (p.bukti IS NOT NULL) AS has_bukti, p.catatan, p.status, p.alasan, p.verified_at, p.created_by, p.created_at,
  uc.name AS created_name, uv.name AS verified_name, q.nomor AS quotation_nomor, q.order_nomor, q.total AS quotation_total, c.customer_no
  FROM payment_confirmations p JOIN users uc ON uc.id = p.created_by LEFT JOIN users uv ON uv.id = p.verified_by
  LEFT JOIN quotations q ON q.id = p.quotation_id LEFT JOIN customers c ON c.id = p.customer_id`

export const serializePayment = (r: RowDataPacket) => ({
  ...r, nominal: Number(r.nominal), quotation_total: r.quotation_total === null ? null : Number(r.quotation_total), has_bukti: !!Number(r.has_bukti),
})

export async function loadPayment(id: number, user: UserProfile) {
  const [rows] = await db.query<RowDataPacket[]>(
    `${PAYMENT_SELECT} WHERE p.id = ? ${seesAllPayments(user) ? '' : 'AND p.created_by = ?'}`,
    seesAllPayments(user) ? [id] : [id, user.id],
  )
  return serializePayment(rows[0] ?? fail(404, 'Konfirmasi pembayaran tidak ditemukan.')) as RowDataPacket
}

export function readPaymentForm(form: FormData) {
  const get = (k: string) => form.get(k)
  const nominal = toNumber(String(get('nominal') ?? '').replace(/\./g, ''))
  if (!nominal || nominal <= 0) fail(400, 'Isi nominal pembayaran.')
  const tanggal = str(get('tanggal_bayar'), 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) fail(400, 'Isi tanggal pembayaran.')
  const jenis = String(get('jenis'))
  return {
    // FormData.get() = null untuk field kosong; int(null) = 0, jadi 0 dianggap tidak diisi
    quotation_id: int(get('quotation_id')) || null,
    customer_id: int(get('customer_id')) || null,
    pembayar: str(get('pembayar'), 200),
    jenis: jenis in PAYMENT_JENIS ? jenis : 'dp',
    nominal: nominal!,
    tanggal_bayar: tanggal,
    metode: str(get('metode'), 100) || null,
    catatan: str(get('catatan'), 1000) || null,
  }
}
