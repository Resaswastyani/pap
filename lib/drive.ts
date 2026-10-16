import { createSign } from 'node:crypto'
import type { RowDataPacket } from 'mysql2'
import { db } from '@/lib/db'

// Google Drive (baca saja) memakai service account, tanpa library tambahan.
// Env GOOGLE_SERVICE_ACCOUNT_JSON = isi file kunci JSON service account (boleh di-base64).
// Folder Drive harus dibagikan ke email service account (client_email) sebagai "Viewer",
// atau diset "Siapa saja yang memiliki link".

type ServiceAccount = { client_email: string; private_key: string }

function serviceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()
  if (!raw) return null
  try {
    const json = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'))
    return json.client_email && json.private_key ? { client_email: json.client_email, private_key: json.private_key } : null
  } catch {
    return null
  }
}

export const driveEnabled = () => !!serviceAccount()
export const driveServiceEmail = () => serviceAccount()?.client_email ?? null

const b64url = (value: string | Buffer) => Buffer.from(value).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
const globalForDrive = globalThis as unknown as { papDriveToken?: { token: string; exp: number } }

async function accessToken() {
  const cached = globalForDrive.papDriveToken
  if (cached && cached.exp > Date.now() + 60_000) return cached.token
  const sa = serviceAccount()
  if (!sa) throw new Error('Google Drive belum dikonfigurasi (GOOGLE_SERVICE_ACCOUNT_JSON).')
  const now = Math.floor(Date.now() / 1000)
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }))}`
  const signature = b64url(createSign('RSA-SHA256').update(unsigned).sign(sa.private_key))
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.access_token) throw new Error(`Login service account Google gagal: ${json.error_description ?? json.error ?? res.status}`)
  globalForDrive.papDriveToken = { token: json.access_token, exp: Date.now() + Number(json.expires_in ?? 3600) * 1000 }
  return json.access_token as string
}

export class DriveError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function driveGet<T>(path: string, params: Record<string, string> = {}) {
  const url = new URL(`https://www.googleapis.com/drive/v3/${path}`)
  for (const [k, v] of Object.entries({ supportsAllDrives: 'true', ...params })) url.searchParams.set(k, v)
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await accessToken()}` } })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new DriveError(res.status, json.error?.message ?? `Google Drive error ${res.status}`)
  return json as T
}

type DriveItem = {
  id: string; name: string; mimeType: string; size?: string; modifiedTime?: string; hasThumbnail?: boolean; webViewLink?: string
  shortcutDetails?: { targetId: string; targetMimeType: string }
}
const FOLDER = 'application/vnd.google-apps.folder'
const SHORTCUT = 'application/vnd.google-apps.shortcut'

async function listChildren(folderId: string) {
  const items: DriveItem[] = []
  let pageToken = ''
  do {
    const res = await driveGet<{ files: DriveItem[]; nextPageToken?: string }>('files', {
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime, hasThumbnail, webViewLink, shortcutDetails)',
      pageSize: '1000',
      includeItemsFromAllDrives: 'true',
      ...(pageToken ? { pageToken } : {}),
    })
    items.push(...res.files)
    pageToken = res.nextPageToken ?? ''
  } while (pageToken)
  return items
}

// Thumbnail dari Drive (diambil server; tautan thumbnail Drive butuh otorisasi & cepat kedaluwarsa)
export async function fetchThumbnail(fileId: string, size: number) {
  const meta = await driveGet<{ thumbnailLink?: string }>(`files/${encodeURIComponent(fileId)}`, { fields: 'thumbnailLink' })
  if (!meta.thumbnailLink) return null
  const res = await fetch(meta.thumbnailLink.replace(/=s\d+$/, `=s${size}`), { headers: { Authorization: `Bearer ${await accessToken()}` } })
  if (!res.ok) return null
  return { data: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') ?? 'image/jpeg' }
}

// "2026-10-15T08:30:00.000Z" -> waktu WIB "2026-10-15 15:30:00"
const toWib = (iso?: string) => (iso ? new Date(new Date(iso).getTime() + 7 * 3600e3).toISOString().slice(0, 19).replace('T', ' ') : null)
const baseName = (name: string) => name.replace(/\.[^.]+$/, '').trim()

type FolderRow = RowDataPacket & { id: string; root_id: number; name: string; path: string; depth: number; bulan: string | null; brand: string | null; kategori: 'logo' | 'cetak' }

// Folder dipindai ulang tiap RESCAN_HOURS jam; folder baru dipindai secepatnya.
const RESCAN_HOURS = 6

// Penelusuran bertahap (BFS) dalam batas waktu; sisa folder dilanjutkan pada putaran berikutnya.
// Struktur Cetak: Cetak 2026 / <bulan> / <brand/customer> / file. Struktur logo: PAP logo desain / <brand> / file.
export async function syncDrive(budgetMs = 25_000) {
  const started = Date.now()
  await db.query(
    `INSERT IGNORE INTO drive_folders (id, root_id, parent_id, name, path, depth) SELECT folder_id, id, NULL, label, '', 0 FROM drive_roots WHERE aktif = 1`,
  )
  let folders = 0
  let files = 0
  const errors: string[] = []
  while (Date.now() - started < budgetMs) {
    const [[folder]] = await db.query<FolderRow[]>(
      `SELECT f.*, r.kategori FROM drive_folders f JOIN drive_roots r ON r.id = f.root_id AND r.aktif = 1
       WHERE f.scanned_at IS NULL OR f.scanned_at < NOW() - INTERVAL ? HOUR
       ORDER BY (f.scanned_at IS NOT NULL), f.scanned_at, f.depth LIMIT 1`,
      [RESCAN_HOURS],
    )
    if (!folder) break
    const [[{ scanStart }]] = await db.query<(RowDataPacket & { scanStart: string })[]>('SELECT NOW() AS scanStart')
    let children: DriveItem[]
    try {
      children = await listChildren(folder.id)
      if (folder.depth === 0) await db.query('UPDATE drive_roots SET last_error = NULL WHERE id = ?', [folder.root_id])
    } catch (error) {
      const message = error instanceof DriveError && (error.status === 404 || error.status === 403)
        ? `Tidak punya akses ke folder "${folder.path || folder.name}". Bagikan folder ke ${driveServiceEmail()}.`
        : (error as Error).message
      errors.push(message)
      if (folder.depth === 0) await db.query('UPDATE drive_roots SET last_error = ? WHERE id = ?', [message.slice(0, 500), folder.root_id])
      await db.query('UPDATE drive_folders SET scanned_at = NOW() WHERE id = ?', [folder.id])
      if (!(error instanceof DriveError)) break
      continue
    }

    const subfolders: unknown[][] = []
    const fileRows: unknown[][] = []
    for (const item of children) {
      const isShortcut = item.mimeType === SHORTCUT && item.shortcutDetails
      const id = isShortcut ? item.shortcutDetails!.targetId : item.id
      const mime = isShortcut ? item.shortcutDetails!.targetMimeType : item.mimeType
      if (mime === FOLDER) {
        const bulan = folder.kategori === 'cetak' ? (folder.depth === 0 ? item.name : folder.bulan) : null
        const brand = folder.kategori === 'cetak' ? (folder.depth === 1 ? item.name : folder.brand) : (folder.depth === 0 ? item.name : folder.brand)
        subfolders.push([id, folder.root_id, folder.id, item.name.slice(0, 255), (folder.path ? `${folder.path} / ${item.name}` : item.name).slice(0, 1000), folder.depth + 1, bulan, brand])
      } else {
        // File tanpa folder brand (langsung di folder bulan/root): pakai nama file sebagai brand
        const brand = folder.brand ?? (folder.kategori === 'cetak' && folder.depth <= 1 ? baseName(item.name) : folder.kategori === 'logo' && folder.depth === 0 ? baseName(item.name) : null)
        fileRows.push([id, folder.root_id, folder.id, item.name.slice(0, 255), mime.slice(0, 150), item.size ? Number(item.size) : null, toWib(item.modifiedTime),
          item.hasThumbnail ? 1 : 0, item.webViewLink ?? null, folder.bulan, brand?.slice(0, 255) ?? null, scanStart])
      }
    }
    if (subfolders.length) {
      await db.query(
        `INSERT INTO drive_folders (id, root_id, parent_id, name, path, depth, bulan, brand) VALUES ?
         ON DUPLICATE KEY UPDATE parent_id = VALUES(parent_id), name = VALUES(name), path = VALUES(path), depth = VALUES(depth), bulan = VALUES(bulan), brand = VALUES(brand)`,
        [subfolders],
      )
    }
    if (fileRows.length) {
      await db.query(
        `INSERT INTO drive_files (id, root_id, folder_id, name, mime, size, modified_at, has_thumbnail, web_link, bulan, brand, synced_at) VALUES ?
         ON DUPLICATE KEY UPDATE folder_id = VALUES(folder_id), name = VALUES(name), mime = VALUES(mime), size = VALUES(size), modified_at = VALUES(modified_at),
           has_thumbnail = VALUES(has_thumbnail), web_link = VALUES(web_link), bulan = VALUES(bulan), brand = VALUES(brand), synced_at = VALUES(synced_at)`,
        [fileRows],
      )
    }
    // File / subfolder yang sudah tidak ada di Drive dihapus dari daftar
    await db.query('DELETE FROM drive_files WHERE folder_id = ? AND synced_at < ?', [folder.id, scanStart])
    const keep = subfolders.map((s) => s[0] as string)
    const [gone] = await db.query<(RowDataPacket & { id: string })[]>(
      `SELECT id FROM drive_folders WHERE parent_id = ? ${keep.length ? 'AND id NOT IN (?)' : ''}`,
      keep.length ? [folder.id, keep] : [folder.id],
    )
    if (gone.length) await removeFolders(gone.map((g) => g.id))
    await db.query('UPDATE drive_folders SET scanned_at = NOW() WHERE id = ?', [folder.id])
    folders++
    files += fileRows.length
  }
  await matchCustomers()
  const [[pending]] = await db.query<(RowDataPacket & { n: number })[]>(
    `SELECT COUNT(*) AS n FROM drive_folders f JOIN drive_roots r ON r.id = f.root_id AND r.aktif = 1 WHERE f.scanned_at IS NULL`,
  )
  return { folders, files, pending: Number(pending.n), errors }
}

async function removeFolders(ids: string[]) {
  let level = ids
  while (level.length) {
    const [children] = await db.query<(RowDataPacket & { id: string })[]>('SELECT id FROM drive_folders WHERE parent_id IN (?)', [level])
    await db.query('DELETE FROM drive_files WHERE folder_id IN (?)', [level])
    await db.query('DELETE FROM drive_folders WHERE id IN (?)', [level])
    level = children.map((c) => c.id)
  }
}

// Cocokkan nama folder brand dengan nama customer (tanpa PT/CV/UD/Toko, spasi & tanda baca).
// Yang sudah dihubungkan manual oleh admin tidak diubah.
export async function matchCustomers() {
  const norm = (col: string) => `REGEXP_REPLACE(REGEXP_REPLACE(LOWER(${col}), '^(pt|cv|ud|toko)[ .]+', ''), '[^a-z0-9]', '')`
  await db.query(
    `UPDATE drive_files f JOIN (
       SELECT ${norm('name')} AS k, MIN(id) AS id FROM customers GROUP BY k
     ) c ON c.k = ${norm('f.brand')} AND c.k <> ''
     SET f.customer_id = c.id WHERE f.customer_manual = 0 AND f.customer_id IS NULL AND f.brand IS NOT NULL`,
  )
}

export async function driveStatus() {
  const [roots] = await db.query<RowDataPacket[]>(
    `SELECT r.id, r.label, r.kategori, r.tahun, r.folder_id, r.aktif, r.last_error,
       (SELECT COUNT(*) FROM drive_files f WHERE f.root_id = r.id) AS files,
       (SELECT MAX(scanned_at) FROM drive_folders d WHERE d.root_id = r.id) AS last_scan,
       (SELECT COUNT(*) FROM drive_folders d WHERE d.root_id = r.id AND d.scanned_at IS NULL) AS pending
     FROM drive_roots r ORDER BY r.sort_order`,
  )
  return roots.map((r) => ({ ...r, files: Number(r.files), pending: Number(r.pending) }))
}
