// Tanda tangan digital penawaran: simpan, cabut, cek keabsahan (isi dokumen tidak berubah sejak ditandatangani).
import { createHash, randomBytes } from 'node:crypto'
import type { RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canWriteQuotation, loadQuotation, loadQuotationItems, QUOTATION_SELECT, serializeQuotation } from '@/lib/quotations'
import type { UserProfile } from '@/lib/users'

export type SignatureRole = 'perusahaan' | 'customer'
export const ROLE_LABEL: Record<SignatureRole, string> = { perusahaan: 'Hormat kami (perusahaan)', customer: 'Disetujui customer' }
const MAX_IMAGE = 400_000 // ~300 KB PNG

type Row = RowDataPacket & Record<string, unknown>

// Sidik isi penawaran: nomor, tanggal, customer, produk, harga, total, syarat (bukan status / catatan internal)
export async function quotationHash(quotationId: number, user: UserProfile) {
  const q = await loadQuotation(quotationId, user)
  const items = await loadQuotationItems(quotationId)
  return hashOf(q, items)
}
function hashOf(q: Awaited<ReturnType<typeof loadQuotation>>, items: Awaited<ReturnType<typeof loadQuotationItems>>) {
  const content = {
    nomor: q.nomor, tanggal: String(q.tanggal).slice(0, 10), berlaku: String(q.berlaku_sampai).slice(0, 10), kepada: q.kepada, kontak: q.kontak ?? '', alamat: q.alamat ?? '',
    ppn: q.pakai_ppn ? Number(q.ppn_persen) : 0, ...(q.pakai_ongkir ? { ongkir_per_kg: Number(q.ongkir_per_kg), ...(q.ongkir_berat_kg ? { ongkir_berat_kg: Number(q.ongkir_berat_kg) } : {}) } : {}), ...(q.pakai_diskon ? { diskon: Number(q.diskon), diskon_tipe: q.diskon_tipe, diskon_nilai: Number(q.diskon_nilai) } : {}), subtotal: Number(q.subtotal), total: Number(q.total), syarat: q.syarat ?? '',
    items: items.map((i) => [i.nama_produk, i.spesifikasi ?? '', Number(i.qty), i.satuan, Number(i.harga_satuan)]),
  }
  return createHash('sha256').update(JSON.stringify(content)).digest('hex')
}

const serialize = (r: Row, currentHash: string | null) => {
  const revoked = !!r.revoked_at
  const changed = !revoked && currentHash !== null && r.doc_hash !== currentHash
  return {
    id: Number(r.id), peran: String(r.peran) as SignatureRole, nama: String(r.nama), jabatan: (r.jabatan as string) ?? null, token: String(r.token),
    signed_at: String(r.signed_at), signed_by_name: (r.signed_by_name as string) ?? null,
    revoked_at: r.revoked_at ? String(r.revoked_at) : null, revoked_by_name: (r.revoked_by_name as string) ?? null, revoke_reason: (r.revoke_reason as string) ?? null,
    status: revoked ? 'dicabut' : changed ? 'berubah' : 'sah' as 'sah' | 'berubah' | 'dicabut',
  }
}
export type QuotationSignature = ReturnType<typeof serialize>

const SELECT = `SELECT s.id, s.quotation_id, s.peran, s.nama, s.jabatan, s.token, s.doc_hash, s.signed_at, s.revoked_at, s.revoke_reason,
    us.name AS signed_by_name, ur.name AS revoked_by_name
  FROM quotation_signatures s LEFT JOIN users us ON us.id = s.signed_by LEFT JOIN users ur ON ur.id = s.revoked_by`

// Semua tanda tangan (terbaru dulu) + status keabsahan terhadap isi penawaran sekarang
export async function listSignatures(quotationId: number, currentHash: string) {
  const [rows] = await db.query<Row[]>(`${SELECT} WHERE s.quotation_id = ? ORDER BY s.signed_at DESC, s.id DESC`, [quotationId])
  return rows.map((r) => serialize(r, currentHash))
}

// Tanda tangan sah untuk dicetak di dokumen (satu per peran)
export async function validSignatures(quotationId: number, q: Awaited<ReturnType<typeof loadQuotation>>, items: Awaited<ReturnType<typeof loadQuotationItems>>) {
  const hash = hashOf(q, items)
  const [rows] = await db.query<Row[]>(`${SELECT} WHERE s.quotation_id = ? AND s.revoked_at IS NULL AND s.doc_hash = ? ORDER BY s.signed_at DESC, s.id DESC`, [quotationId, hash])
  const out: Partial<Record<SignatureRole, QuotationSignature>> = {}
  for (const r of rows) {
    const s = serialize(r, hash)
    if (!out[s.peran]) out[s.peran] = s
  }
  return out
}

export const canSignQuotation = (user: UserProfile) => canWriteQuotation(user)

// Validasi gambar tanda tangan: PNG / JPEG (data URL), ukuran wajar
export function readSignatureImage(value: unknown) {
  const v = typeof value === 'string' ? value : ''
  const m = v.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/)
  if (!m) fail(400, 'Gambar tanda tangan tidak valid. Gambar ulang tanda tangan.')
  if (v.length > MAX_IMAGE) fail(400, 'Gambar tanda tangan terlalu besar.')
  const bytes = Buffer.from(m![2], 'base64')
  const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const jpg = bytes[0] === 0xff && bytes[1] === 0xd8
  if (!png && !jpg) fail(400, 'Gambar tanda tangan tidak valid.')
  if (bytes.length < 200) fail(400, 'Tanda tangan masih kosong. Gambar tanda tangan dulu.')
  return v
}

