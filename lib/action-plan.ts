import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { fail } from '@/lib/api'
import { db } from '@/lib/db'
import { notify } from '@/lib/notifications'
import { pushToUsers } from '@/lib/push'
import { openWorkbook, readRaw, readTab, READONLY_EXCEL, replaceBlock, SheetWriteError, trySheet, withWorkbook, writeCells, type Sheet } from '@/lib/sheet-write'
import { isManagement, type UserProfile } from '@/lib/users'

// ===== Action Plan (Corporate Plan) =====
// Program Kerja + PIC (akun SIMPAP) + Progress Report + Issue Log + KPI, sinkron dua arah dengan Google Sheet
// template "Plan Monitoring Program Kerja". Hanya Admin / Super Admin yang membuat & mengubah program;
// PIC / support hanya meng-update progress. Program yang dibatalkan tetap tercatat dan bisa diaktifkan kembali.

export const AP_STATUS = ['Not Started', 'On Progress', 'Pending', 'Waiting Approval', 'Done', 'Overdue', 'Cancelled'] as const
export const AP_PRIORITY = ['High', 'Medium', 'Low'] as const
export const AP_JENIS = ['Program Strategis', 'Project', 'Routine Task', 'Improvement', 'Expansion', 'Issue Resolution']
export const AP_DIVISI = ['Management', 'Business Development', 'Produksi & Tehnik', 'Marketing', 'HR', 'Finance', 'Procurement', 'Cabang', 'Training', 'IT/System', 'PPIC & Purchasing']
export const AP_SEVERITY = ['High', 'Medium', 'Low'] as const
export const ISSUE_STATUS = ['Not Started', 'On Progress', 'Pending', 'Waiting Approval', 'Done', 'Cancelled'] as const
// Status yang bisa dipilih PIC saat update progress (bukan Overdue / Cancelled)
export const PIC_STATUS = ['Not Started', 'On Progress', 'Pending', 'Waiting Approval', 'Done'] as const
export type ApStatus = (typeof AP_STATUS)[number]

const SETTING_URL = 'actionplan.sheet_url'
const SETTING_SYNC = 'actionplan.synced_at'
type Row = RowDataPacket & Record<string, unknown>

// ---------- Hak akses ----------
// Admin / Super Admin: kelola semua. GM: lihat semua. Lead: program dengan PIC/support dari divisinya + miliknya.
// Lainnya: program tempat ia menjadi PIC / support.
export const canManageAP = (user: UserProfile) => user.role.isAdmin
export const canViewAllAP = (user: UserProfile) => isManagement(user)

export function apScope(user: UserProfile, alias = 'p') {
  if (canViewAllAP(user)) return { sql: '1 = 1', params: [] as number[] }
  const own = `EXISTS (SELECT 1 FROM action_program_users x WHERE x.program_id = ${alias}.id AND x.user_id = ?)`
  if (user.role.code === 'lead') {
    return {
      sql: `(${own} OR EXISTS (SELECT 1 FROM action_program_users x JOIN users xu ON xu.id = x.user_id WHERE x.program_id = ${alias}.id AND xu.division_id = ?))`,
      params: [user.id, user.division.id],
    }
  }
  return { sql: own, params: [user.id] }
}

export function requireActionPlan(user: UserProfile) {
  if (!user.menus.includes('action-plan' as never)) fail(403, 'Anda tidak punya akses ke menu Action Plan.')
}

export function requireManageAP(user: UserProfile) {
  if (!canManageAP(user)) fail(403, 'Hanya Admin / Super Admin yang dapat mengelola Action Plan.')
}

// Overdue: belum selesai / dibatalkan dan lewat End Date, atau ditandai Overdue di sheet
export const OVERDUE_SQL = (a = 'p') =>
  `(${a}.status NOT IN ('Done', 'Cancelled') AND (${a}.status = 'Overdue' OR (${a}.end_date IS NOT NULL AND ${a}.end_date < CURDATE())))`

export const PROGRAM_SELECT = `SELECT p.*, ${OVERDUE_SQL()} AS overdue,
  IF(p.end_date IS NOT NULL AND p.end_date < CURDATE(), DATEDIFF(CURDATE(), p.end_date), 0) AS hari_lewat,
  uc.name AS cancelled_name,
  (SELECT MAX(g.created_at) FROM action_progress g WHERE g.program_id = p.id AND g.jenis IN ('update', 'sheet')) AS last_update,
  (SELECT COUNT(*) FROM action_issues i WHERE i.program_id = p.id AND i.status NOT IN ('Done', 'Cancelled')) AS open_issues
  FROM action_programs p LEFT JOIN users uc ON uc.id = p.cancelled_by`

export async function attachPeople<T extends { id: number }>(programs: T[]) {
  if (!programs.length) return programs.map((p) => ({ ...p, people: [] as { user_id: number; name: string; peran: string; division: string | null }[] }))
  const [rows] = await db.query<Row[]>(
    `SELECT x.program_id, x.user_id, x.peran, u.name, d.name AS division FROM action_program_users x JOIN users u ON u.id = x.user_id
     LEFT JOIN divisions d ON d.id = u.division_id WHERE x.program_id IN (?) ORDER BY x.peran, u.name`,
    [programs.map((p) => p.id)],
  )
  return programs.map((p) => ({
    ...p,
    people: rows.filter((r) => r.program_id === p.id).map((r) => ({ user_id: Number(r.user_id), name: String(r.name), peran: String(r.peran), division: (r.division as string) ?? null })),
  }))
}

export const serializeProgram = (p: Row) => ({ ...p, overdue: !!Number(p.overdue), hari_lewat: Number(p.hari_lewat ?? 0), progress: Number(p.progress ?? 0), open_issues: Number(p.open_issues ?? 0) })

