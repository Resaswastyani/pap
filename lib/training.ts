// Training Karyawan (Guidance HR: program development HR untuk semua karyawan).
// Materi dari folder Google Drive "Training Karyawan" (dibaca dengan akun Google di Master Data; bila belum terhubung,
// lewat tampilan publik folder): tiap subfolder = satu modul, file di dalamnya (sampai 2 tingkat) = materi.
// Video diputar di SIMPAP (Drive preview), dokumen dibuka di Drive. HRD menambah link video lain (YouTube / Drive / web),
// deskripsi, kategori, sasaran divisi, dan mencatat peserta (karyawan dari Data Karyawan) beserta status & nilainya.
import type { RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'
import { driveEnabled, listDriveFolder } from '@/lib/drive'
import { canManageHr } from '@/lib/hrd'
import { folderIdFromUrl } from '@/lib/sop'
import type { UserProfile } from '@/lib/users'

export const TRAINING_FOLDER_KEY = 'hrd.training_folder_url'
const SYNC_KEY = 'hrd.training_synced'
export const TRAINING_STALE_HOURS = 6
const VIDEO_EXT = /\.(mp4|mov|m4v|mkv|avi|webm|3gp|wmv|mpe?g)$/i
const FOLDER_MIME = 'application/vnd.google-apps.folder'

export const requireTraining = (user: UserProfile) => {
  if (!user.menus.includes('training' as never)) fail(403, 'Anda tidak punya akses ke menu Training.')
}
export const canManageTraining = canManageHr

async function setting(key: string) {
  const [[row]] = await db.query<(RowDataPacket & { value: string | null })[]>('SELECT value FROM app_settings WHERE `key` = ?', [key])
  return row?.value ?? null
}
async function saveSetting(key: string, value: string, userId: number | null) {
  await db.query('INSERT INTO app_settings (`key`, value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)', [key, value, userId])
}
export const loadTrainingFolderUrl = async () => (await setting(TRAINING_FOLDER_KEY)) ?? ''
export async function saveTrainingFolderUrl(url: string, userId: number) {
  if (url && !folderIdFromUrl(url)) fail(400, 'Link folder tidak valid. Gunakan link "drive.google.com/drive/folders/...".')
  await saveSetting(TRAINING_FOLDER_KEY, url.slice(0, 1000), userId)
}
export async function loadTrainingSync(): Promise<{ at: string | null; source: string | null; modul: number; materi: number; error: string | null }> {
  try {
    return { at: null, source: null, modul: 0, materi: 0, error: null, ...JSON.parse((await setting(SYNC_KEY)) ?? '{}') }
  } catch {
    return { at: null, source: null, modul: 0, materi: 0, error: null }
  }
}

// ---------- Link video ----------
// YouTube / Google Drive -> URL yang bisa diputar di dalam halaman (iframe); selain itu dibuka di tab baru
export function embedUrl(url: string | null) {
  if (!url) return null
  const yt = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/)
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`
  const drive = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([a-zA-Z0-9_-]{15,})/)
  if (drive) return `https://drive.google.com/file/d/${drive[1]}/preview`
  if (/vimeo\.com\/(\d+)/.test(url)) return `https://player.vimeo.com/video/${url.match(/vimeo\.com\/(\d+)/)![1]}`
  return null
}
export const isVideoLink = (url: string) => !!embedUrl(url) || VIDEO_EXT.test(url)

// ---------- Baca folder Drive ----------
type Entry = { id: string; name: string; mime: string | null; size: number | null; folder: string | null }
type ModuleEntry = { id: string | null; name: string; files: Entry[] }

const kindOf = (name: string, mime: string | null) => (mime?.startsWith('video/') || VIDEO_EXT.test(name) ? 'video' : 'dokumen')

async function listViaApi(rootId: string) {
  const modules: ModuleEntry[] = []
  const root: ModuleEntry = { id: null, name: 'Umum', files: [] }
  for (const item of await listDriveFolder(rootId)) {
    if (!item.isFolder) {
      root.files.push({ id: item.id, name: item.name, mime: item.mimeType, size: item.size, folder: null })
      continue
    }
    const mod: ModuleEntry = { id: item.id, name: item.name, files: [] }
    // File di modul + satu tingkat subfolder di dalamnya
    for (const child of await listDriveFolder(item.id)) {
      if (!child.isFolder) mod.files.push({ id: child.id, name: child.name, mime: child.mimeType, size: child.size, folder: null })
      else {
        for (const sub of await listDriveFolder(child.id)) {
          if (!sub.isFolder) mod.files.push({ id: sub.id, name: sub.name, mime: sub.mimeType, size: sub.size, folder: child.name })
        }
      }
    }
    modules.push(mod)
  }
  if (root.files.length) modules.push(root)
  return modules
}

