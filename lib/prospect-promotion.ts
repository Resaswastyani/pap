// Prospek -> Customer otomatis berdasarkan faktur penjualan Accurate (dipanggil setiap sinkron Accurate).
//   1. Prospek aktif yang belum terhubung ke customer dicocokkan ke customer Accurate: nama sama persis (setelah
//      dinormalkan) atau nomor HP sama (9 digit terakhir). Hanya bila cocok ke tepat satu customer.
//   2. Prospek yang customer-nya sudah ORDER >= 2 kali (faktur penjualan) otomatis pindah ke Customer: status
//      "Handover" (keluar dari daftar prospek aktif), dicatat di riwayat, dan sales diberi notifikasi.
//      Baru 1 kali order -> status naik ke "Order pertama" (bila masih di tahap sebelumnya).
import type { RowDataPacket } from 'mysql2'
import { db } from '@/lib/db'
import { logActivity, PIPELINE, type ProspectStatus } from '@/lib/marketing'
import { notify } from '@/lib/notifications'
import { pushToUsers } from '@/lib/push'
import { attachRequestsToCustomer } from '@/lib/requests'

export const ORDER_TO_CUSTOMER = 2

type Row = RowDataPacket & Record<string, unknown>

// Nama: huruf kecil, tanpa tanda baca & sebutan badan usaha / sapaan
const SAPAAN = /\b(pt|cv|ud|tb|toko|pd|koperasi|bp|bpk|bapak|pak|ibu|bu|kak|mas|mbak|mba|sdr|h|hj)\b/g
const normName = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(SAPAAN, ' ').replace(/\s+/g, ' ').trim()
const normPhone = (v: unknown) => { const d = String(v ?? '').replace(/\D+/g, ''); return d.length >= 9 ? d.slice(-9) : '' }

async function linkProspectsToCustomers() {
  const [prospects] = await db.query<Row[]>("SELECT id, nama_usaha, telepon FROM prospects WHERE customer_id IS NULL AND status NOT IN ('handover', 'gagal')")
  if (!prospects.length) return 0
  const [customers] = await db.query<Row[]>('SELECT id, name, mobile_phone, work_phone FROM customers')
  const byName = new Map<string, number[]>()
  const byPhone = new Map<string, number[]>()
  const add = (map: Map<string, number[]>, key: string, id: number) => { if (key) map.set(key, [...new Set([...(map.get(key) ?? []), id])]) }
  for (const c of customers) {
    const n = normName(c.name)
    if (n.length >= 6) add(byName, n, Number(c.id))
    add(byPhone, normPhone(c.mobile_phone), Number(c.id))
    add(byPhone, normPhone(c.work_phone), Number(c.id))
  }
  let linked = 0
  for (const p of prospects) {
    const n = normName(p.nama_usaha)
    const ids = [...new Set([...(n.length >= 6 ? byName.get(n) ?? [] : []), ...(byPhone.get(normPhone(p.telepon)) ?? [])])]
    if (ids.length !== 1) continue // tidak ketemu / ragu-ragu: biarkan dihubungkan manual
    await db.query('UPDATE prospects SET customer_id = ? WHERE id = ? AND customer_id IS NULL', [ids[0], p.id])
    await attachRequestsToCustomer(Number(p.id), ids[0])
    linked++
  }
  return linked
}

export async function promoteOrderedProspects() {
  const linked = await linkProspectsToCustomers()
  const [rows] = await db.query<Row[]>(
    `SELECT p.id, p.nama_usaha, p.status, p.customer_id, p.assigned_to, p.created_by, p.maintenance_to, c.name AS customer_name, c.customer_no,
       (SELECT COUNT(*) FROM accurate_sales_invoices i WHERE i.customer_accurate_id = c.accurate_id) AS orders
     FROM prospects p JOIN customers c ON c.id = p.customer_id
     WHERE p.status NOT IN ('handover', 'gagal') AND c.accurate_id IS NOT NULL`,
  )
  let pindah = 0
  let orderPertama = 0
  const created: number[] = []
  for (const p of rows) {
    const orders = Number(p.orders) || 0
    const from = String(p.status) as ProspectStatus
    const to: ProspectStatus | null = orders >= ORDER_TO_CUSTOMER ? 'handover'
      : orders === 1 && PIPELINE.indexOf(from) < PIPELINE.indexOf('order_pertama') ? 'order_pertama' : null
    if (!to) continue
    const res = await db.query<import('mysql2').ResultSetHeader>("UPDATE prospects SET status = ? WHERE id = ? AND status NOT IN ('handover', 'gagal')", [to, p.id])
    if (!res[0].affectedRows) continue
    const actor = Number(p.assigned_to ?? p.created_by)
    const ket = to === 'handover'
      ? `Otomatis pindah ke Customer: ${p.customer_name}${p.customer_no ? ` (${p.customer_no})` : ''} sudah order ${orders}× di Accurate`
      : `Otomatis: order pertama tercatat di Accurate (${p.customer_name})`
    await logActivity(db, { prospectId: Number(p.id), customerId: Number(p.customer_id), userId: actor, jenis: 'status', hasil: ket, statusFrom: from, statusTo: to })
    if (to === 'handover') pindah++
    else orderPertama++
    // Sales prospek (+ Marketing Maintenance bila sudah ditunjuk) diberi tahu
    const [sales] = await db.query<Row[]>('SELECT user_id FROM prospect_sales WHERE prospect_id = ?', [p.id])
    const users = [...new Set([...sales.map((s) => Number(s.user_id)), p.assigned_to, p.maintenance_to].filter((x): x is number => !!x).map(Number))]
    if (users.length) {
      created.push(...(await notify(users, {
        type: 'prospek_baru',
        title: to === 'handover' ? `Prospek ${p.nama_usaha} otomatis pindah ke Customer` : `Prospek ${p.nama_usaha}: order pertama`,
        body: to === 'handover' ? `Sudah order ${orders} kali di Accurate${p.customer_no ? ` · ${p.customer_no}` : ''}` : `Faktur pertama tercatat di Accurate${p.customer_no ? ` · ${p.customer_no}` : ''}`,
        prospectId: Number(p.id),
        refKey: `prospek-auto:${p.id}:${to}`,
      })))
    }
  }
  if (created.length) await pushToUsers(created)
  return { terhubung: linked, pindah, orderPertama }
}

// Pemicu kedua (selain sinkron Accurate): saat daftar prospek dibuka, paling sering sekali per 10 menit
let lastRun = 0
export async function promoteIfStale() {
  if (Date.now() - lastRun < 10 * 60_000) return null
  lastRun = Date.now()
  try {
    return await promoteOrderedProspects()
  } catch (error) {
    console.error('[prospek -> customer]', error)
    return null
  }
}