export async function loadProgram(id: number, user: UserProfile) {
  const scope = apScope(user)
  const [rows] = await db.query<Row[]>(`${PROGRAM_SELECT} WHERE p.id = ? AND ${scope.sql}`, [id, ...scope.params])
  if (!rows[0]) fail(404, 'Program tidak ditemukan atau bukan milik Anda.')
  return (await attachPeople([serializeProgram(rows[0]) as unknown as Row & { id: number }]))[0]
}

export async function isPersonOf(programId: number, userId: number) {
  const [[row]] = await db.query<Row[]>('SELECT peran FROM action_program_users WHERE program_id = ? AND user_id = ?', [programId, userId])
  return row ? String(row.peran) : null
}

// ---------- Nilai input ----------
const text = (v: unknown, max = 255) => (v === null || v === undefined ? '' : String(v).trim().slice(0, max))
const pick = <T extends string>(v: unknown, list: readonly T[]) => {
  const t = text(v, 60).toLowerCase()
  return list.find((x) => x.toLowerCase() === t) ?? null
}
const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1, feb: 2, peb: 2, februari: 2, february: 2, mar: 3, maret: 3, march: 3, apr: 4, april: 4, mei: 5, may: 5,
  jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, agu: 8, agt: 8, agus: 8, agust: 8, agustus: 8, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, okt: 10, oct: 10, oktober: 10, october: 10, nov: 11, nop: 11, november: 11, des: 12, dec: 12, desember: 12, december: 12,
}
const iso = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null
}
// Tanggal dari sheet / Excel / form: angka seri Excel, YYYY-MM-DD, dd/mm/yyyy, "1 Juli 26", "15 Agust 2026". Gagal = null.
export function parseApDate(value: unknown): string | null {
  const t = text(value, 60)
  if (!t) return null
  if (/^\d{4,5}(\.\d+)?$/.test(t)) {
    const n = Math.floor(Number(t))
    return n > 20000 && n < 80000 ? new Date(Date.UTC(1899, 11, 30) + n * 86400e3).toISOString().slice(0, 10) : null
  }
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return iso(+m[1], +m[2], +m[3])
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/)
  if (m) return iso(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[2], +m[1])
  m = t.toLowerCase().replace(/\s+/g, ' ').match(/^(\d{1,2}) ([a-z]+)\.? (\d{2,4})$/)
  if (m && MONTHS[m[2]]) return iso(+m[3] < 100 ? 2000 + +m[3] : +m[3], MONTHS[m[2]], +m[1])
  return null
}
// Progress: 0.35 / "35%" / 35 -> 35 (0-100); kosong = null. fraction = nilai mentah sheet/Excel (sel persen: 1 = 100%)
export function parseProgress(value: unknown, fraction = false): number | null {
  const t = text(value, 20).replace('%', '').replace(',', '.')
  if (!t) return null
  const n = Number(t)
  if (!Number.isFinite(n)) return null
  const pct = !/%/.test(String(value)) && n > 0 && n <= 1 && (fraction || /\./.test(t)) ? n * 100 : n
  return Math.max(0, Math.min(100, Math.round(pct)))
}

export type ProgramInput = {
  nama: string; jenis: string | null; divisi: string | null; tujuan: string | null; target: string | null; pic_text: string | null; support_text: string | null
  start_date: string | null; end_date: string | null; start_text: string | null; end_text: string | null; priority: string | null; status: ApStatus; progress: number | null; catatan: string | null
}
export function readProgramInput(body: Record<string, unknown>, partialStatus = false): ProgramInput {
  const nama = text(body.nama, 255)
  if (!nama) fail(400, 'Nama program wajib diisi.')
  const start = parseApDate(body.start_date)
  const end = parseApDate(body.end_date)
  if (start && end && end < start) fail(400, 'End Date tidak boleh sebelum Start Date.')
  const status = pick(body.status, AP_STATUS) ?? (partialStatus ? null : 'Not Started')
  return {
    nama, jenis: text(body.jenis, 60) || null, divisi: text(body.divisi, 80) || null, tujuan: text(body.tujuan, 5000) || null, target: text(body.target, 500) || null,
    pic_text: text(body.pic_text, 255) || null, support_text: text(body.support_text, 255) || null,
    start_date: start, end_date: end, start_text: start ? null : text(body.start_date, 60) || null, end_text: end ? null : text(body.end_date, 60) || null,
    priority: pick(body.priority, AP_PRIORITY), status: (status ?? 'Not Started') as ApStatus, progress: parseProgress(body.progress), catatan: text(body.catatan, 5000) || null,
  }
}

// Issue Log dari form admin
export async function readIssueInput(body: Record<string, unknown>) {
  const issue = text(body.issue, 5000)
  if (!issue) fail(400, 'Tulis issue / kendala.')
  const kode = text(body.program_kode, 20).toUpperCase() || null
  let programId: number | null = null
  if (kode) {
    const [[p]] = await db.query<Row[]>('SELECT id FROM action_programs WHERE kode = ?', [kode])
    if (!p) fail(400, `Program ${kode} tidak ditemukan.`)
    programId = Number(p.id)
  }
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
  const target = body.target_date ? parseApDate(body.target_date) : null
  if (body.target_date && !target) fail(400, 'Target selesai tidak valid.')
  return {
    program_id: programId, program_kode: kode, tanggal: parseApDate(body.tanggal) ?? today, issue, dampak: text(body.dampak, 5000) || null,
    severity: pick(body.severity, AP_SEVERITY), pic_text: text(body.pic_text, 255) || null, target_date: target,
    status: pick(body.status, ISSUE_STATUS) ?? 'On Progress', akar_masalah: text(body.akar_masalah, 5000) || null, mitigasi: text(body.mitigasi, 5000) || null, catatan: text(body.catatan, 5000) || null,
  }
}