async function listViaPublic(rootId: string) {
  const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
  const read = async (id: string) => {
    const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(id)}`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`Folder Drive tidak bisa dibuka (HTTP ${res.status}). Pastikan folder dibagikan "siapa saja yang memiliki link" atau hubungkan akun Google.`)
    const html = await res.text()
    return [...html.matchAll(/<a href="([^"]+)"[^>]*>[\s\S]*?<div class="flip-entry-title">([^<]*)<\/div>/g)].map(([, href, title]) => {
      const sub = href.match(/\/folders\/([a-zA-Z0-9_-]+)/)
      const file = href.match(/\/(?:file\/d|document\/d|presentation\/d|spreadsheets\/d)\/([a-zA-Z0-9_-]+)/)
      return { id: sub?.[1] ?? file?.[1] ?? null, name: decode(title), isFolder: !!sub }
    }).filter((x): x is { id: string; name: string; isFolder: boolean } => !!x.id)
  }
  const modules: ModuleEntry[] = []
  const root: ModuleEntry = { id: null, name: 'Umum', files: [] }
  for (const item of await read(rootId)) {
    if (!item.isFolder) {
      root.files.push({ id: item.id, name: item.name, mime: null, size: null, folder: null })
      continue
    }
    const mod: ModuleEntry = { id: item.id, name: item.name, files: [] }
    for (const child of await read(item.id)) {
      if (!child.isFolder) mod.files.push({ id: child.id, name: child.name, mime: null, size: null, folder: null })
      else for (const sub of await read(child.id)) if (!sub.isFolder) mod.files.push({ id: sub.id, name: sub.name, mime: null, size: null, folder: child.name })
    }
    modules.push(mod)
  }
  if (root.files.length) modules.push(root)
  return modules
}

// Sinkron: modul & materi Drive diperbarui; materi Drive yang hilang dihapus; modul Drive yang hilang dinonaktifkan
// (catatan peserta tetap). Isian HRD (deskripsi, kategori, sasaran, link manual) tidak ditimpa.
export async function syncTraining() {
  const url = await loadTrainingFolderUrl()
  if (!url) fail(400, 'Link folder Drive Training belum diisi.')
  const rootId = folderIdFromUrl(url) ?? fail(400, 'Link folder Training tidak valid.')
  let modules: ModuleEntry[]
  let source = 'folder publik'
  try {
    if (!(await driveEnabled())) throw new Error('Akun Google belum terhubung')
    modules = await listViaApi(rootId)
    source = 'akun Google'
  } catch {
    modules = await listViaPublic(rootId)
  }
  if (!modules.length) fail(502, `Tidak ada subfolder / file yang terbaca dari folder Training (lewat ${source}). Periksa link & izin berbagi folder.`)
  const [[{ now }]] = await db.query<(RowDataPacket & { now: string })[]>('SELECT NOW() AS now')
  modules.sort((a, b) => a.name.localeCompare(b.name, 'id', { numeric: true }))
  let materi = 0
  for (const [i, m] of modules.entries()) {
    const folderKey = m.id ?? `root:${rootId}`
    await db.query(
      `INSERT INTO training_modules (drive_folder_id, judul, urut, aktif, synced_at) VALUES (?, ?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE judul = VALUES(judul), urut = VALUES(urut), aktif = 1, synced_at = VALUES(synced_at)`,
      [folderKey, m.name.slice(0, 255), i + 1, now],
    )
    const [[mod]] = await db.query<(RowDataPacket & { id: number })[]>('SELECT id FROM training_modules WHERE drive_folder_id = ?', [folderKey])
    const files = m.files.filter((f) => f.mime !== FOLDER_MIME).sort((a, b) => `${a.folder ?? ''}/${a.name}`.localeCompare(`${b.folder ?? ''}/${b.name}`, 'id', { numeric: true }))
    if (files.length) {
      await db.query(
        `INSERT INTO training_materials (module_id, sumber, drive_file_id, judul, jenis, mime, ukuran, folder, urut, synced_at) VALUES ?
         ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), judul = VALUES(judul), jenis = VALUES(jenis), mime = COALESCE(VALUES(mime), mime),
           ukuran = COALESCE(VALUES(ukuran), ukuran), folder = VALUES(folder), urut = VALUES(urut), synced_at = VALUES(synced_at)`,
        [files.map((f, j) => [mod.id, 'drive', f.id, f.name.replace(/\.[a-z0-9]{2,5}$/i, '').trim().slice(0, 255) || f.name.slice(0, 255), kindOf(f.name, f.mime), f.mime, f.size, f.folder?.slice(0, 500) ?? null, j + 1, now])],
      )
    }
    materi += files.length
  }
  await db.query("DELETE FROM training_materials WHERE sumber = 'drive' AND synced_at < ?", [now])
  await db.query('UPDATE training_modules SET aktif = 0 WHERE drive_folder_id IS NOT NULL AND synced_at < ?', [now])
  const info = { at: now, source, modul: modules.length, materi, error: null }
  await saveSetting(SYNC_KEY, JSON.stringify(info), null)
  return info
}
export async function recordTrainingSyncError(message: string) {
  const info = await loadTrainingSync()
  await saveSetting(SYNC_KEY, JSON.stringify({ ...info, error: message.slice(0, 500) }), null)
}

// Isian modul (tambah / ubah)
export function readModuleInput(body: Record<string, unknown>) {
  const judul = str(body.judul, 255)
  if (!judul) fail(400, 'Judul modul wajib diisi.')
  const durasi = body.durasi_menit === '' || body.durasi_menit == null ? null : Number(body.durasi_menit)
  if (durasi !== null && (!Number.isInteger(durasi) || durasi < 0 || durasi > 10000)) fail(400, 'Durasi tidak valid.')
  const sasaran = Array.isArray(body.sasaran) ? body.sasaran.map((s) => str(s, 100)).filter(Boolean).join(', ') : str(body.sasaran, 500)
  return { judul, kategori: str(body.kategori, 80) || null, deskripsi: str(body.deskripsi, 5000) || null, sasaran: sasaran.slice(0, 500) || null, wajib: body.wajib ? 1 : 0, durasi_menit: durasi }
}
