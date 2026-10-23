// Order Bulanan: siapa saja customer yang order (Sales Order Accurate) dalam satu bulan, order baru vs repeat,
// nilai & barang yang dipesan, serta customer yang bulan lalu order tetapi bulan ini belum (perlu follow up).
import type { RowDataPacket } from 'mysql2'
import { CRM_CASE } from '@/lib/customers'
import { db } from '@/lib/db'
import { writeXlsx, type XlsxCell } from '@/lib/xlsx-write'

type Row = RowDataPacket & Record<string, unknown>
const n = (v: unknown) => Number(v ?? 0)
export const isPeriode = (v: string | null | undefined): v is string => !!v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v)
const shift = (p: string, d: number) => new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)) - 1 + d, 1)).toISOString().slice(0, 7)
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
export const periodeLabel = (p: string) => `${BULAN[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`

// Status CRM per customer (dari faktur penjualan, sama dengan menu Customer)
const CRM_JOIN = `LEFT JOIN (
    SELECT customer_accurate_id, COUNT(*) AS order_count, MAX(trans_date) AS last_order FROM accurate_sales_invoices GROUP BY customer_accurate_id
  ) s ON s.customer_accurate_id = c.accurate_id`

export async function monthlyOrders(periode: string) {
  const prev = shift(periode, -1)
  const [orders] = await db.query<Row[]>(
    `SELECT so.accurate_id AS id, so.number, DATE_FORMAT(so.trans_date, '%Y-%m-%d') AS tanggal, so.total_amount, so.status, so.customer_accurate_id
     FROM accurate_sales_orders so
     WHERE so.trans_date >= CONCAT(?, '-01') AND so.trans_date < CONCAT(?, '-01') + INTERVAL 1 MONTH
     ORDER BY so.trans_date DESC, so.accurate_id DESC`,
    [periode, periode],
  )
  const ids = orders.map((o) => o.id)
  const [lines] = ids.length
    ? await db.query<Row[]>('SELECT so_accurate_id, item_name, quantity, unit, unit_price FROM accurate_sales_order_items WHERE so_accurate_id IN (?) ORDER BY so_accurate_id, line_id', [ids])
    : [[] as Row[]]
  const custIds = [...new Set(orders.map((o) => n(o.customer_accurate_id)).filter(Boolean))]
  // Customer, status CRM, dan apakah pernah order (SO) sebelum bulan ini
  const [customers] = custIds.length
    ? await db.query<Row[]>(
      `SELECT c.id, c.accurate_id, c.customer_no, c.name, c.category, c.mobile_phone, c.work_phone, ${CRM_CASE} AS crm_status,
         (SELECT MIN(o2.trans_date) FROM accurate_sales_orders o2 WHERE o2.customer_accurate_id = c.accurate_id) AS first_so,
         (SELECT COUNT(*) FROM accurate_sales_orders o3 WHERE o3.customer_accurate_id = c.accurate_id AND o3.trans_date < CONCAT(?, '-01')) AS so_sebelumnya
       FROM customers c ${CRM_JOIN} WHERE c.accurate_id IN (?)`,
      [periode, custIds],
    )
    : [[] as Row[]]
  const custBy = new Map(customers.map((c) => [n(c.accurate_id), c]))
  const groups = new Map<number, { orders: Row[] }>()
  for (const o of orders) {
    const k = n(o.customer_accurate_id)
    if (!groups.has(k)) groups.set(k, { orders: [] })
    groups.get(k)!.orders.push(o)
  }
  const list = [...groups.entries()].map(([accId, g]) => {
    const c = custBy.get(accId)
    const nilai = g.orders.reduce((t, o) => t + n(o.total_amount), 0)
    return {
      customer_id: c ? n(c.id) : null, accurate_id: accId, name: String(c?.name ?? `Customer #${accId}`), customer_no: (c?.customer_no as string) ?? null,
      category: (c?.category as string) ?? null, phone: (c?.mobile_phone as string) ?? (c?.work_phone as string) ?? null, crm_status: (c?.crm_status as string) ?? null,
      baru: n(c?.so_sebelumnya) === 0, so_count: g.orders.length, nilai, terakhir: String(g.orders[0].tanggal), pertama: String(g.orders.at(-1)!.tanggal),
      orders: g.orders.map((o) => ({
        id: n(o.id), number: String(o.number ?? ''), tanggal: String(o.tanggal), total: n(o.total_amount), status: (o.status as string) ?? null,
        items: lines.filter((l) => n(l.so_accurate_id) === n(o.id)).map((l) => ({ nama: String(l.item_name ?? ''), qty: n(l.quantity), unit: (l.unit as string) ?? null, harga: n(l.unit_price) })),
      })),
    }
  }).sort((a, b) => b.terakhir.localeCompare(a.terakhir) || b.nilai - a.nilai)

  // Bulan lalu order, bulan ini belum
  const [belum] = await db.query<Row[]>(
    `SELECT c.id AS customer_id, c.name, c.customer_no, c.mobile_phone, c.work_phone, COUNT(*) AS so_count, SUM(so.total_amount) AS nilai,
       DATE_FORMAT(MAX(so.trans_date), '%Y-%m-%d') AS terakhir
     FROM accurate_sales_orders so JOIN customers c ON c.accurate_id = so.customer_accurate_id
     WHERE so.trans_date >= CONCAT(?, '-01') AND so.trans_date < CONCAT(?, '-01') + INTERVAL 1 MONTH
       AND so.customer_accurate_id NOT IN (SELECT customer_accurate_id FROM accurate_sales_orders
         WHERE trans_date >= CONCAT(?, '-01') AND trans_date < CONCAT(?, '-01') + INTERVAL 1 MONTH AND customer_accurate_id IS NOT NULL)
     GROUP BY c.id ORDER BY nilai DESC`,
    [prev, prev, periode, periode],
  )
  const [[prevStat]] = await db.query<Row[]>(
    `SELECT COUNT(*) AS so, COUNT(DISTINCT customer_accurate_id) AS customer, COALESCE(SUM(total_amount), 0) AS nilai FROM accurate_sales_orders
     WHERE trans_date >= CONCAT(?, '-01') AND trans_date < CONCAT(?, '-01') + INTERVAL 1 MONTH`,
    [prev, prev],
  )
  const [months] = await db.query<Row[]>("SELECT DISTINCT DATE_FORMAT(trans_date, '%Y-%m') AS p FROM accurate_sales_orders WHERE trans_date IS NOT NULL ORDER BY p DESC LIMIT 36")
  return {
    periode, prev,
    customers: list,
    belum: belum.map((b) => ({ customer_id: n(b.customer_id), name: String(b.name), customer_no: (b.customer_no as string) ?? null, phone: (b.mobile_phone as string) ?? (b.work_phone as string) ?? null, so_count: n(b.so_count), nilai: n(b.nilai), terakhir: String(b.terakhir) })),
    stats: {
      customer: list.length, so: orders.length, nilai: list.reduce((t, c) => t + c.nilai, 0), baru: list.filter((c) => c.baru).length, repeat: list.filter((c) => !c.baru).length,
      prev: { customer: n(prevStat.customer), so: n(prevStat.so), nilai: n(prevStat.nilai) }, belum: belum.length,
    },
    months: months.map((m) => String(m.p)),
  }
}