export async function nextKode() {
  const [[row]] = await db.query<Row[]>("SELECT MAX(CAST(SUBSTRING(kode, 5) AS UNSIGNED)) AS n FROM action_programs WHERE kode REGEXP '^PRG-[0-9]+$'")
  return `PRG-${String(Number(row?.n ?? 0) + 1).padStart(3, '0')}`
}

// PIC / support (akun SIMPAP) dipilih admin: { pic: number[], support: number[] }. Mengembalikan akun yang baru ditambahkan.
export async function savePeople(programId: number, pic: unknown, support: unknown) {
  const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : [])
  const p = ids(pic)
  const s = ids(support).filter((id) => !p.includes(id))
  const all = [...p, ...s]
  if (all.length) {
    const [found] = await db.query<Row[]>('SELECT id FROM users WHERE id IN (?) AND is_active = 1', [all])
    if (found.length !== all.length) fail(400, 'Ada akun PIC / support yang tidak aktif atau tidak ditemukan.')
  }
  const [before] = await db.query<Row[]>('SELECT user_id FROM action_program_users WHERE program_id = ?', [programId])
  const old = new Set(before.map((r) => Number(r.user_id)))
  await db.query('DELETE FROM action_program_users WHERE program_id = ?', [programId])
  if (all.length) await db.query('INSERT INTO action_program_users (program_id, user_id, peran) VALUES ?', [[...p.map((u) => [programId, u, 'pic']), ...s.map((u) => [programId, u, 'support'])]])
  return all.filter((u) => !old.has(u))
}

export async function notifyPeople(userIds: number[], actorId: number, program: { id: number; kode: string; nama: string }, title: string, body?: string) {
  const ids = [...new Set(userIds)].filter((id) => id && id !== actorId)
  if (!ids.length) return
  await pushToUsers(await notify(ids, { type: 'action_plan', title, body: body ?? `${program.kode} · ${program.nama}`, page: 'Action Plan', pageId: program.id, refKey: `ap:${program.id}:${Date.now()}` }))
}

export async function adminUserIds() {
  const [rows] = await db.query<Row[]>('SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.is_active = 1 AND r.is_admin = 1')
  return rows.map((r) => Number(r.id))
}

// ---------- Ringkasan & KPI ----------
export async function apSummary(user: UserProfile) {
  const scope = apScope(user)
  const [[s]] = await db.query<Row[]>(
    `SELECT COUNT(*) AS total, SUM(p.status = 'Done') AS done, SUM(p.status = 'On Progress') AS on_progress,
       SUM(p.status IN ('Pending', 'Waiting Approval')) AS pending, SUM(p.status = 'Not Started') AS not_started,
       SUM(p.status = 'Cancelled') AS cancelled, SUM(${OVERDUE_SQL()}) AS overdue,
       AVG(IF(p.status = 'Cancelled', NULL, p.progress)) AS avg_progress
     FROM action_programs p WHERE ${scope.sql}`,
    scope.params,
  )
  const n = (v: unknown) => Number(v ?? 0)
  const [byStatus] = await db.query<Row[]>(`SELECT IF(${OVERDUE_SQL()}, 'Overdue', p.status) AS status, COUNT(*) AS n FROM action_programs p WHERE ${scope.sql} GROUP BY 1`, scope.params)
  const [byPriority] = await db.query<Row[]>(
    `SELECT COALESCE(p.priority, '-') AS priority, COUNT(*) AS n, SUM(p.status = 'Done') AS done, SUM(${OVERDUE_SQL()}) AS overdue
     FROM action_programs p WHERE ${scope.sql} AND p.status <> 'Cancelled' GROUP BY 1`,
    scope.params,
  )
  const [byDivisi] = await db.query<Row[]>(
    `SELECT COALESCE(p.divisi, '-') AS divisi, COUNT(*) AS n, SUM(p.status = 'Done') AS done, SUM(${OVERDUE_SQL()}) AS overdue, AVG(p.progress) AS avg_progress
     FROM action_programs p WHERE ${scope.sql} AND p.status <> 'Cancelled' GROUP BY 1 ORDER BY n DESC`,
    scope.params,
  )
  return {
    total: n(s.total) - n(s.cancelled), done: n(s.done), on_progress: n(s.on_progress), pending: n(s.pending), not_started: n(s.not_started), cancelled: n(s.cancelled),
    overdue: n(s.overdue), avg_progress: Math.round(n(s.avg_progress)),
    byStatus: byStatus.map((r) => ({ status: String(r.status), n: n(r.n) })),
    byPriority: byPriority.map((r) => ({ priority: String(r.priority), n: n(r.n), done: n(r.done), overdue: n(r.overdue) })),
    byDivisi: byDivisi.map((r) => ({ divisi: String(r.divisi), n: n(r.n), done: n(r.done), overdue: n(r.overdue), avg_progress: Math.round(n(r.avg_progress)) })),
  }
}

