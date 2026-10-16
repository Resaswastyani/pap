import { AsyncLocalStorage } from 'node:async_hooks'
import type { RowDataPacket } from 'mysql2'
import type { ActivityAction, ActivityChange, DeviceType } from '@/lib/activity-types'
import { db } from '@/lib/db'
import { getCurrentUser, type UserProfile } from '@/lib/users'

export { ACTIVITY_ACTIONS, ACTIVITY_MODULES, type ActivityAction, type ActivityChange, type DeviceType } from '@/lib/activity-types'

type Actor = { id: number | null; name: string }
type LogEntry = {
  module: string
  action: ActivityAction
  description: string
  entity?: { type: string; id: number | string | null; label?: string | null } | null
  changes?: ActivityChange[]
}

// ---------- Perangkat ----------

// Ringkasan perangkat dari User-Agent (+ Client Hints bila browser mengirimnya)
export function parseDevice(headers: Headers) {
  const ua = headers.get('user-agent') ?? ''
  const hintPlatform = headers.get('sec-ch-ua-platform')?.replaceAll('"', '')
  const hintMobile = headers.get('sec-ch-ua-mobile')

  const browser =
    match(ua, /Edg(?:e|A|iOS)?\/(\d+)/, 'Edge') ??
    match(ua, /(?:OPR|Opera)\/(\d+)/, 'Opera') ??
    match(ua, /SamsungBrowser\/(\d+)/, 'Samsung Internet') ??
    match(ua, /(?:Chrome|CriOS)\/(\d+)/, 'Chrome') ??
    match(ua, /(?:Firefox|FxiOS)\/(\d+)/, 'Firefox') ??
    match(ua, /Version\/(\d+).*Safari/, 'Safari') ??
    null

  let os: string | null = null
  const android = ua.match(/Android (\d+)/)
  const ios = ua.match(/(?:iPhone|CPU) OS (\d+)/)
  if (android) os = `Android ${android[1]}`
  else if (/iPad/.test(ua)) os = ios ? `iPadOS ${ios[1]}` : 'iPadOS'
  else if (ios) os = `iOS ${ios[1]}`
  else if (/Windows/.test(ua)) os = 'Windows'
  else if (/CrOS/.test(ua)) os = 'ChromeOS'
  else if (/Mac OS X/.test(ua)) os = 'macOS'
  else if (/Linux/.test(ua)) os = 'Linux'
  if (!os && hintPlatform) os = hintPlatform

  let type: DeviceType = 'lainnya'
  if (/iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) type = 'tablet'
  else if (/Mobi|iPhone/.test(ua) || hintMobile === '?1') type = 'mobile'
  else if (ua) type = 'desktop'

  const label = [browser, os, { desktop: 'Desktop', mobile: 'HP', tablet: 'Tablet', lainnya: null }[type]].filter(Boolean).join(' · ')
  const ip = headers.get('x-forwarded-for')?.split(',')[0].trim() || headers.get('x-real-ip') || null
  return { label: label || 'Tidak diketahui', type, ip, ua: ua.slice(0, 500) || null }
}

const match = (ua: string, re: RegExp, name: string) => {
  const m = ua.match(re)
  return m ? `${name} ${m[1]}` : null
}

// ---------- Simpan log ----------

