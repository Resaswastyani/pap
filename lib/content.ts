import type { RowDataPacket } from 'mysql2'
import { fail, int, str } from '@/lib/api'
import { db } from '@/lib/db'
import { parseDateTime } from '@/lib/marketing'
import type { UserProfile } from '@/lib/users'

// Kalender konten Marketing Digital (rencana posting, iklan, blasting) + hasilnya
export const PLATFORMS = { instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', website: 'Website / blog', whatsapp: 'WhatsApp blast', marketplace: 'Marketplace', google: 'Google (Maps / Ads)', lainnya: 'Lainnya' } as const
export const CONTENT_TYPES = { feed: 'Feed / post', reels: 'Reels / video pendek', story: 'Story', video: 'Video', artikel: 'Artikel', iklan: 'Iklan berbayar', blasting: 'Blasting pesan', lainnya: 'Lainnya' } as const
export const CONTENT_STATUS = { ide: 'Ide', produksi: 'Produksi desain', siap: 'Siap tayang', tayang: 'Sudah tayang', batal: 'Batal' } as const
export type ContentStatus = keyof typeof CONTENT_STATUS

export function requireContent(user: UserProfile) {
  if (!user.menus.includes('konten')) fail(403, 'Anda tidak punya akses ke Kalender Konten.')
}
// Dikelola Marketing Digital, Lead marketing, GM, admin; Tim Desain & marketing lain melihat
export const canEditContent = (user: UserProfile) =>
  user.role.isAdmin || ['marketing_digital', 'general_manager'].includes(user.division.code) || (user.division.code === 'marketing' && user.role.code === 'lead')

export const CONTENT_SELECT = `SELECT c.*, up.name AS pic_name, uc.name AS created_name,
  d.nomor AS design_nomor, d.status AS design_status, d.final_file_id
  FROM content_plans c LEFT JOIN users up ON up.id = c.pic_id JOIN users uc ON uc.id = c.created_by
  LEFT JOIN design_requests d ON d.id = c.design_request_id`

export const serializeContent = (r: RowDataPacket) => ({
  ...r,
  anggaran: r.anggaran === null ? null : Number(r.anggaran),
})

export async function loadContent(id: number) {
  const [rows] = await db.query<RowDataPacket[]>(`${CONTENT_SELECT} WHERE c.id = ?`, [id])
  return serializeContent(rows[0] ?? fail(404, 'Rencana konten tidak ditemukan.')) as RowDataPacket
}

const optInt = (v: unknown) => {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(String(v).replace(/\./g, ''))
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fail(400, 'Angka hasil konten tidak valid.')
}

export function readContentInput(body: Record<string, unknown>) {
  const judul = str(body.judul, 255) || fail(400, 'Judul konten wajib diisi.')
  const platform = str(body.platform, 40)
  if (!(platform in PLATFORMS)) fail(400, 'Pilih platform.')
  const jenis = str(body.jenis, 40)
  if (!(jenis in CONTENT_TYPES)) fail(400, 'Pilih jenis konten.')
  const status = (str(body.status, 20) || 'ide') as ContentStatus
  if (!(status in CONTENT_STATUS)) fail(400, 'Status tidak valid.')
  const anggaran = body.anggaran === '' || body.anggaran === undefined || body.anggaran === null ? null : Number(String(body.anggaran).replace(/\./g, '').replace(',', '.'))
  if (anggaran !== null && (!Number.isFinite(anggaran) || anggaran < 0)) fail(400, 'Anggaran tidak valid.')
  return {
    judul, platform, jenis, status,
    jadwal_tayang: parseDateTime(body.jadwal_tayang, 'Jadwal tayang', true)!,
    tujuan: str(body.tujuan, 255) || null,
    target_sektor: str(body.target_sektor, 255) || null,
    caption: str(body.caption, 10000) || null,
    anggaran,
    link_hasil: str(body.link_hasil, 1000) || null,
    reach: optInt(body.reach), engagement: optInt(body.engagement), leads: optInt(body.leads),
    catatan: str(body.catatan, 5000) || null,
    pic_id: int(body.pic_id),
  }
}