// Realisasi KPI berkode dihitung dari semua program (tidak dibatasi hak lihat)
export async function computeKpis() {
  const [[s]] = await db.query<Row[]>(
    `SELECT COUNT(*) AS total, SUM(p.status = 'Done') AS done, SUM(${OVERDUE_SQL()}) AS overdue,
       SUM(p.status NOT IN ('Done', 'Cancelled') AND COALESCE(p.pic_text, '') = '' AND NOT EXISTS (SELECT 1 FROM action_program_users x WHERE x.program_id = p.id AND x.peran = 'pic')) AS no_pic,
       SUM(p.status NOT IN ('Done', 'Cancelled') AND p.end_date IS NULL) AS no_deadline
     FROM action_programs p WHERE p.status <> 'Cancelled'`,
  )
  const total = Number(s.total ?? 0)
  const pct = (v: unknown) => (total ? `${Math.round((Number(v ?? 0) / total) * 100)}%` : '0%')
  const [rows] = await db.query<Row[]>('SELECT * FROM action_kpis ORDER BY urutan, id')
  const num = (t: unknown) => Number(String(t ?? '').replace(/[^\d.]/g, '') || 0)
  return rows.map((k) => {
    let realisasi: string | null = (k.realisasi as string) ?? null
    let status: string | null = (k.status as string) ?? null
    const target = String(k.target ?? '')
    const meet = (val: number) => (target.includes('≤') || target.includes('<=') ? val <= num(target) : target.includes('≥') || target.includes('>=') ? val >= num(target) : val === num(target))
    if (k.auto_key === 'completion' || k.auto_key === 'overdue') {
      const v = k.auto_key === 'completion' ? s.done : s.overdue
      realisasi = pct(v)
      status = total ? (meet(num(realisasi)) ? 'Tercapai' : 'Belum tercapai') : null
    } else if (k.auto_key === 'no_pic' || k.auto_key === 'no_deadline') {
      const v = Number((k.auto_key === 'no_pic' ? s.no_pic : s.no_deadline) ?? 0)
      realisasi = String(v)
      status = meet(v) ? 'Tercapai' : 'Belum tercapai'
    }
    return { ...(k as Record<string, unknown>), realisasi, status, auto: !!k.auto_key } as Record<string, unknown> & { nama: string; definisi: string | null; target: string | null; realisasi: string | null; status: string | null; frekuensi: string | null; pic_text: string | null; catatan: string | null; auto: boolean }
  })
}

// ---------- Google Sheet ----------
export async function sheetUrl() {
  const [[row]] = await db.query<Row[]>('SELECT value FROM app_settings WHERE `key` = ?', [SETTING_URL])
  return (row?.value as string) || ''
}
export async function setSheetUrl(url: string, userId: number) {
  await db.query('INSERT INTO app_settings (`key`, value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)', [SETTING_URL, url.slice(0, 1000), userId])
}
export async function syncedAt() {
  const [[row]] = await db.query<Row[]>('SELECT value FROM app_settings WHERE `key` = ?', [SETTING_SYNC])
  return (row?.value as string) || null
}
async function markSynced(userId: number) {
  const now = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 19).replace('T', ' ')
  await db.query('INSERT INTO app_settings (`key`, value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)', [SETTING_SYNC, now, userId])
}

export const TAB = { program: 'Program Kerja', timeline: 'Timeline', progress: 'Progress Report', issue: 'Issue Log', kpi: 'KPI' } as const
const PROGRAM_HEAD = ['ID Program', 'Nama Program', 'Jenis Program', 'Divisi/Area', 'Tujuan', 'Target Angka', 'PIC Utama', 'Support', 'Start Date', 'End Date', 'Priority', 'Status', '% Progress', 'Catatan']
const PROGRESS_HEAD = ['Tanggal', 'ID Program', 'Nama Task/Update', 'Divisi', 'PIC', 'Status', 'Progress Sebelumnya', 'Progress Saat Ini', 'Kendala', 'Next Action', 'Deadline Next Action', 'Evidence Link']
const ISSUE_HEAD = ['Tanggal', 'ID Program', 'Issue/Kendala', 'Dampak', 'Severity', 'PIC Penyelesaian', 'Target Selesai', 'Status', 'Akar Masalah', 'Mitigasi / Solusi', 'Catatan']
const KPI_HEAD = ['KPI', 'Definisi', 'Target', 'Realisasi', 'Status', 'Frekuensi', 'PIC', 'Catatan']
const TIMELINE_FIRST = 4
const TIMELINE_LAST = 103

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9%]/g, '')
// Baris judul tabel (dicari di 10 baris pertama) & posisi kolom berdasarkan judul
function headerOf(rows: string[][], head: string[]) {
  const want = head.map(norm)
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const cells = rows[r].map((c) => norm(String(c ?? '')))
    const cols = want.map((w) => cells.indexOf(w))
    if (cols[0] >= 0 && cols.filter((c) => c >= 0).length >= Math.ceil(want.length / 2)) return { row: r, cols }
  }
  return null
}
const cell = (r: string[], c: number) => (c >= 0 ? String(r[c] ?? '').trim() : '')

// raw: nilai mentah (tanggal = angka seri, persen = pecahan) untuk kolom tanggal & progress; kolom teks memakai nilai tampil
export type SheetData = { programs: string[][]; progress: string[][]; issues: string[][]; kpis: string[][]; raw?: { programs: string[][]; progress: string[][]; issues: string[][] } }
type Parsed = {
  programs: (ProgramInput & { kode: string | null; row: number })[]
  progress: { tanggal: string; kode: string; task: string; divisi: string | null; pic_text: string | null; status: string | null; before: number | null; after: number | null; kendala: string | null; next_action: string | null; next_deadline: string | null; evidence: string | null }[]
  issues: { tanggal: string; kode: string | null; issue: string; dampak: string | null; severity: string | null; pic_text: string | null; target_date: string | null; status: string; akar: string | null; mitigasi: string | null; catatan: string | null; row: number }[]
  kpis: { nama: string; definisi: string | null; target: string | null; realisasi: string | null; status: string | null; frekuensi: string | null; pic_text: string | null; catatan: string | null }[]
}