export async function insertLog(request: Request, actor: Actor, entry: LogEntry) {
  try {
    const device = parseDevice(request.headers)
    const url = new URL(request.url)
    await db.query(
      `INSERT INTO activity_logs (actor_id, actor_name, module, action, entity_type, entity_id, entity_label, description, changes,
         method, path, device, device_type, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actor.id, actor.name.slice(0, 150), entry.module, entry.action, entry.entity?.type ?? null,
        entry.entity?.id != null ? String(entry.entity.id) : null, entry.entity?.label?.slice(0, 200) ?? null,
        entry.description.slice(0, 500), entry.changes?.length ? JSON.stringify(entry.changes) : null,
        request.method, url.pathname.slice(0, 255), device.label.slice(0, 150), device.type, device.ip, device.ua,
      ],
    )
  } catch (error) {
    // Kegagalan mencatat tidak boleh menggagalkan aksi utamanya
    console.error('[activity] gagal mencatat log', error)
  }
}

// ---------- Konteks per request (dipakai handle() & requireUser()) ----------

type Ctx = { request: Request; actor: UserProfile | null; logged: boolean }
const store = new AsyncLocalStorage<Ctx>()

export const setActivityActor = (user: UserProfile) => {
  const ctx = store.getStore()
  if (ctx) ctx.actor = user
}

// Log khusus dari route (lebih rinci daripada log otomatis); log otomatis untuk request ini dilewati
export async function logActivity(request: Request, actor: UserProfile, entry: LogEntry) {
  const ctx = store.getStore()
  if (ctx) ctx.logged = true
  await insertLog(request, actor, entry)
}

// ---------- Log otomatis untuk semua aksi tambah/ubah/hapus ----------

type Resource = { module: string; noun: string; table?: string; files?: string }
const RESOURCES: Record<string, Resource> = {
  users: { module: 'Manajemen User', noun: 'user', table: 'users' },
  roles: { module: 'Manajemen Role', noun: 'role', table: 'roles' },
  planning: { module: 'Planning', noun: 'planning', table: 'plannings', files: 'planning_files' },
  meetings: { module: 'Meeting', noun: 'meeting', table: 'meetings', files: 'meeting_files' },
  prospects: { module: 'Prospek', noun: 'prospek', table: 'prospects' },
  visits: { module: 'Jadwal Visit', noun: 'visit', table: 'visits' },
  customers: { module: 'Customer', noun: 'customer', table: 'customers' },
  products: { module: 'Data Produk', noun: 'produk', table: 'customer_products', files: 'customer_product_files' },
  production: { module: 'Jadwal Produksi', noun: 'job produksi', table: 'production_jobs' },
  machines: { module: 'Data Mesin', noun: 'mesin', table: 'machines' },
  accurate: { module: 'Accurate', noun: 'data Accurate' },
}

type Plan = {
  module: string
  action: ActivityAction
  entityType: string
  table?: string
  id?: string
  always?: boolean // tetap dicatat walau baris utamanya tidak berubah (mis. data di tabel anak)
  describe: (label: string, body: Fields, changes: ActivityChange[]) => string
}
type Fields = Record<string, string>

const VERB: Record<string, string> = { create: 'Menambah', update: 'Mengubah', delete: 'Menghapus' }
const changed = (changes: ActivityChange[]) => (changes.length ? ` (${changes.slice(0, 4).map((c) => c.field.toLowerCase()).join(', ')}${changes.length > 4 ? ', ...' : ''})` : '')

function planFor(method: string, path: string): Plan | null {
  const [res, a, b] = path.replace(/^\/api\//, '').split('/')
  const r = RESOURCES[res]
  if (!r) return null // notifikasi, push, auth (dicatat sendiri), cron, dll.
  const isId = (v?: string) => !!v && /^\d+$/.test(v)
  const base = { module: r.module, entityType: r.noun }

  if (a === 'files' && isId(b) && method === 'DELETE' && r.files)
    return { ...base, action: 'delete', entityType: 'lampiran', table: r.files, id: b, describe: (l) => `Menghapus lampiran ${l} dari ${r.noun}` }
  if (isId(a) && b === 'files' && method === 'POST')
    return { ...base, action: 'upload', table: r.table, id: a, describe: (l, f) => `Mengunggah lampiran${f.file ? ` ${f.file}` : f.url ? ` ${f.url}` : ''} ke ${r.noun} ${l}` }
  if (res === 'planning' && isId(a) && b === 'progress')
    return { ...base, action: 'update', always: true, table: r.table, id: a, describe: (l, f) => `Memperbarui progress planning ${l}${f.progress ? ` menjadi ${f.progress}%` : ''}` }
  if (res === 'planning' && a === 'notes' && isId(b))
    return { ...base, action: method === 'DELETE' ? 'delete' : 'update', entityType: 'catatan progress', table: 'planning_progress_notes', id: b, describe: (l, _f, c) => `${VERB[method === 'DELETE' ? 'delete' : 'update']} catatan progress ${l}${changed(c)}` }
  if (res === 'production' && isId(a) && b === 'stages')
    return { ...base, action: 'update', always: true, table: r.table, id: a, describe: (l) => `Mengatur tahap produksi job ${l}` }
  if (res === 'production' && a === 'stages' && isId(b))
    return { ...base, action: 'update', entityType: 'tahap produksi', table: 'production_stages', id: b, describe: (l, _f, c) => `Memperbarui tahap produksi ${l}${changed(c)}` }
  if (res === 'prospects' && isId(a) && b === 'activities')
    return { ...base, action: 'create', table: r.table, id: a, describe: (l, f) => `Mencatat follow up${f.jenis ? ` (${f.jenis})` : ''} prospek ${l}` }
  if (res === 'prospects' && isId(a) && b === 'customer')
    return { ...base, action: 'update', table: r.table, id: a, describe: (l) => `Menghubungkan prospek ${l} ke customer` }
  if (res === 'prospects' && a === 'import')
    return { ...base, action: 'import', describe: () => 'Mengimpor data prospek' }
  if (res === 'visits' && isId(a) && b === 'checkin')
    return { ...base, action: 'checkin', table: r.table, id: a, describe: (l) => `Check-in visit ${l}` }
  if (res === 'accurate' && a === 'sync')
    return { ...base, action: 'sync', describe: (_l, f) => `Menjalankan sinkron data Accurate${f.entity ? ` (${f.entity})` : ''}` }

  const action: ActivityAction = method === 'POST' ? 'create' : method === 'DELETE' ? 'delete' : 'update'
  if (action === 'create' && !a) return { ...base, action, table: r.table, describe: (l) => `Menambah ${r.noun} ${l}` }
  if (isId(a) && !b) return { ...base, action, always: res === 'roles', table: r.table, id: a, describe: (l, _f, c) => `${VERB[action]} ${r.noun} ${l}${action === 'update' ? changed(c) : ''}` }
  return { ...base, action, describe: () => `${VERB[action] ?? 'Mengubah'} ${r.noun} (${method} ${path})` }
}

const SKIP_COLS = new Set(['id', 'created_at', 'updated_at', 'synced_at', 'raw', 'data', 'foto', 'password_hash', 'last_update', 'items_synced_update', 'detail_synced_update', 'created_by', 'updated_by', 'uploaded_by'])
const LABEL_COLS = ['judul', 'nama_usaha', 'nama', 'name', 'item_name', 'tahap', 'tujuan']

async function loadRow(table: string | undefined, id: string | number | undefined | null) {
  if (!table || id == null) return null
  try {
    const [rows] = await db.query<RowDataPacket[]>(`SELECT * FROM \`${table}\` WHERE id = ?`, [id])
    return rows[0] ?? null
  } catch {
    return null
  }
}

