// SOP Mesin: video SOP dari folder Google Drive Teknik (menggantikan menu Standar Setting).
// Daftar video dibaca lewat akun Google yang terhubung di Master Data; bila belum terhubung / gagal,
// dibaca dari tampilan publik folder (folder dibagikan "siapa saja yang memiliki link").
// Hasilnya disimpan di sop_videos agar halaman cepat; kelompok mesin ditebak dari nama file & subfolder.
import type { RowDataPacket } from 'mysql2'
import { fail } from '@/lib/api'
import { db } from '@/lib/db'
import { driveEnabled, listDriveFolder } from '@/lib/drive'

const FOLDER_KEY = 'teknis.sop_folder_url'
const SYNC_KEY = 'teknis.sop_synced'
export const DEFAULT_SOP_FOLDER_URL = 'https://drive.google.com/drive/folders/1aEtrSAH33Z8u-VEzCZFOy6S4y1zEaO1D?usp=sharing'
export const SOP_STALE_HOURS = 6
const MAX_DEPTH = 3
const VIDEO_EXT = /\.(mp4|mov|m4v|mkv|avi|webm|3gp|wmv|mpe?g)$/i

export function folderIdFromUrl(url: string) {
  const m = url.match(/\/folders\/([a-zA-Z0-9_-]{15,})/) ?? url.match(/[?&]id=([a-zA-Z0-9_-]{15,})/)
  return m ? m[1] : null
}

async function setting(key: string) {
  const [[row]] = await db.query<(RowDataPacket & { value: string | null })[]>('SELECT value FROM app_settings WHERE `key` = ?', [key])
  return row?.value ?? null
}
async function saveSetting(key: string, value: string, userId: number | null) {
  await db.query('INSERT INTO app_settings (`key`, value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)', [key, value, userId])
}
export const loadSopFolderUrl = async () => (await setting(FOLDER_KEY)) || DEFAULT_SOP_FOLDER_URL
export async function saveSopFolderUrl(url: string, userId: number) {
  if (!folderIdFromUrl(url)) fail(400, 'Link folder tidak valid. Gunakan link "drive.google.com/drive/folders/...".')
  await saveSetting(FOLDER_KEY, url.slice(0, 1000), userId)
}
// { at: "2026-10-21 10:00:00", source: "akun Google" | "folder publik", count, error? }
export async function loadSyncInfo(): Promise<{ at: string | null; source: string | null; count: number; error: string | null }> {
  try {
    return { at: null, source: null, count: 0, error: null, ...JSON.parse((await setting(SYNC_KEY)) ?? '{}') }
  } catch {
    return { at: null, source: null, count: 0, error: null }
  }
}

// ---------- Kelompok mesin dari nama file / subfolder ----------
export const SOP_KATEGORI = ['Blow', 'Rotogravure', 'Gusset & Buffer', 'Cutseal', 'Umum'] as const
const KEYWORDS: [string, RegExp][] = [
  ['Gusset & Buffer', /gusset|buffer/],
  ['Cutseal', /cut\s*seal|pisau potong|sealer/],
  ['Rotogravure', /rotogravure|gravure|satelit|tinta|cetak|printing|sensor gambar|register/],
  ['Blow', /blow|dies|balon|blower|extruder|ekstruder|screw|penyedot bahan|hopper/],
]
const word = (text: string, w: string) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(text)
export function guessKategori(name: string, folder: string | null) {
  const text = `${folder ?? ''} ${name}`.toLowerCase().replace(/_/g, ' ')
  const kategori = KEYWORDS.find(([, re]) => re.test(text))?.[0] ?? 'Umum'
  const lini = word(text, 'pp') ? 'PP' : word(text, 'hd') ? 'HD' : null
  return { kategori, lini }
}

type Entry = { id: string; name: string; folder: string | null; mime: string | null; size: number | null; modified: string | null }

// Lewat Google Drive API (akun di Master Data): telusuri subfolder sampai MAX_DEPTH
async function listViaApi(rootId: string) {
  const out: Entry[] = []
  let queue: { id: string; path: string | null; depth: number }[] = [{ id: rootId, path: null, depth: 0 }]
  while (queue.length) {
    const next: typeof queue = []
    for (const folder of queue) {
      for (const item of await listDriveFolder(folder.id)) {
        if (item.isFolder) {
          if (folder.depth < MAX_DEPTH) next.push({ id: item.id, path: folder.path ? `${folder.path} / ${item.name}` : item.name, depth: folder.depth + 1 })
        } else if (item.mimeType.startsWith('video/') || VIDEO_EXT.test(item.name)) {
          out.push({ id: item.id, name: item.name, folder: folder.path, mime: item.mimeType, size: item.size, modified: item.modified })
        }
      }
    }
    queue = next
  }
  return out
}

