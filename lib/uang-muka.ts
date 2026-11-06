// Uang muka (DP) customer dari Accurate: faktur penjualan bertanda invoiceDp (kolom is_dp di salinan faktur).
// Faktur pelunasan memuat nilai penuh pesanan lalu dipotong uang muka, jadi faktur DP tidak dihitung sebagai omzet.
// Tanda is_dp diisi saat sinkron faktur; faktur lama ditandai sekali lewat ensureDpFlags() (filter invoiceDp Accurate).
import type { RowDataPacket } from 'mysql2'
import { accurate, accurateEnabled } from '@/lib/accurate'
import { fail } from '@/lib/api'
import { db } from '@/lib/db'
import { sectorSql } from '@/lib/sectors'

const FLAG_KEY = 'accurate.dp_flags'
type Row = RowDataPacket & Record<string, unknown>

let running: Promise<void> | null = null
// Tandai faktur uang muka lama (sekali saja; berikutnya ikut sinkron faktur)
export async function ensureDpFlags() {
  const [[done]] = await db.query<Row[]>('SELECT value FROM app_settings WHERE `key` = ?', [FLAG_KEY])
  if (done?.value || !accurateEnabled()) return
  running ??= (async () => {
    const ids: number[] = []
    for (let page = 1; page <= 300; page++) {
      const res = await accurate<{ id: number }[]>('/api/sales-invoice/list.do', { params: { fields: 'id', 'filter.invoiceDp': 'true', 'sp.page': page, 'sp.pageSize': 100 } })
      ids.push(...(res.d ?? []).map((r) => Number(r.id)))
      if (!res.sp || page >= res.sp.pageCount) break
    }
    for (let i = 0; i < ids.length; i += 500) await db.query('UPDATE accurate_sales_invoices SET is_dp = 1 WHERE accurate_id IN (?)', [ids.slice(i, i + 500)])
    await db.query('UPDATE accurate_sales_invoices SET is_dp = 0 WHERE is_dp IS NULL')
    await db.query('INSERT INTO app_settings (`key`, value) VALUES (?, NOW()) ON DUPLICATE KEY UPDATE value = NOW()', [FLAG_KEY])
  })().finally(() => { running = null })
  await running
}

export type DpMode = 'hari' | 'bulan' | 'tahun'
// Rentang dari mode: hari (YYYY-MM-DD), bulan (YYYY-MM), tahun (YYYY)
export function dpRange(mode: string | null, nilai: string | null, today: string) {
  const m: DpMode = mode === 'hari' || mode === 'tahun' ? mode : 'bulan'
  if (m === 'hari') {
    const d = nilai && /^\d{4}-\d{2}-\d{2}$/.test(nilai) ? nilai : today
    return { mode: m, nilai: d, dari: d, sampai: d }
  }
  if (m === 'tahun') {
    const y = nilai && /^\d{4}$/.test(nilai) ? nilai : today.slice(0, 4)
    return { mode: m, nilai: y, dari: `${y}-01-01`, sampai: `${y}-12-31` }
  }
  const p = nilai && /^\d{4}-(0[1-9]|1[0-2])$/.test(nilai) ? nilai : today.slice(0, 7)
  const end = new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)), 0)).toISOString().slice(0, 10)
  return { mode: m, nilai: p, dari: `${p}-01`, sampai: end }
}

export async function downPayments(dari: string, sampai: string, limit = 2000) {
  if (dari > sampai) fail(400, 'Rentang tanggal tidak valid.')
  const [items] = await db.query<Row[]>(
    `SELECT i.accurate_id AS id, i.number, i.trans_date AS tanggal, i.total_amount AS total, i.owing, i.status,
       COALESCE(c.name, CONCAT('Customer #', i.customer_accurate_id)) AS customer, c.customer_no, ${sectorSql('c.category')} AS sektor
     FROM accurate_sales_invoices i LEFT JOIN customers c ON c.accurate_id = i.customer_accurate_id
     WHERE i.is_dp = 1 AND i.trans_date BETWEEN ? AND ? ORDER BY i.trans_date DESC, i.accurate_id DESC LIMIT ?`,
    [dari, sampai, limit],
  )
  const n = (v: unknown) => Number(v ?? 0)
  const rows = items.map((r) => ({ id: n(r.id), number: String(r.number ?? ''), tanggal: String(r.tanggal), customer: String(r.customer), customer_no: (r.customer_no as string) ?? null, sektor: String(r.sektor), total: n(r.total), sisa: n(r.owing), status: (r.status as string) ?? null }))
  return {
    items: rows,
    total: rows.reduce((s, r) => s + r.total, 0),
    jumlah: rows.length,
    customer: new Set(rows.map((r) => r.customer)).size,
    belum_dibayar: rows.reduce((s, r) => s + r.sisa, 0),
  }
}