export function parseSheetData(d: SheetData): Parsed {
  const out: Parsed = { programs: [], progress: [], issues: [], kpis: [] }
  const ph = headerOf(d.programs, PROGRAM_HEAD)
  if (!ph) fail(400, `Tab "${TAB.program}" tidak ditemukan atau judul kolomnya berbeda (harus ada "ID Program", "Nama Program", ...).`)
  for (let i = ph!.row + 1; i < d.programs.length; i++) {
    const r = d.programs[i]
    const c = (k: number) => cell(r, ph!.cols[k])
    const raw = (k: number) => cell(d.raw?.programs[i] ?? r, ph!.cols[k])
    if (!c(1)) continue
    const start = parseApDate(raw(8)) ?? parseApDate(c(8))
    const end = parseApDate(raw(9)) ?? parseApDate(c(9))
    out.programs.push({
      row: i + 1, kode: /^[A-Za-z]{2,5}-\d+$/.test(c(0)) ? c(0).toUpperCase() : null,
      nama: c(1).slice(0, 255), jenis: c(2) || null, divisi: c(3) || null, tujuan: c(4) || null, target: c(5).slice(0, 500) || null,
      pic_text: c(6).slice(0, 255) || null, support_text: c(7).slice(0, 255) || null,
      start_date: start, end_date: end, start_text: start ? null : c(8).slice(0, 60) || null, end_text: end ? null : c(9).slice(0, 60) || null,
      priority: pick(c(10), AP_PRIORITY), status: (pick(c(11), AP_STATUS) ?? 'Not Started') as ApStatus, progress: parseProgress(raw(12), true), catatan: c(13) || null,
    })
  }
  const gh = headerOf(d.progress, PROGRESS_HEAD)
  if (gh) for (let i = gh.row + 1; i < d.progress.length; i++) {
    const r = d.progress[i]
    const c = (k: number) => cell(r, gh.cols[k])
    const raw = (k: number) => cell(d.raw?.progress[i] ?? r, gh.cols[k])
    const tanggal = parseApDate(raw(0)) ?? parseApDate(c(0))
    if (!tanggal || !c(1) || !c(2)) continue
    out.progress.push({
      tanggal, kode: c(1).toUpperCase().slice(0, 20), task: c(2).slice(0, 500), divisi: c(3) || null, pic_text: c(4) || null, status: pick(c(5), AP_STATUS),
      before: parseProgress(raw(6), true), after: parseProgress(raw(7), true), kendala: c(8) || null, next_action: c(9) || null, next_deadline: parseApDate(raw(10)) ?? parseApDate(c(10)), evidence: c(11).slice(0, 1000) || null,
    })
  }
  const ih = headerOf(d.issues, ISSUE_HEAD)
  if (ih) for (let i = ih.row + 1; i < d.issues.length; i++) {
    const r = d.issues[i]
    const c = (k: number) => cell(r, ih.cols[k])
    const raw = (k: number) => cell(d.raw?.issues[i] ?? r, ih.cols[k])
    const tanggal = parseApDate(raw(0)) ?? parseApDate(c(0))
    if (!tanggal || !c(2)) continue
    out.issues.push({
      row: i + 1, tanggal, kode: c(1) ? c(1).toUpperCase().slice(0, 20) : null, issue: c(2), dampak: c(3) || null, severity: pick(c(4), AP_SEVERITY), pic_text: c(5).slice(0, 255) || null,
      target_date: parseApDate(raw(6)) ?? parseApDate(c(6)), status: pick(c(7), ISSUE_STATUS) ?? 'On Progress', akar: c(8) || null, mitigasi: c(9) || null, catatan: c(10) || null,
    })
  }
  const kh = headerOf(d.kpis, KPI_HEAD)
  if (kh) for (let i = kh.row + 1; i < d.kpis.length; i++) {
    const r = d.kpis[i]
    const c = (k: number) => cell(r, kh.cols[k])
    if (!c(0)) continue
    out.kpis.push({ nama: c(0).slice(0, 120), definisi: c(1).slice(0, 500) || null, target: c(2).slice(0, 60) || null, realisasi: c(3).slice(0, 60) || null, status: c(4).slice(0, 30) || null, frekuensi: c(5).slice(0, 30) || null, pic_text: c(6).slice(0, 120) || null, catatan: c(7).slice(0, 500) || null })
  }
  return out
}

