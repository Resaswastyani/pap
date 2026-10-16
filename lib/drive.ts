import { createCipheriv, createDecipheriv, createHash, createSign, randomBytes } from 'node:crypto'
import type { RowDataPacket } from 'mysql2'
import { db } from '@/lib/db'

// Google Drive (baca saja), tanpa library tambahan. Dua cara akses (pilih salah satu):
// 1. Akun Google (OAuth): admin klik "Hubungkan akun Google" lalu login dengan akun yang menerima share folder
//    (mis. resaarrazy@gmail.com). Env: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET.
// 2. Service account: env GOOGLE_SERVICE_ACCOUNT_JSON; folder dibagikan ke client_email service account.

const SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
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

const oauthClient = () => {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim()
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim()
  return id && secret ? { id, secret } : null
}
export const oauthConfigured = () => !!oauthClient()

// ---- Refresh token terenkripsi (kunci turunan AUTH_SECRET) ----
const cryptoKey = () => createHash('sha256').update(`${process.env.AUTH_SECRET ?? ''}:google-drive`).digest()
function encrypt(text: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', cryptoKey(), iv)
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.')
}
function decrypt(value: string) {
  const [iv, tag, data] = value.split('.').map((p) => Buffer.from(p, 'base64'))
  const decipher = createDecipheriv('aes-256-gcm', cryptoKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

type AuthRow = RowDataPacket & { email: string; refresh_token: string; connected_at: string; connected_name: string | null }
async function storedAuth() {
  const [[row]] = await db.query<AuthRow[]>(
    'SELECT a.email, a.refresh_token, a.connected_at, u.name AS connected_name FROM drive_auth a LEFT JOIN users u ON u.id = a.connected_by WHERE a.id = 1',
  )
  return row ?? null
}

// Akun yang dipakai membaca Drive: akun Google (bila terhubung) diutamakan, lalu service account
export async function driveAccount(): Promise<{ mode: 'oauth' | 'service'; email: string; connectedAt?: string; connectedBy?: string | null } | null> {
  if (oauthClient()) {
    const auth = await storedAuth()
    if (auth) return { mode: 'oauth', email: auth.email, connectedAt: auth.connected_at, connectedBy: auth.connected_name }
  }
  const sa = serviceAccount()
  return sa ? { mode: 'service', email: sa.client_email } : null
}
export const driveEnabled = async () => !!(await driveAccount())

// ---- Alur "Hubungkan akun Google" ----
export function driveAuthUrl(redirectUri: string, state: string) {
  const client = oauthClient()
  if (!client) throw new Error('GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET belum diisi.')
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.search = new URLSearchParams({
    client_id: client.id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: `openid email ${SCOPE}`,
    access_type: 'offline', // agar mendapat refresh token
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  }).toString()
  return url.toString()
}

export async function connectDriveAccount(code: string, redirectUri: string, userId: number) {
  const client = oauthClient()
  if (!client) throw new Error('Login Google belum dikonfigurasi.')
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: client.id, client_secret: client.secret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Login Google gagal: ${json.error_description ?? json.error ?? res.status}`)
  if (!String(json.scope ?? '').includes(SCOPE)) throw new Error('Izin "Lihat file Google Drive" tidak dicentang. Ulangi dan centang izin tersebut.')
  if (!json.refresh_token) throw new Error('Google tidak memberikan refresh token. Ulangi Hubungkan akun Google.')
  // id_token berisi email akun yang login
  const payload = JSON.parse(Buffer.from(String(json.id_token ?? '').split('.')[1] ?? '', 'base64url').toString('utf8') || '{}')
  const email = String(payload.email ?? 'akun Google')
  await db.query(
    `INSERT INTO drive_auth (id, email, refresh_token, connected_by, connected_at) VALUES (1, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE email = VALUES(email), refresh_token = VALUES(refresh_token), connected_by = VALUES(connected_by), connected_at = NOW()`,
    [email, encrypt(json.refresh_token), userId],
  )
  globalForDrive.papDriveToken = { token: json.access_token, exp: Date.now() + Number(json.expires_in ?? 3600) * 1000, key: `oauth:${email}` }
  // Folder yang sebelumnya gagal (belum punya akses) dipindai ulang
  await db.query('UPDATE drive_roots SET last_error = NULL')
  await db.query('UPDATE drive_folders SET scanned_at = NULL WHERE depth = 0')
  return email
}

export async function disconnectDriveAccount() {
  const auth = await storedAuth()
  await db.query('DELETE FROM drive_auth WHERE id = 1')
  globalForDrive.papDriveToken = undefined
  // Cabut izin di sisi Google juga (abaikan bila gagal)
  if (auth) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decrypt(auth.refresh_token))}`, { method: 'POST' }).catch(() => {})
}

const b64url = (value: string | Buffer) => Buffer.from(value).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
const globalForDrive = globalThis as unknown as { papDriveToken?: { token: string; exp: number; key: string } }

async function accessToken() {
  const account = await driveAccount()
  if (!account) throw new Error('Google Drive belum terhubung.')
  const key = `${account.mode}:${account.email}`
  const cached = globalForDrive.papDriveToken
  if (cached && cached.key === key && cached.exp > Date.now() + 60_000) return cached.token

  let body: URLSearchParams
  if (account.mode === 'oauth') {
    const client = oauthClient()!
    const auth = (await storedAuth())!
    body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: decrypt(auth.refresh_token), client_id: client.id, client_secret: client.secret })
  } else {
    const sa = serviceAccount()!
    const now = Math.floor(Date.now() / 1000)
    const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }))}`
    const signature = b64url(createSign('RSA-SHA256').update(unsigned).sign(sa.private_key))
    body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` })
  }
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.access_token) {
    if (account.mode === 'oauth' && json.error === 'invalid_grant') {
      throw new Error(`Akses Google ${account.email} sudah kedaluwarsa atau dicabut. Admin perlu klik "Hubungkan akun Google" lagi.`)
    }
    throw new Error(`Login Google gagal: ${json.error_description ?? json.error ?? res.status}`)
  }
  globalForDrive.papDriveToken = { token: json.access_token, exp: Date.now() + Number(json.expires_in ?? 3600) * 1000, key }
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
        ? `Tidak punya akses ke folder "${folder.path || folder.name}". Bagikan folder ke ${(await driveAccount())?.email ?? "akun Google yang terhubung"}.`
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