export async function monthlyOrdersXlsx(periode: string) {
  const d = await monthlyOrders(periode)
  const head = (v: string) => ({ v, s: 'head' as const })
  const t = (v: string | null) => ({ v, s: 'cell' as const })
  const num = (v: number) => ({ v: Math.round(v), s: 'num' as const })
  const rekap: XlsxCell[][] = [
    [{ v: `ORDER CUSTOMER BULAN ${periodeLabel(periode).toUpperCase()}`, s: 'title' }],
    [{ v: `${d.stats.customer} customer · ${d.stats.so} SO · baru ${d.stats.baru}, repeat ${d.stats.repeat}. Sumber: Sales Order Accurate.`, s: 'note' }],
    ['No', 'No. customer', 'Customer', 'Kategori', 'Telepon', 'Jenis', 'Jumlah SO', 'Nilai SO', 'Order pertama bulan ini', 'Order terakhir', 'Nomor SO'].map(head),
    ...d.customers.map((c, i) => [
      { v: i + 1, s: 'center' as const }, t(c.customer_no), t(c.name), t(c.category), t(c.phone), t(c.baru ? 'Customer baru' : 'Repeat order'),
      num(c.so_count), num(c.nilai), { v: c.pertama, s: 'center' as const }, { v: c.terakhir, s: 'center' as const }, t(c.orders.map((o) => o.number).join(', ')),
    ]),
    [{ v: 'TOTAL', s: 'total' }, ...Array(5).fill({ v: null, s: 'total' }), { v: d.stats.so, s: 'total' as const }, { v: Math.round(d.stats.nilai), s: 'total' as const }],
  ]
  const detail: XlsxCell[][] = [
    [{ v: `RINCIAN SO ${periodeLabel(periode).toUpperCase()}`, s: 'title' }],
    [],
    ['Tanggal', 'Nomor SO', 'Customer', 'Barang', 'Qty', 'Satuan', 'Harga', 'Total SO'].map(head),
    ...d.customers.flatMap((c) => c.orders.flatMap((o) => (o.items.length ? o.items : [{ nama: '', qty: 0, unit: null, harga: 0 }]).map((it, k) => [
      { v: o.tanggal, s: 'center' as const }, t(o.number), t(c.name), t(it.nama || null), { v: it.qty || null, s: 'num' as const }, t(it.unit), num(it.harga), k === 0 ? num(o.total) : t(null),
    ]))),
  ]
  const belum: XlsxCell[][] = [
    [{ v: `ORDER ${periodeLabel(d.prev).toUpperCase()}, BELUM ORDER ${periodeLabel(periode).toUpperCase()}`, s: 'title' }],
    [],
    ['No', 'No. customer', 'Customer', 'Telepon', 'SO bulan lalu', 'Nilai bulan lalu', 'Order terakhir'].map(head),
    ...d.belum.map((b, i) => [{ v: i + 1, s: 'center' as const }, t(b.customer_no), t(b.name), t(b.phone), num(b.so_count), num(b.nilai), { v: b.terakhir, s: 'center' as const }]),
  ]
  return {
    filename: `Order Customer ${periode}.xlsx`,
    buffer: writeXlsx([
      { title: 'Rekap Customer', rows: rekap, widths: [5, 12, 34, 18, 16, 14, 10, 15, 14, 14, 40], freeze: { row: 3, col: 3 } },
      { title: 'Rincian SO', rows: detail, widths: [12, 18, 34, 48, 9, 9, 13, 15], freeze: { row: 3, col: 2 } },
      { title: 'Belum Order', rows: belum, widths: [5, 12, 34, 16, 12, 15, 14] },
    ]),
  }
}