export async function addSignature(quotationId: number, user: UserProfile, body: Record<string, unknown>, meta: { ip: string | null; ua: string | null }) {
  const peran: SignatureRole = body.peran === 'customer' ? 'customer' : 'perusahaan'
  const q = await loadQuotation(quotationId, user)
  if (q.status === 'batal') fail(400, 'Penawaran yang dibatalkan tidak bisa ditandatangani.')
  const nama = str(body.nama, 150) || (peran === 'perusahaan' ? user.name : '')
  if (!nama) fail(400, peran === 'customer' ? 'Isi nama penandatangan dari customer.' : 'Isi nama penandatangan.')
  if (body.setuju !== true) fail(400, 'Centang pernyataan persetujuan tanda tangan.')
  const image = readSignatureImage(body.image)
  const jabatan = str(body.jabatan, 150) || null
  const hash = hashOf(q, await loadQuotationItems(quotationId))
  const token = randomBytes(16).toString('hex')
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    // Satu tanda tangan aktif per peran: yang lama otomatis digantikan
    await conn.query("UPDATE quotation_signatures SET revoked_at = NOW(), revoked_by = ?, revoke_reason = 'Diganti tanda tangan baru' WHERE quotation_id = ? AND peran = ? AND revoked_at IS NULL", [user.id, quotationId, peran])
    await conn.query(
      'INSERT INTO quotation_signatures (quotation_id, peran, nama, jabatan, image, token, doc_hash, signed_by, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [quotationId, peran, nama, jabatan, image, token, hash, user.id, meta.ip?.slice(0, 64) ?? null, meta.ua?.slice(0, 255) ?? null],
    )
    if (peran === 'perusahaan' && body.simpan === true) {
      await conn.query('INSERT INTO user_signatures (user_id, image, jabatan) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE image = VALUES(image), jabatan = VALUES(jabatan)', [user.id, image, jabatan])
    }
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
  return { q, peran, nama, token }
}

export async function revokeSignature(quotationId: number, signatureId: number, user: UserProfile, reason: string) {
  const [[s]] = await db.query<Row[]>('SELECT id, peran, nama, signed_by, revoked_at FROM quotation_signatures WHERE id = ? AND quotation_id = ?', [signatureId, quotationId])
  if (!s) fail(404, 'Tanda tangan tidak ditemukan.')
  if (s!.revoked_at) fail(400, 'Tanda tangan sudah dicabut.')
  await db.query('UPDATE quotation_signatures SET revoked_at = NOW(), revoked_by = ?, revoke_reason = ? WHERE id = ?', [user.id, reason.slice(0, 255) || 'Dicabut', signatureId])
  return { peran: String(s!.peran) as SignatureRole, nama: String(s!.nama) }
}

export async function mySignature(userId: number) {
  const [[r]] = await db.query<Row[]>('SELECT image, jabatan, updated_at FROM user_signatures WHERE user_id = ?', [userId])
  return r ? { image: String(r.image), jabatan: (r.jabatan as string) ?? null, updated_at: String(r.updated_at) } : null
}

// Gambar tanda tangan (publik lewat token acak 32 karakter; dipakai dokumen Word & halaman cetak)
export async function signatureImage(token: string) {
  if (!/^[a-f0-9]{32}$/.test(token)) return null
  const [[r]] = await db.query<Row[]>('SELECT image FROM quotation_signatures WHERE token = ?', [token])
  if (!r) return null
  const m = String(r.image).match(/^data:(image\/(?:png|jpeg));base64,(.+)$/)
  return m ? { type: m[1], data: Buffer.from(m[2], 'base64') } : null
}

// Halaman verifikasi publik: data minimum (tanpa harga) + status sah / berubah / dicabut
export async function verifySignature(token: string) {
  if (!/^[a-f0-9]{32}$/.test(token)) return null
  const [[r]] = await db.query<Row[]>(
    `SELECT s.*, q.nomor, q.kepada, DATE_FORMAT(q.tanggal, '%Y-%m-%d') AS q_tanggal, q.status AS q_status FROM quotation_signatures s JOIN quotations q ON q.id = s.quotation_id WHERE s.token = ?`,
    [token],
  )
  if (!r) return null
  // Hitung ulang sidik isi penawaran saat ini (query sama dengan loadQuotation, tanpa cek akses user)
  const [[q]] = await db.query<Row[]>(`${QUOTATION_SELECT} WHERE q.id = ? LIMIT 1`, [r.quotation_id])
  const current = q ? hashOf(serializeQuotation(q), await loadQuotationItems(Number(r.quotation_id))) : null
  return {
    nomor: String(r.nomor), kepada: String(r.kepada), tanggal: String(r.q_tanggal), peran: String(r.peran) as SignatureRole, nama: String(r.nama), jabatan: (r.jabatan as string) ?? null,
    signed_at: String(r.signed_at), status: r.revoked_at ? 'dicabut' : current !== r.doc_hash ? 'berubah' : 'sah', revoke_reason: (r.revoke_reason as string) ?? null,
  }
}
