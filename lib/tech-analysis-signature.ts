// Tanda tangan digital Analisa Teknik / Rekomendasi Proses Produksi: Pengaju (PPIC / Marketing), Dept Tehnik, Direksi.
// Gambar memakai validasi & tanda tangan tersimpan yang sama dengan penawaran (lib/quotation-signature.ts).
import { randomBytes } from 'node:crypto'
import type { RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'
import { readSignatureImage } from '@/lib/quotation-signature'
import type { UserProfile } from '@/lib/users'

export const TA_SIGN_ROLES = ['pengaju', 'teknik', 'direksi'] as const
export type TaSignRole = (typeof TA_SIGN_ROLES)[number]
export const isTaSignRole = (v: unknown): v is TaSignRole => TA_SIGN_ROLES.includes(v as TaSignRole)

type Row = RowDataPacket & Record<string, unknown>
const serialize = (r: Row) => ({
  id: Number(r.id), peran: String(r.peran) as TaSignRole, nama: String(r.nama), jabatan: (r.jabatan as string) ?? null, token: String(r.token),
  signed_at: String(r.signed_at), signed_by_name: (r.signed_by_name as string) ?? null,
  revoked_at: r.revoked_at ? String(r.revoked_at) : null, revoked_by_name: (r.revoked_by_name as string) ?? null, revoke_reason: (r.revoke_reason as string) ?? null,
})
export type TaSignature = ReturnType<typeof serialize>
// Tanda tangan aktif per peran (dicetak di dokumen)
export type TaTtd = Partial<Record<TaSignRole, Pick<TaSignature, 'nama' | 'jabatan' | 'token' | 'signed_at'>>>

const SELECT = `SELECT s.id, s.analysis_id, s.peran, s.nama, s.jabatan, s.token, s.signed_at, s.revoked_at, s.revoke_reason,
    us.name AS signed_by_name, ur.name AS revoked_by_name
  FROM tech_analysis_signatures s LEFT JOIN users us ON us.id = s.signed_by LEFT JOIN users ur ON ur.id = s.revoked_by`

export async function listTaSignatures(analysisId: number) {
  const [rows] = await db.query<Row[]>(`${SELECT} WHERE s.analysis_id = ? ORDER BY s.signed_at DESC, s.id DESC`, [analysisId])
  return rows.map(serialize)
}

// Tanda tangan aktif beberapa analisa sekaligus: { analysisId: { peran: ttd } }
export async function activeTaSignatures(ids: number[]) {
  const out = new Map<number, TaTtd>()
  if (!ids.length) return out
  const [rows] = await db.query<Row[]>(`${SELECT} WHERE s.analysis_id IN (?) AND s.revoked_at IS NULL ORDER BY s.signed_at DESC, s.id DESC`, [ids])
  for (const r of rows) {
    const map = out.get(Number(r.analysis_id)) ?? {}
    const s = serialize(r)
    if (!map[s.peran]) map[s.peran] = { nama: s.nama, jabatan: s.jabatan, token: s.token, signed_at: s.signed_at }
    out.set(Number(r.analysis_id), map)
  }
  return out
}

export async function addTaSignature(analysisId: number, peran: TaSignRole, user: UserProfile, body: Record<string, unknown>, meta: { ip: string | null; ua: string | null }) {
  const nama = str(body.nama, 150) || user.name
  if (body.setuju !== true) fail(400, 'Centang pernyataan persetujuan tanda tangan.')
  const image = readSignatureImage(body.image)
  const jabatan = str(body.jabatan, 150) || null
  const token = randomBytes(16).toString('hex')
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    // Satu tanda tangan aktif per peran: yang lama otomatis digantikan
    await conn.query("UPDATE tech_analysis_signatures SET revoked_at = NOW(), revoked_by = ?, revoke_reason = 'Diganti tanda tangan baru' WHERE analysis_id = ? AND peran = ? AND revoked_at IS NULL", [user.id, analysisId, peran])
    await conn.query(
      'INSERT INTO tech_analysis_signatures (analysis_id, peran, nama, jabatan, image, token, signed_by, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [analysisId, peran, nama, jabatan, image, token, user.id, meta.ip?.slice(0, 64) ?? null, meta.ua?.slice(0, 255) ?? null],
    )
    if (body.simpan === true) {
      await conn.query('INSERT INTO user_signatures (user_id, image, jabatan) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE image = VALUES(image), jabatan = VALUES(jabatan)', [user.id, image, jabatan])
    }
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
  return { nama, token }
}

export async function revokeTaSignature(analysisId: number, signatureId: number, user: UserProfile, reason: string) {
  const [[s]] = await db.query<Row[]>('SELECT id, peran, nama, revoked_at FROM tech_analysis_signatures WHERE id = ? AND analysis_id = ?', [signatureId, analysisId])
  if (!s) fail(404, 'Tanda tangan tidak ditemukan.')
  if (s!.revoked_at) fail(400, 'Tanda tangan sudah dicabut.')
  await db.query('UPDATE tech_analysis_signatures SET revoked_at = NOW(), revoked_by = ?, revoke_reason = ? WHERE id = ?', [user.id, reason.slice(0, 255) || 'Dicabut', signatureId])
  return { peran: String(s!.peran) as TaSignRole, nama: String(s!.nama) }
}

// Gambar tanda tangan lewat token acak (dipakai /api/ttd/<token> untuk halaman cetak & Word)
export async function taSignatureImage(token: string) {
  if (!/^[a-f0-9]{32}$/.test(token)) return null
  const [[r]] = await db.query<Row[]>('SELECT image FROM tech_analysis_signatures WHERE token = ?', [token])
  if (!r) return null
  const m = String(r.image).match(/^data:(image\/(?:png|jpeg));base64,(.+)$/)
  return m ? { type: m[1], data: Buffer.from(m[2], 'base64') } : null
}