// Simpan data sheet / Excel ke SIMPAP. Program dicocokkan lewat ID; progress & issue lewat (ID, tanggal, isi).
export async function importSheetData(data: Parsed, userId: number) {
  const res = { programBaru: 0, programUbah: 0, progress: 0, issueBaru: 0, issueUbah: 0, kpi: 0, tanpaId: 0 }
  for (const p of data.programs) {
    let kode = p.kode
    if (!kode) {
      kode = await nextKode()
      res.tanpaId++
    }
    const [[old]] = await db.query<Row[]>('SELECT id, status, progress FROM action_programs WHERE kode = ?', [kode])
    const progress = p.progress ?? (old ? Number(old.progress) : p.status === 'Done' ? 100 : 0)
    const fields = {
      nama: p.nama, jenis: p.jenis, divisi: p.divisi, tujuan: p.tujuan, target: p.target, pic_text: p.pic_text, support_text: p.support_text,
      start_date: p.start_date, end_date: p.end_date, start_text: p.start_text, end_text: p.end_text, priority: p.priority, status: p.status, progress, catatan: p.catatan, updated_by: userId,
    }
    if (old) {
      const cancelNow = p.status === 'Cancelled' && old.status !== 'Cancelled'
      const reactivate = p.status !== 'Cancelled' && old.status === 'Cancelled'
      await db.query(
        `UPDATE action_programs SET ?${cancelNow ? ', prev_status = status, cancelled_at = NOW(), cancelled_by = ?' : ''}${reactivate ? ', prev_status = NULL, cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL' : ''} WHERE id = ?`,
        cancelNow ? [fields, userId, old.id] : [fields, old.id],
      )
      res.programUbah++
    } else {
      const [ins] = await db.query<ResultSetHeader>('INSERT INTO action_programs SET ?', [{ ...fields, kode, created_by: userId }])
      if (p.status === 'Cancelled') await db.query('UPDATE action_programs SET cancelled_at = NOW(), cancelled_by = ? WHERE id = ?', [userId, ins.insertId])
      res.programBaru++
    }
  }
  const [ids] = await db.query<Row[]>('SELECT id, kode FROM action_programs')
  const idOf = new Map(ids.map((r) => [String(r.kode), Number(r.id)]))
  for (const g of data.progress) {
    const [[dup]] = await db.query<Row[]>('SELECT id FROM action_progress WHERE program_kode = ? AND tanggal = ? AND task = ? LIMIT 1', [g.kode, g.tanggal, g.task])
    if (dup) continue
    await db.query('INSERT INTO action_progress SET ?', [{
      program_id: idOf.get(g.kode) ?? null, program_kode: g.kode, tanggal: g.tanggal, task: g.task, divisi: g.divisi, pic_text: g.pic_text, status: g.status,
      progress_before: g.before, progress_after: g.after, kendala: g.kendala, next_action: g.next_action, next_deadline: g.next_deadline, evidence: g.evidence, jenis: 'sheet',
    }])
    res.progress++
  }
  for (const i of data.issues) {
    const [[old]] = await db.query<Row[]>('SELECT id FROM action_issues WHERE COALESCE(program_kode, \'\') = ? AND tanggal = ? AND LEFT(issue, 200) = LEFT(?, 200) LIMIT 1', [i.kode ?? '', i.tanggal, i.issue])
    const fields = {
      program_id: i.kode ? idOf.get(i.kode) ?? null : null, program_kode: i.kode, tanggal: i.tanggal, issue: i.issue, dampak: i.dampak, severity: i.severity, pic_text: i.pic_text,
      target_date: i.target_date, status: i.status, akar_masalah: i.akar, mitigasi: i.mitigasi, catatan: i.catatan, sheet_row: i.row, updated_by: userId,
    }
    if (old) { await db.query('UPDATE action_issues SET ? WHERE id = ?', [fields, old.id]); res.issueUbah++ }
    else { await db.query('INSERT INTO action_issues SET ?', [{ ...fields, created_by: userId }]); res.issueBaru++ }
  }
  for (const k of data.kpis) {
    const [[old]] = await db.query<Row[]>('SELECT id, auto_key FROM action_kpis WHERE nama = ?', [k.nama])
    const base = { definisi: k.definisi, target: k.target, frekuensi: k.frekuensi, pic_text: k.pic_text, catatan: k.catatan, updated_by: userId }
    if (old) await db.query('UPDATE action_kpis SET ? WHERE id = ?', [old.auto_key ? base : { ...base, realisasi: k.realisasi, status: k.status }, old.id])
    else {
      const [[mx]] = await db.query<Row[]>('SELECT COALESCE(MAX(urutan), 0) + 1 AS n FROM action_kpis')
      await db.query('INSERT INTO action_kpis SET ?', [{ ...base, nama: k.nama, realisasi: k.realisasi, status: k.status, urutan: mx.n }])
    }
    res.kpi++
  }
  return res
}

async function readAllTabs(sheet: Sheet): Promise<SheetData> {
  const has = (t: string) => sheet.tabs.some((x) => x.title === t)
  if (!has(TAB.program)) fail(400, `Tab "${TAB.program}" tidak ada di spreadsheet.`)
  const both = async (tab: string, range: string) => (has(tab) ? { text: await readTab(sheet, tab, range), raw: await readRaw(sheet, tab, range) } : { text: [], raw: [] })
  const programs = await both(TAB.program, 'A1:N1100')
  const progress = await both(TAB.progress, 'A1:L2000')
  const issues = await both(TAB.issue, 'A1:K2000')
  return {
    programs: programs.text, progress: progress.text, issues: issues.text,
    kpis: has(TAB.kpi) ? await readTab(sheet, TAB.kpi, 'A1:H60') : [],
    raw: { programs: programs.raw, progress: progress.raw, issues: issues.raw },
  }
}

// ---------- Tulis ke sheet ----------
const sheetIso = (d: unknown) => (d ? String(d).slice(0, 10) : '')
const programCells = (p: Row) => [
  p.kode, p.nama, p.jenis, p.divisi, p.tujuan, p.target, p.pic_text, p.support_text,
  sheetIso(p.start_date) || p.start_text, sheetIso(p.end_date) || p.end_text, p.priority, p.status, `${Number(p.progress ?? 0)}%`, p.catatan,
].map((v) => (v === null || v === undefined ? '' : String(v)))

// Baris kosong pertama tabel (kolom kunci kosong) mulai setelah baris judul
function firstEmptyRow(rows: string[][], headRow: number, keyCols: number[]) {
  for (let i = headRow + 1; i < rows.length; i++) if (keyCols.every((c) => !String(rows[i]?.[c] ?? '').trim())) return i + 1
  return Math.max(rows.length, headRow + 1) + 1
}

async function writeRow(sheet: Sheet, tab: string, row: number, cols: number[], values: string[]) {
  await writeCells(sheet, tab, values.map((value, k) => ({ row, col: cols[k], value })).filter((c) => c.col >= 0))
}

