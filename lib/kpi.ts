import type { RowDataPacket } from 'mysql2'
import { fail, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canSupervise, MARKETING_DIVISIONS } from '@/lib/marketing'
import type { UserProfile } from '@/lib/users'

// KPI marketing per sales per bulan, dihitung dari aktivitas yang tercatat di PAP-MS
export const KPI_METRICS = {
  leads: { label: 'Lead baru', hint: 'Prospek yang dibuat / diimpor', satuan: '' },
  followup: { label: 'Follow-up prospek', hint: 'WA, telepon, email, meeting ke prospek', satuan: '' },
  visit: { label: 'Visit selesai', hint: 'Check-in visit (ikut sebagai sales)', satuan: '' },
  penawaran: { label: 'Penawaran dikirim', hint: 'Quotation ditandai terkirim', satuan: '' },
  closing: { label: 'Closing', hint: 'Prospek pegangan yang mencapai order pertama', satuan: '' },
  nilai: { label: 'Nilai deal', hint: 'Total quotation diterima', satuan: 'Rp' },
  repeat: { label: 'Follow-up customer', hint: 'Follow-up repeat order ke customer', satuan: '' },
} as const
export type KpiMetric = keyof typeof KPI_METRICS
export const KPI_KEYS = Object.keys(KPI_METRICS) as KpiMetric[]

export function requireKpi(user: UserProfile) {
  if (!user.menus.includes('kpi')) fail(403, 'Anda tidak punya akses ke KPI Marketing.')
}
// Lead/GM/admin melihat & mengatur target semua sales; staff hanya miliknya
export const seesAllKpi = (user: UserProfile) => canSupervise(user)

export function readPeriode(value: unknown) {
  const p = str(value, 7)
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(p)) return p
  const d = new Date(Date.now() + 7 * 3600e3)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
export const previousPeriode = (p: string) => {
  const [y, m] = p.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}
const range = (p: string) => [`${p}-01`, `${p}-01`] // dipakai sebagai [awal, awal] + INTERVAL 1 MONTH di SQL

export async function kpiUsers(user: UserProfile) {
  const [rows] = await db.query<(RowDataPacket & { id: number; name: string; division_code: string; division_name: string })[]>(
    `SELECT u.id, u.name, d.code AS division_code, d.name AS division_name FROM users u JOIN divisions d ON d.id = u.division_id
     WHERE u.is_active = 1 AND d.code IN (?) ${seesAllKpi(user) ? '' : 'AND u.id = ?'} ORDER BY d.sort_order, u.name`,
    seesAllKpi(user) ? [[...MARKETING_DIVISIONS]] : [[...MARKETING_DIVISIONS], user.id],
  )
  // User di luar divisi marketing (mis. admin) tetap bisa melihat KPI dirinya bila punya menu
  if (!rows.length && !seesAllKpi(user)) return [{ id: user.id, name: user.name, division_code: user.division.code, division_name: user.division.name }]
  return rows
}

// Nilai semua metrik untuk daftar user dalam satu periode: { userId: { metric: nilai } }
export async function computeKpi(userIds: number[], periode: string) {
  const result = new Map<number, Record<KpiMetric, number>>()
  for (const id of userIds) result.set(id, Object.fromEntries(KPI_KEYS.map((k) => [k, 0])) as Record<KpiMetric, number>)
  if (!userIds.length) return result
  const [start] = range(periode)
  const inPeriod = (col: string) => `${col} >= ? AND ${col} < ? + INTERVAL 1 MONTH`
  const queries: [KpiMetric, string][] = [
    ['leads', `SELECT created_by AS uid, COUNT(*) AS v FROM prospects WHERE created_by IN (?) AND ${inPeriod('created_at')} GROUP BY created_by`],
    ['followup', `SELECT user_id AS uid, COUNT(*) AS v FROM marketing_activities WHERE user_id IN (?) AND prospect_id IS NOT NULL
      AND jenis IN ('whatsapp', 'telepon', 'email', 'meeting') AND ${inPeriod('created_at')} GROUP BY user_id`],
    ['visit', `SELECT vs.user_id AS uid, COUNT(DISTINCT v.id) AS v FROM visits v JOIN visit_sales vs ON vs.visit_id = v.id
      WHERE vs.user_id IN (?) AND v.status = 'selesai' AND ${inPeriod('v.checkin_at')} GROUP BY vs.user_id`],
    ['penawaran', `SELECT created_by AS uid, COUNT(*) AS v FROM quotations WHERE created_by IN (?) AND ${inPeriod('sent_at')} GROUP BY created_by`],
    ['closing', `SELECT COALESCE(p.assigned_to, a.user_id) AS uid, COUNT(DISTINCT a.prospect_id) AS v FROM marketing_activities a JOIN prospects p ON p.id = a.prospect_id
      WHERE a.status_to = 'order_pertama' AND COALESCE(p.assigned_to, a.user_id) IN (?) AND ${inPeriod('a.created_at')} GROUP BY uid`],
    ['nilai', `SELECT created_by AS uid, SUM(total) AS v FROM quotations WHERE created_by IN (?) AND status = 'diterima' AND ${inPeriod('closed_at')} GROUP BY created_by`],
    ['repeat', `SELECT user_id AS uid, COUNT(*) AS v FROM marketing_activities WHERE user_id IN (?) AND customer_id IS NOT NULL AND prospect_id IS NULL
      AND jenis IN ('whatsapp', 'telepon', 'email', 'meeting', 'visit') AND ${inPeriod('created_at')} GROUP BY user_id`],
  ]
  await Promise.all(queries.map(async ([metric, sql]) => {
    const [rows] = await db.query<(RowDataPacket & { uid: number; v: string | number })[]>(sql, [userIds, start, start])
    for (const r of rows) {
      const entry = result.get(Number(r.uid))
      if (entry) entry[metric] = Number(r.v ?? 0)
    }
  }))
  return result
}

export async function loadTargets(userIds: number[], periode: string) {
  const targets = new Map<number, Partial<Record<KpiMetric, number>>>()
  if (!userIds.length) return targets
  const [rows] = await db.query<(RowDataPacket & { user_id: number; metric: KpiMetric; target: string })[]>(
    'SELECT user_id, metric, target FROM kpi_targets WHERE periode = ? AND user_id IN (?)',
    [periode, userIds],
  )
  for (const r of rows) {
    const t = targets.get(r.user_id) ?? {}
    t[r.metric] = Number(r.target)
    targets.set(r.user_id, t)
  }
  return targets
}