// Lewat tampilan publik folder (tanpa login Google): halaman "embeddedfolderview"
async function listViaPublic(rootId: string) {
  const out: Entry[] = []
  let queue: { id: string; path: string | null; depth: number }[] = [{ id: rootId, path: null, depth: 0 }]
  const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
  while (queue.length) {
    const next: typeof queue = []
    for (const folder of queue) {
      const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folder.id)}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`Folder Drive tidak bisa dibuka (HTTP ${res.status}). Pastikan folder dibagikan "siapa saja yang memiliki link".`)
      const html = await res.text()
      const entries = [...html.matchAll(/<a href="([^"]+)"[^>]*>[\s\S]*?<div class="flip-entry-title">([^<]*)<\/div>/g)]
      for (const [, href, rawTitle] of entries) {
        const title = decode(rawTitle)
        const sub = href.match(/\/folders\/([a-zA-Z0-9_-]+)/)
        const file = href.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)
        if (sub && folder.depth < MAX_DEPTH) next.push({ id: sub[1], path: folder.path ? `${folder.path} / ${title}` : title, depth: folder.depth + 1 })
        else if (file && VIDEO_EXT.test(title)) out.push({ id: file[1], name: title, folder: folder.path, mime: null, size: null, modified: null })
      }
    }
    queue = next
  }
  return out
}

// Sinkron: ambil daftar video terbaru, simpan (kelompok yang dibetulkan manual tidak ditimpa), hapus yang sudah tidak ada
export async function syncSop() {
  const url = await loadSopFolderUrl()
  const rootId = folderIdFromUrl(url) ?? fail(400, 'Link folder SOP tidak valid.')
  let entries: Entry[]
  let source = 'folder publik'
  try {
    if (!(await driveEnabled())) throw new Error('Akun Google belum terhubung')
    entries = await listViaApi(rootId)
    source = 'akun Google'
  } catch {
    entries = await listViaPublic(rootId)
  }
  // Nol video hampir pasti karena gagal membaca folder: daftar lama jangan ikut terhapus
  if (!entries.length) fail(502, `Tidak ada video yang terbaca dari folder SOP (lewat ${source}). Periksa link & izin berbagi folder.`)
  const [[{ now }]] = await db.query<(RowDataPacket & { now: string })[]>('SELECT NOW() AS now')
  entries.sort((a, b) => `${a.folder ?? ''}/${a.name}`.localeCompare(`${b.folder ?? ''}/${b.name}`, 'id'))
  if (entries.length) {
    await db.query(
      `INSERT INTO sop_videos (drive_file_id, judul, nama_file, folder, mime, ukuran, diubah_drive, kategori, lini, urut, synced_at) VALUES ?
       ON DUPLICATE KEY UPDATE judul = VALUES(judul), nama_file = VALUES(nama_file), folder = VALUES(folder), mime = COALESCE(VALUES(mime), mime),
         ukuran = COALESCE(VALUES(ukuran), ukuran), diubah_drive = COALESCE(VALUES(diubah_drive), diubah_drive),
         kategori = IF(kategori_manual = 1, kategori, VALUES(kategori)), lini = IF(kategori_manual = 1, lini, VALUES(lini)),
         urut = VALUES(urut), synced_at = VALUES(synced_at)`,
      [entries.map((e, i) => {
        const g = guessKategori(e.name, e.folder)
        return [e.id, e.name.replace(VIDEO_EXT, '').trim().slice(0, 255), e.name.slice(0, 255), e.folder?.slice(0, 500) ?? null, e.mime, e.size, e.modified, g.kategori, g.lini, i + 1, now]
      })],
    )
  }
  await db.query('DELETE FROM sop_videos WHERE synced_at < ?', [now])
  const info = { at: now, source, count: entries.length, error: null }
  await saveSetting(SYNC_KEY, JSON.stringify(info), null)
  return info
}

export async function recordSyncError(message: string) {
  const info = await loadSyncInfo()
  await saveSetting(SYNC_KEY, JSON.stringify({ ...info, error: message.slice(0, 300) }), null)
}