function rowLabel(row: RowDataPacket | null, id: string | number | null | undefined) {
  const name = row && LABEL_COLS.map((c) => row[c]).find((v) => typeof v === 'string' && v.trim())
  const nomor = row?.nomor && row.nomor !== name ? String(row.nomor) : null
  return [nomor, name].filter(Boolean).join(' · ') || (id != null ? `#${id}` : '')
}

const humanize = (col: string) => col.replace(/_id$/, '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
const show = (v: unknown) => (v == null || v === '' ? null : String(v instanceof Date ? v.toISOString() : v).slice(0, 120))

function diffRows(before: RowDataPacket | null, after: RowDataPacket | null): ActivityChange[] {
  if (!before || !after) return []
  return Object.keys(after)
    .filter((k) => !SKIP_COLS.has(k) && !Buffer.isBuffer(after[k]) && show(before[k]) !== show(after[k]))
    .map((k) => ({ field: humanize(k), from: show(before[k]), to: show(after[k]) }))
}

async function readFields(request: Request): Promise<Fields> {
  const fields: Fields = {}
  try {
    const type = request.headers.get('content-type') ?? ''
    if (type.includes('application/json')) {
      const body = await request.json()
      for (const [k, v] of Object.entries(body ?? {})) if (typeof v === 'string' || typeof v === 'number') fields[k] = String(v)
    } else if (type.includes('multipart/form-data')) {
      for (const [k, v] of (await request.formData()).entries()) fields[k] = typeof v === 'string' ? v : v.name
    }
  } catch {
    // body kosong / bukan JSON
  }
  return fields
}

// Membungkus eksekusi route; dipanggil dari handle()
export async function withActivity(request: Request | null, run: () => Promise<Response>) {
  if (!request || request.method === 'GET' || request.method === 'HEAD') return run()
  const ctx: Ctx = { request, actor: null, logged: false }
  const path = new URL(request.url).pathname
  const plan = planFor(request.method, path)
  const fields = plan ? await readFields(request.clone()) : {}
  const before = plan && plan.action !== 'create' ? await loadRow(plan.table, plan.id) : null

  const response = await store.run(ctx, run)
  if (!plan || ctx.logged || response.status >= 400) return response

  try {
    const actor = ctx.actor ?? (await getCurrentUser())
    let id: string | number | null | undefined = plan.id
    if (plan.action === 'create' && !id) id = (await response.clone().json().catch(() => null))?.id ?? null
    const after = plan.action === 'delete' ? null : await loadRow(plan.table, id)
    const changes = plan.action === 'update' ? diffRows(before, after) : []
    const label = rowLabel(after ?? before, id) || fields.judul || fields.nama || fields.name || ''
    // Ubah tanpa perubahan data apa pun (mis. simpan ulang form yang sama) tidak dicatat
    if (plan.action === 'update' && !plan.always && before && after && !changes.length) return response
    await insertLog(request, actor ? { id: actor.id, name: actor.name } : { id: null, name: 'Tidak diketahui' }, {
      module: plan.module,
      action: plan.action,
      entity: { type: plan.entityType, id: id ?? null, label },
      description: plan.describe(label, fields, changes).replace(/\s+/g, ' ').trim(),
      changes,
    })
  } catch (error) {
    console.error('[activity] log otomatis gagal', error)
  }
  return response
}

// ---------- Manajemen User (log rinci: nama divisi & role, bukan id) ----------

export type UserSnapshot = { id: number; name: string; email: string; division: string; role: string; is_active: boolean }
export async function userSnapshot(id: number): Promise<UserSnapshot | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT u.id, u.name, u.email, d.name AS division, r.name AS role, u.is_active
     FROM users u JOIN divisions d ON d.id = u.division_id JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    [id],
  )
  return rows[0] ? ({ ...rows[0], is_active: !!rows[0].is_active } as UserSnapshot) : null
}

const USER_FIELDS: Record<Exclude<keyof UserSnapshot, 'id'>, string> = { name: 'Nama', email: 'Email', division: 'Divisi', role: 'Role', is_active: 'Status' }
const showUser = (key: string, value: unknown) => (key === 'is_active' ? (value ? 'Aktif' : 'Nonaktif') : String(value))

export function diffSnapshots(before: UserSnapshot, after: UserSnapshot): ActivityChange[] {
  return (Object.keys(USER_FIELDS) as (keyof typeof USER_FIELDS)[])
    .filter((key) => before[key] !== after[key])
    .map((key) => ({ field: USER_FIELDS[key], from: showUser(key, before[key]), to: showUser(key, after[key]) }))
}

export function logUserActivity(
  request: Request,
  actor: UserProfile,
  entry: { action: ActivityAction; target: { id: number; name: string; email: string } | null; description: string; changes?: ActivityChange[] },
) {
  return logActivity(request, actor, {
    module: 'Manajemen User',
    action: entry.action,
    entity: entry.target ? { type: 'user', id: entry.target.id, label: `${entry.target.name} · ${entry.target.email}` } : null,
    description: entry.description,
    changes: entry.changes,
  })
}