// Tulis program (cari baris berdasarkan ID; belum ada = baris kosong pertama) lalu perbarui tab Timeline
async function writePrograms(sheet: Sheet, programIds: number[] | 'all') {
  const rows = await readRaw(sheet, TAB.program, 'A1:N1100')
  const h = headerOf(rows, PROGRAM_HEAD)
  if (!h) throw new Error(`Judul kolom tab "${TAB.program}" tidak dikenali.`)
  const [programs] = await db.query<Row[]>(`SELECT * FROM action_programs${programIds === 'all' ? '' : ' WHERE id IN (?)'} ORDER BY kode`, programIds === 'all' ? [] : [programIds])
  const rowOf = new Map<string, number>()
  // Baris tanpa ID (ID baru diberikan SIMPAP saat sinkron): dicocokkan lewat nama program
  const noIdRow = new Map<string, number>()
  for (let i = h.row + 1; i < rows.length; i++) {
    const k = String(rows[i]?.[h.cols[0]] ?? '').trim().toUpperCase()
    const nama = String(rows[i]?.[h.cols[1]] ?? '').trim().toLowerCase()
    if (k) rowOf.set(k, i + 1)
    else if (nama && !noIdRow.has(nama)) noIdRow.set(nama, i + 1)
  }
  const cells: { row: number; col: number; value: string }[] = []
  for (const p of programs) {
    let r = rowOf.get(String(p.kode)) ?? noIdRow.get(String(p.nama).trim().toLowerCase())
    if (r) noIdRow.delete(String(p.nama).trim().toLowerCase())
    if (!r) {
      r = firstEmptyRow(rows, h.row, [h.cols[0], h.cols[1]])
      while (rows.length < r) rows.push([])
      rows[r - 1] = [String(p.kode), String(p.nama)]
      rowOf.set(String(p.kode), r)
    }
    programCells(p).forEach((value, k) => { if (h.cols[k] >= 0) cells.push({ row: r!, col: h.cols[k], value }) })
  }
  for (let i = 0; i < cells.length; i += 400) await writeCells(sheet, TAB.program, cells.slice(i, i + 400))
  await writeTimeline(sheet)
}

// Tab Timeline: kolom A-G (ID, Program, PIC, Start, End, Status, Progress) dari semua program; kolom minggu (rumus) dibiarkan
async function writeTimeline(sheet: Sheet) {
  if (!sheet.tabs.some((t) => t.title === TAB.timeline)) return
  const [programs] = await db.query<Row[]>(`SELECT * FROM action_programs ORDER BY (status = 'Cancelled'), kode LIMIT ${TIMELINE_LAST - TIMELINE_FIRST + 1}`)
  const rows = programs.map((p) => [String(p.kode), String(p.nama), String(p.pic_text ?? ''), sheetIso(p.start_date), sheetIso(p.end_date), String(p.status), `${Number(p.progress ?? 0)}%`])
  if (!rows.length) return
  await replaceBlock(sheet, TAB.timeline, TIMELINE_FIRST, rows, TIMELINE_LAST)
}

async function writeProgressRow(sheet: Sheet, entryId: number) {
  if (!sheet.tabs.some((t) => t.title === TAB.progress)) return
  const [[g]] = await db.query<Row[]>('SELECT * FROM action_progress WHERE id = ?', [entryId])
  if (!g) return
  const rows = await readRaw(sheet, TAB.progress, 'A1:L2000')
  const h = headerOf(rows, PROGRESS_HEAD)
  if (!h) throw new Error(`Judul kolom tab "${TAB.progress}" tidak dikenali.`)
  const r = firstEmptyRow(rows, h.row, [h.cols[0], h.cols[1], h.cols[2]])
  const pct = (v: unknown) => (v === null || v === undefined ? '' : `${Number(v)}%`)
  await writeRow(sheet, TAB.progress, r, h.cols, [sheetIso(g.tanggal), String(g.program_kode ?? ''), String(g.task), String(g.divisi ?? ''), String(g.pic_text ?? ''), String(g.status ?? ''),
    pct(g.progress_before), pct(g.progress_after), String(g.kendala ?? ''), String(g.next_action ?? ''), sheetIso(g.next_deadline), String(g.evidence ?? '')])
}

const issueCells = (i: Row) => [sheetIso(i.tanggal), String(i.program_kode ?? ''), String(i.issue), String(i.dampak ?? ''), String(i.severity ?? ''), String(i.pic_text ?? ''),
  sheetIso(i.target_date), String(i.status ?? ''), String(i.akar_masalah ?? ''), String(i.mitigasi ?? ''), String(i.catatan ?? '')]

// Issue: baris tersimpan (sheet_row) dipakai bila isinya masih cocok; selain itu dicari ulang / baris kosong pertama.
// remove = kosongkan baris (baris tidak dihapus agar validasi & format tabel tetap)
async function writeIssueRow(sheet: Sheet, issue: Row, match: { tanggal: unknown; kode: unknown; issue: unknown } | null, remove = false) {
  if (!sheet.tabs.some((t) => t.title === TAB.issue)) return null
  const rows = await readRaw(sheet, TAB.issue, 'A1:K2000')
  const h = headerOf(rows, ISSUE_HEAD)
  if (!h) throw new Error(`Judul kolom tab "${TAB.issue}" tidak dikenali.`)
  const same = (i: number) => {
    const r = rows[i - 1] ?? []
    return !!match && parseApDate(r[h.cols[0]]) === sheetIso(match.tanggal) && String(r[h.cols[1]] ?? '').trim().toUpperCase() === String(match.kode ?? '').toUpperCase()
      && String(r[h.cols[2]] ?? '').trim().slice(0, 200) === String(match.issue ?? '').trim().slice(0, 200)
  }
  let row: number | null = null
  if (match) {
    const saved = Number(issue.sheet_row ?? 0)
    if (saved && same(saved)) row = saved
    else for (let i = h.row + 2; i <= rows.length && !row; i++) if (same(i)) row = i
  }
  if (remove) {
    if (row) await writeRow(sheet, TAB.issue, row, h.cols, issueCells(issue).map(() => ''))
    return row
  }
  row ??= firstEmptyRow(rows, h.row, [h.cols[0], h.cols[2]])
  await writeRow(sheet, TAB.issue, row, h.cols, issueCells(issue))
  return row
}

