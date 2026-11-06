// Nilai penjualan bersih faktur (= Pendapatan di Laba Rugi Accurate): subTotal − diskon − PPN bila harga termasuk PPN.
// Juga membuang salinan faktur yang sudah dihapus di Accurate (sinkron berdasarkan lastUpdate tidak pernah melihat penghapusan).
import type { RowDataPacket } from 'mysql2'
import { accurate, accurateEnabled } from '@/lib/accurate'
import { db } from '@/lib/db'

type Row = RowDataPacket & Record<string, unknown>
type Obj = Record<string, unknown>

export const NET_FIELDS = 'subTotal,cashDiscount,tax1Amount,inclusiveTax'
// null bila Accurate tidak mengirim subTotal (mis. field tidak diminta) -> nilai lama dipertahankan
export function netAmount(r: Obj): number | null {
  if (r.subTotal === undefined || r.subTotal === null) return null
  const n = (v: unknown) => Number(v ?? 0) || 0
  return Math.round((n(r.subTotal) - n(r.cashDiscount) - (r.inclusiveTax === true ? n(r.tax1Amount) : 0)) * 100) / 100
}
// Ekspresi SQL omzet faktur (alias tabel i)
export const INVOICE_NET_SQL = 'COALESCE(i.net_amount, i.total_amount)'

const BACKFILL_KEY = 'accurate.invoice_net_backfill'
const RECONCILE_KEY = 'accurate.invoice_reconcile_date'
const todayWib = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
const accDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

let running: Promise<void> | null = null

// Dipanggil sebelum membaca omzet faktur: sekali seumur hidup mengisi net_amount faktur lama, lalu sekali sehari
// mencocokkan faktur 13 bulan terakhir dengan Accurate (isi nilai bersih + buang faktur yang sudah dihapus di Accurate)
export async function ensureInvoiceNet() {
  if (!accurateEnabled()) return
  const [settings] = await db.query<Row[]>('SELECT `key`, value FROM app_settings WHERE `key` IN (?, ?)', [BACKFILL_KEY, RECONCILE_KEY])
  const get = (k: string) => settings.find((s) => s.key === k)?.value as string | undefined
  const today = todayWib()
  const needBackfill = !get(BACKFILL_KEY)
  if (!needBackfill && get(RECONCILE_KEY) === today) return
  running ??= (async () => {
    // Semua faktur (backfill pertama) atau 13 bulan terakhir (cek harian)
    const from = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 13, 1)).toISOString().slice(0, 10)
    const params: Record<string, string | number> = { fields: `id,${NET_FIELDS}`, 'sp.pageSize': 100, 'sp.sort': 'id|asc' }
    if (!needBackfill) Object.assign(params, { 'filter.transDate.op': 'BETWEEN', 'filter.transDate.val[0]': accDate(from), 'filter.transDate.val[1]': accDate(today) })
    const seen: [number, number | null][] = []
    let complete = false
    for (let page = 1; page <= 500; page++) {
      const res = await accurate<Obj[]>('/api/sales-invoice/list.do', { params: { ...params, 'sp.page': page } })
      seen.push(...(res.d ?? []).map((r) => [Number(r.id), netAmount(r)] as [number, number | null]))
      if (!res.sp || page >= res.sp.pageCount) { complete = true; break }
    }
    if (!complete) return
    // Isi nilai bersih (500 faktur per query)
    const updates: [number, number][] = seen.filter((s): s is [number, number] => s[1] !== null)
    for (let i = 0; i < updates.length; i += 500) {
      const chunk = updates.slice(i, i + 500)
      await db.query(
        `UPDATE accurate_sales_invoices SET net_amount = CASE accurate_id ${chunk.map(() => 'WHEN ? THEN ?').join(' ')} END WHERE accurate_id IN (?)`,
        [...chunk.flat(), chunk.map((c) => c[0])],
      )
    }
    // Faktur yang tidak ada lagi di Accurate pada rentang yang sama -> dihapus dari salinan PAP-MS
    if (seen.length) {
      const ids = new Set(seen.map((s) => s[0]))
      const [local] = await db.query<Row[]>(
        `SELECT accurate_id FROM accurate_sales_invoices ${needBackfill ? '' : 'WHERE trans_date >= ?'}`, needBackfill ? [] : [from],
      )
      const gone = local.map((r) => Number(r.accurate_id)).filter((id) => !ids.has(id))
      // Pengaman: jangan menghapus massal bila jawaban Accurate tampak tidak lengkap
      if (gone.length && gone.length <= Math.max(20, local.length * 0.05)) await db.query('DELETE FROM accurate_sales_invoices WHERE accurate_id IN (?)', [gone])
    }
    await db.query('INSERT INTO app_settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)', [RECONCILE_KEY, today])
    if (needBackfill) await db.query('INSERT INTO app_settings (`key`, value) VALUES (?, NOW()) ON DUPLICATE KEY UPDATE value = NOW()', [BACKFILL_KEY])
  })().finally(() => { running = null })
  await running
}

// Untuk halaman yang menampilkan omzet: tunggu paling lama beberapa detik; sisanya selesai di latar belakang
export async function ensureInvoiceNetQuick(ms = 8000) {
  await Promise.race([ensureInvoiceNet().catch(() => {}), new Promise((r) => setTimeout(r, ms))])
}
