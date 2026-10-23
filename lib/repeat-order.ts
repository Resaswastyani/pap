import type { RowDataPacket } from 'mysql2'
import { fail } from '@/lib/api'
import { CRM_INACTIVE_DAYS } from '@/lib/customers'
import { db } from '@/lib/db'
import { canSupervise } from '@/lib/marketing'
import type { UserProfile } from '@/lib/users'

// Pemantauan repeat order: interval order tiap customer dihitung dari faktur penjualan Accurate.
//   interval   = rata-rata jarak antar faktur (customer 1 kali order: DEFAULT_INTERVAL hari)
//   perkiraan  = faktur terakhir + interval
//   status     = aman | waktunya (H-3 s/d lewat) | berisiko (lewat > 50% interval) | nonaktif (> CRM_INACTIVE_DAYS hari)
export const DEFAULT_INTERVAL = 30
export const REPEAT_STATUS = { waktunya: 'Waktunya order', berisiko: 'Berisiko berhenti', nonaktif: 'Nonaktif', aman: 'Aman' } as const
export type RepeatStatus = keyof typeof REPEAT_STATUS

export function requireRepeatOrder(user: UserProfile) {
  if (!user.menus.includes('repeat-order')) fail(403, 'Anda tidak punya akses ke menu Repeat Order.')
}

// Staff hanya customer yang dipegangnya; Lead/GM/admin semua
export const seesAllCustomers = (user: UserProfile) => canSupervise(user)

export const REPEAT_BASE = `
  SELECT c.id, c.accurate_id, c.customer_no, c.name, c.mobile_phone, c.work_phone, c.bill_city, c.maintenance_to, c.next_followup_at, c.last_contact_at,
    um.name AS maintenance_name, s.order_count, s.first_order, s.last_order, s.total_amount,
    s.interval_hari, DATEDIFF(CURDATE(), s.last_order) AS hari_sejak,
    DATE_ADD(s.last_order, INTERVAL s.interval_hari DAY) AS perkiraan_order,
    DATEDIFF(CURDATE(), s.last_order) - s.interval_hari AS hari_terlambat,
    CASE
      WHEN DATEDIFF(CURDATE(), s.last_order) > ${CRM_INACTIVE_DAYS} THEN 'nonaktif'
      WHEN DATEDIFF(CURDATE(), s.last_order) - s.interval_hari > s.interval_hari * 0.5 THEN 'berisiko'
      WHEN DATEDIFF(CURDATE(), s.last_order) - s.interval_hari >= -3 THEN 'waktunya'
      ELSE 'aman' END AS status,
    (SELECT a.created_at FROM marketing_activities a WHERE a.customer_id = c.id ORDER BY a.id DESC LIMIT 1) AS last_activity_at,
    -- Follow-up terakhir dari semua sumber: log follow-up (customer / prospek asalnya), visit selesai, quotation terkirim
    (SELECT CONCAT(a.created_at, '|', a.jenis) FROM marketing_activities a
       WHERE a.customer_id = c.id OR a.prospect_id IN (SELECT p.id FROM prospects p WHERE p.customer_id = c.id) ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS fu_activity,
    (SELECT MAX(COALESCE(v.checkin_at, v.jadwal)) FROM visits v
       WHERE v.status IN ('selesai', 'tidak_bertemu') AND (v.customer_id = c.id OR v.prospect_id IN (SELECT p.id FROM prospects p WHERE p.customer_id = c.id))) AS fu_visit,
    (SELECT MAX(q.sent_at) FROM quotations q WHERE q.customer_id = c.id AND q.sent_at IS NOT NULL) AS fu_quotation
  FROM customers c
  JOIN (
    SELECT customer_accurate_id, COUNT(*) AS order_count, MIN(trans_date) AS first_order, MAX(trans_date) AS last_order, SUM(total_amount) AS total_amount,
      IF(COUNT(*) > 1, GREATEST(7, ROUND(DATEDIFF(MAX(trans_date), MIN(trans_date)) / (COUNT(*) - 1))), ${DEFAULT_INTERVAL}) AS interval_hari
    FROM accurate_sales_invoices WHERE trans_date IS NOT NULL GROUP BY customer_accurate_id
  ) s ON s.customer_accurate_id = c.accurate_id
  LEFT JOIN users um ON um.id = c.maintenance_to`

// Follow-up terakhir: yang paling baru dari catatan Repeat Order, log follow-up, visit, dan quotation
const FU_LABEL: Record<string, string> = { whatsapp: 'WhatsApp', telepon: 'Telepon', email: 'Email', visit: 'Visit', meeting: 'Meeting', catatan: 'Catatan', quotation: 'Quotation' }
function lastFollowup(r: RowDataPacket) {
  const [actAt, actJenis] = String(r.fu_activity ?? '').split('|')
  const candidates: [string | null, string][] = [
    // Log aktivitas didahulukan: catatan Repeat Order juga membuat log dengan waktu yang sama (jenisnya lebih jelas)
    [actAt || null, FU_LABEL[actJenis] ?? 'Follow-up'], [r.last_contact_at ?? null, 'Follow-up'], [r.fu_visit ?? null, 'Visit'], [r.fu_quotation ?? null, 'Quotation'],
  ]
  const best = candidates.filter(([at]) => !!at).sort((a, b) => String(b[0]).localeCompare(String(a[0])))[0]
  return best ? { at: String(best[0]), via: best[1] } : null
}

export const serializeRepeat = (r: RowDataPacket): RowDataPacket => {
  const fu = lastFollowup(r)
  const { fu_activity: _a, fu_visit: _v, fu_quotation: _q, ...rest } = r
  return {
    ...rest,
    order_count: Number(r.order_count), total_amount: Number(r.total_amount ?? 0), interval_hari: Number(r.interval_hari),
    hari_sejak: Number(r.hari_sejak), hari_terlambat: Number(r.hari_terlambat),
    last_followup_at: fu?.at ?? null, last_followup_via: fu?.via ?? null,
  } as RowDataPacket
}

export async function loadRepeatCustomer(id: number, user: UserProfile) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT * FROM (${REPEAT_BASE}) x WHERE x.id = ? ${seesAllCustomers(user) ? '' : 'AND x.maintenance_to = ?'}`,
    seesAllCustomers(user) ? [id] : [id, user.id],
  )
  return serializeRepeat(rows[0] ?? fail(404, 'Customer tidak ditemukan atau bukan pegangan Anda.'))
}