async function writeKpis(sheet: Sheet) {
  if (!sheet.tabs.some((t) => t.title === TAB.kpi)) return
  const rows = await readRaw(sheet, TAB.kpi, 'A1:H60')
  const h = headerOf(rows, KPI_HEAD)
  if (!h) return
  const rowOf = new Map<string, number>()
  for (let i = h.row + 1; i < rows.length; i++) { const k = String(rows[i]?.[h.cols[0]] ?? '').trim(); if (k) rowOf.set(k.toLowerCase(), i + 1) }
  const cells: { row: number; col: number; value: string }[] = []
  for (const k of await computeKpis()) {
    let r = rowOf.get(String(k.nama).toLowerCase())
    if (!r) { r = firstEmptyRow(rows, h.row, [h.cols[0]]); while (rows.length < r) rows.push([]); rows[r - 1] = [String(k.nama)]; rowOf.set(String(k.nama).toLowerCase(), r) }
    const vals = [k.nama, k.definisi, k.target, k.realisasi, k.status, k.frekuensi, k.pic_text, k.catatan].map((v) => (v === null || v === undefined ? '' : String(v)))
    vals.forEach((value, c) => { if (h.cols[c] >= 0) cells.push({ row: r!, col: h.cols[c], value }) })
  }
  if (cells.length) await writeCells(sheet, TAB.kpi, cells)
}

// Penulisan ke sheet setelah data SIMPAP tersimpan. Hasil: null (berhasil / belum ada link) atau pesan peringatan.
export async function pushToSheet(label: string, job: (sheet: Sheet) => Promise<unknown>) {
  const url = await sheetUrl()
  if (!url) return null
  // Google Sheet atau file Excel (.xlsx) di Drive
  return trySheet(label, () => withWorkbook(url, true, job))
}
export const pushPrograms = (ids: number[] | 'all') => pushToSheet('Program Kerja', async (s) => { await writePrograms(s, ids); await writeKpis(s) })
export const pushProgress = (entryId: number, programId: number) => pushToSheet('Progress Report', async (s) => { await writeProgressRow(s, entryId); await writePrograms(s, [programId]); await writeKpis(s) })
export const pushKpis = () => pushToSheet('KPI', (s) => writeKpis(s))
export async function pushIssue(issueId: number, match: { tanggal: unknown; kode: unknown; issue: unknown } | null) {
  return pushToSheet('Issue Log', async (s) => {
    const [[i]] = await db.query<Row[]>('SELECT * FROM action_issues WHERE id = ?', [issueId])
    if (!i) return
    const row = await writeIssueRow(s, i, match)
    if (row && row !== Number(i.sheet_row)) await db.query('UPDATE action_issues SET sheet_row = ? WHERE id = ?', [row, issueId])
  })
}
export const removeIssueFromSheet = (issue: Row) => pushToSheet('Issue Log', (s) => writeIssueRow(s, issue, { tanggal: issue.tanggal, kode: issue.program_kode, issue: issue.issue }, true))
export async function removeProgramFromSheet(kode: string) {
  return pushToSheet('Program Kerja', async (s) => {
    const rows = await readRaw(s, TAB.program, 'A1:N1100')
    const h = headerOf(rows, PROGRAM_HEAD)
    if (!h) return
    for (let i = h.row + 1; i < rows.length; i++) {
      if (String(rows[i]?.[h.cols[0]] ?? '').trim().toUpperCase() === kode) await writeRow(s, TAB.program, i + 1, h.cols, PROGRAM_HEAD.map(() => ''))
    }
    await writeTimeline(s)
    await writeKpis(s)
  })
}

// Sinkron penuh: tarik semua tab dari sheet ke SIMPAP, lalu tulis balik semua program (ID baru, program yang belum ada
// di sheet), Timeline, dan KPI. Gagal membaca sheet = error (tidak ada yang berubah).
export async function syncFromSheet(userId: number) {
  const url = await sheetUrl()
  if (!url) fail(400, 'Link Google Sheet Action Plan belum diatur.')
  // Google Sheet atau file Excel (.xlsx) di Drive. Kegagalan membuka / membaca = 400 dengan alasannya (bukan error server)
  let wb: Awaited<ReturnType<typeof openWorkbook>> | null = null
  let ok = false
  try {
    wb = await openWorkbook(url!)
    const sheet = wb.sheet
    const parsed = parseSheetData(await readAllTabs(sheet))
    const res = await importSheetData(parsed, userId)
    // Baris program tanpa ID di sheet: diisi ID baru lewat penulisan ulang semua program (file .xlsm hanya dibaca)
    const warning = wb.readonly ? READONLY_EXCEL : await trySheet('tab Program Kerja / Timeline / KPI', async () => { await writePrograms(sheet, 'all'); await writeKpis(sheet) })
    await markSynced(userId)
    ok = true
    return { ...res, warning, excel: wb.excel }
  } catch (error) {
    if (error instanceof SheetWriteError) fail(400, error.message)
    throw error
  } finally {
    // File Excel .xlsx: hasil penulisan disimpan kembali ke file aslinya
    if (wb) await wb.finish(ok).catch((e) => console.error('[action-plan] simpan file Excel:', (e as Error).message))
  }
}

