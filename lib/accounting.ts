// Accounting, Pajak & Finance (Guidance divisi Accounting). Angka keuangan dibaca langsung dari Accurate
// (laba rugi, neraca, saldo & transaksi kas/bank, piutang, hutang, PPN) dan di-cache di acc_report_cache.
import type { RowDataPacket } from 'mysql2'
import { accurate, AccurateError, fromAccurateDate } from '@/lib/accurate'
import { fail } from '@/lib/api'
import { db } from '@/lib/db'
import { PERMISSIONS } from '@/lib/permissions'
import { can, isManagement, type UserProfile } from '@/lib/users'

type Obj = Record<string, unknown>
export const ACCOUNTING_MENUS = ['keuangan', 'kas-bank', 'piutang', 'laporan-keuangan', 'arus-kas', 'pajak'] as const
export type AccountingMenu = (typeof ACCOUNTING_MENUS)[number]
export function requireAccounting(user: UserProfile, menu: AccountingMenu) {
  if (!user.menus.includes(menu as never)) fail(403, 'Anda tidak punya akses ke menu ini.')
}
export const canManageAccounting = (user: UserProfile) => can(user, PERMISSIONS.accountingManage)
export const canSetTarget = (user: UserProfile) => can(user, PERMISSIONS.accountingTarget) || isManagement(user)

export const todayWib = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
export const isPeriode = (v: string | null | undefined): v is string => !!v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v)
export const isDate = (v: string | null | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)
const toAcc = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
export const monthEnd = (p: string) => new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)), 0)).toISOString().slice(0, 10)
export const shiftMonth = (p: string, d: number) => {
  const x = new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)) - 1 + d, 1))
  return x.toISOString().slice(0, 7)
}
const round = (v: number) => Math.round(v)

async function get<T>(path: string, params: Record<string, string | number> = {}) {
  try {
    return await accurate<T>(path, { params })
  } catch (error) {
    if (error instanceof AccurateError) fail(502, `Data Accurate tidak bisa dimuat: ${error.message.replace(/^Accurate \(\d+\): /, '')}`)
    throw error
  }
}

// Cache di database: laporan bulan yang sudah lewat 6 jam, bulan berjalan / hari ini 15 menit
async function cached<T>(key: string, ttlMinutes: number, load: () => Promise<T>, force = false): Promise<T> {
  if (!force) {
    const [[row]] = await db.query<(RowDataPacket & { data: string; age: number })[]>(
      'SELECT data, TIMESTAMPDIFF(SECOND, fetched_at, NOW()) AS age FROM acc_report_cache WHERE cache_key = ?', [key],
    )
    if (row && row.age < ttlMinutes * 60) return JSON.parse(row.data) as T
  }
  const data = await load()
  await db.query('INSERT INTO acc_report_cache (cache_key, data, fetched_at) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE data = VALUES(data), fetched_at = NOW()', [key, JSON.stringify(data)])
  return data
}
const ttlFor = (lastDate: string) => (lastDate < todayWib().slice(0, 8) + '01' ? 360 : 15)
export async function clearAccountingCache() {
  await db.query('DELETE FROM acc_report_cache')
}

// ---------- Laba rugi & neraca ----------
export type AccountAmount = { no: string; name: string; type: string; parent: string | null; lvl: number; amount: number }
const mapAmounts = (rows: Obj[]): AccountAmount[] => rows.filter((r) => !r.isParent).map((r) => ({
  no: String(r.accountNo), name: String(r.accountName).replace(/^IGP - /, ''), type: String(r.accountType), parent: (r.parentNo as string) || null, lvl: Number(r.lvl ?? 0), amount: Number(r.amount ?? 0),
}))

export async function plAmounts(from: string, to: string, force = false) {
  return cached(`pl:${from}:${to}`, ttlFor(to), async () => mapAmounts((await get<Obj[]>('/api/glaccount/get-pl-account-amount.do', { fromDate: toAcc(from), toDate: toAcc(to) })).d ?? []), force)
}
export async function bsAmounts(asOf: string, force = false) {
  return cached(`bs:${asOf}`, ttlFor(asOf), async () => mapAmounts((await get<Obj[]>('/api/glaccount/get-bs-account-amount.do', { asOfDate: toAcc(asOf) })).d ?? []), force)
}

const sumType = (rows: AccountAmount[], ...types: string[]) => rows.filter((r) => types.includes(r.type)).reduce((s, r) => s + r.amount, 0)
export function plSummary(rows: AccountAmount[]) {
  const pendapatan = sumType(rows, 'REVENUE')
  const hpp = sumType(rows, 'COST_OF_GOOD_SOLD')
  const biaya = sumType(rows, 'EXPENSE')
  const pendapatanLain = sumType(rows, 'OTHER_INCOME')
  const biayaLain = sumType(rows, 'OTHER_EXPENSE')
  const labaKotor = pendapatan - hpp
  const labaUsaha = labaKotor - biaya
  return {
    pendapatan: round(pendapatan), hpp: round(hpp), laba_kotor: round(labaKotor), biaya: round(biaya), laba_usaha: round(labaUsaha),
    pendapatan_lain: round(pendapatanLain), biaya_lain: round(biayaLain), laba_bersih: round(labaUsaha + pendapatanLain - biayaLain),
    margin_kotor: pendapatan ? Math.round((labaKotor / pendapatan) * 1000) / 10 : null,
    margin_bersih: pendapatan ? Math.round(((labaUsaha + pendapatanLain - biayaLain) / pendapatan) * 1000) / 10 : null,
  }
}
const ASSET = ['CASH_BANK', 'ACCOUNT_RECEIVABLE', 'INVENTORY', 'OTHER_CURRENT_ASSET', 'FIXED_ASSET', 'ACCUMULATED_DEPRECIATION', 'OTHER_ASSET']
const CURRENT_ASSET = ['CASH_BANK', 'ACCOUNT_RECEIVABLE', 'INVENTORY', 'OTHER_CURRENT_ASSET']
const CURRENT_LIAB = ['ACCOUNT_PAYABLE', 'OTHER_CURRENT_LIABILITY']
const LIAB = [...CURRENT_LIAB, 'LONG_TERM_LIABILITY']
export const TYPE_LABEL: Record<string, string> = {
  CASH_BANK: 'Kas & Bank', ACCOUNT_RECEIVABLE: 'Piutang Usaha', INVENTORY: 'Persediaan', OTHER_CURRENT_ASSET: 'Aset Lancar Lainnya', FIXED_ASSET: 'Aset Tetap',
  ACCUMULATED_DEPRECIATION: 'Akumulasi Penyusutan', OTHER_ASSET: 'Aset Lainnya', ACCOUNT_PAYABLE: 'Hutang Usaha', OTHER_CURRENT_LIABILITY: 'Hutang Lancar Lainnya',
  LONG_TERM_LIABILITY: 'Hutang Jangka Panjang', EQUITY: 'Ekuitas', REVENUE: 'Pendapatan', COST_OF_GOOD_SOLD: 'Harga Pokok Penjualan', EXPENSE: 'Beban Usaha',
  OTHER_INCOME: 'Pendapatan Lain', OTHER_EXPENSE: 'Beban Lain',
}
export function bsSummary(rows: AccountAmount[]) {
  const aset = sumType(rows, ...ASSET)
  const liab = sumType(rows, ...LIAB)
  const ekuitas = sumType(rows, 'EQUITY')
  const asetLancar = sumType(rows, ...CURRENT_ASSET)
  const liabLancar = sumType(rows, ...CURRENT_LIAB)
  return {
    aset: round(aset), aset_lancar: round(asetLancar), kas_bank: round(sumType(rows, 'CASH_BANK')), piutang: round(sumType(rows, 'ACCOUNT_RECEIVABLE')),
    persediaan: round(sumType(rows, 'INVENTORY')), liabilitas: round(liab), liabilitas_lancar: round(liabLancar), hutang_usaha: round(sumType(rows, 'ACCOUNT_PAYABLE')),
    ekuitas: round(ekuitas),
    // Laba tahun berjalan belum tutup buku = selisih aset dengan liabilitas + ekuitas
    laba_berjalan: round(aset - liab - ekuitas),
    current_ratio: liabLancar ? Math.round((asetLancar / liabLancar) * 100) / 100 : null,
    debt_to_equity: aset - liab ? Math.round((liab / (aset - liab)) * 100) / 100 : null,
  }
}
// Kelompok per tipe akun untuk tampilan laporan
export function groupByType(rows: AccountAmount[], types: string[]) {
  return types.map((type) => {
    const accounts = rows.filter((r) => r.type === type && Math.abs(r.amount) >= 0.5).sort((a, b) => a.no.localeCompare(b.no))
    return { type, label: TYPE_LABEL[type] ?? type, total: round(accounts.reduce((s, r) => s + r.amount, 0)), accounts: accounts.map((a) => ({ ...a, amount: round(a.amount) })) }
  }).filter((g) => g.accounts.length || g.total)
}
export const PL_TYPES = ['REVENUE', 'COST_OF_GOOD_SOLD', 'EXPENSE', 'OTHER_INCOME', 'OTHER_EXPENSE']
export const BS_ASSET_TYPES = ASSET
export const BS_LIAB_TYPES = [...LIAB, 'EQUITY']

// Laba rugi 12 bulan terakhir (untuk grafik & metrik)
export async function plTrend(endPeriode: string, months = 12, force = false) {
  const out: { periode: string; pendapatan: number; hpp: number; biaya: number; laba_bersih: number }[] = []
  for (let i = months - 1; i >= 0; i--) {
    const p = shiftMonth(endPeriode, -i)
    const end = p === todayWib().slice(0, 7) ? todayWib() : monthEnd(p)
    const s = plSummary(await plAmounts(`${p}-01`, end, force && i === 0))
    out.push({ periode: p, pendapatan: s.pendapatan, hpp: s.hpp, biaya: s.biaya + s.biaya_lain - s.pendapatan_lain, laba_bersih: s.laba_bersih })
  }
  return out
}

// ---------- Kas & bank ----------
export type CashAccount = { id: number; no: string; name: string; balance: number; parent: string | null; is_parent: boolean }
export async function cashAccounts(force = false) {
  return cached('cash:accounts', 10, async () => {
    const res = await get<Obj[]>('/api/glaccount/list.do', { fields: 'id,no,name,balance,suspended', 'filter.accountType.val': 'CASH_BANK', 'sp.pageSize': 100 })
    // Daftar akun tidak memuat induk; struktur induk-anak diambil dari neraca hari ini (saldo induk = jumlah anak)
    const bs = (await bsAmounts(todayWib(), force)).filter((r) => r.type === 'CASH_BANK')
    const parentOf = new Map(bs.map((r) => [r.no, r.parent]))
    const parents = new Set(bs.map((r) => r.parent).filter(Boolean))
    return (res.d ?? []).filter((a) => !a.suspended).map((a): CashAccount => ({
      id: Number(a.id), no: String(a.no), name: String(a.name).replace(/^IGP - /, ''), balance: Number(a.balance ?? 0),
      parent: parentOf.get(String(a.no)) ?? null, is_parent: parents.has(String(a.no)),
    }))
  }, force)
}

// Transaksi kas & bank harian: penerimaan customer, pembayaran supplier, penerimaan & pengeluaran lain
export type CashTx = { id: string; tanggal: string; jenis: 'masuk' | 'keluar'; sumber: string; nomor: string; pihak: string | null; keterangan: string | null; akun: string | null; akun_no: string | null; nominal: number }
const SOURCES = [
  { path: '/api/sales-receipt/list.do', sumber: 'Penerimaan customer', jenis: 'masuk' as const, amount: 'totalPayment', party: 'customer' },
  { path: '/api/other-deposit/list.do', sumber: 'Penerimaan lain', jenis: 'masuk' as const, amount: 'amount', party: null },
  { path: '/api/purchase-payment/list.do', sumber: 'Pembayaran supplier', jenis: 'keluar' as const, amount: 'totalPayment', party: 'vendor' },
  { path: '/api/other-payment/list.do', sumber: 'Pengeluaran lain', jenis: 'keluar' as const, amount: 'amount', party: null },
]
export async function cashTransactions(from: string, to: string, force = false) {
  return cached(`cash:tx:${from}:${to}`, ttlFor(to), async () => {
    const out: CashTx[] = []
    for (const src of SOURCES) {
      for (let page = 1; page <= 20; page++) {
        const res = await get<Obj[]>(src.path, {
          fields: `id,number,transDate,description,bank,${src.amount}${src.party ? `,${src.party}` : ''}`, 'sp.page': page, 'sp.pageSize': 100,
          'filter.transDate.op': 'BETWEEN', 'filter.transDate.val[0]': toAcc(from), 'filter.transDate.val[1]': toAcc(to),
        })
        for (const r of res.d ?? []) {
          const bank = (r.bank ?? {}) as Obj
          out.push({
            id: `${src.path.split('/')[2]}:${r.id}`, tanggal: fromAccurateDate(r.transDate) ?? '', jenis: src.jenis, sumber: src.sumber, nomor: String(r.number ?? ''),
            pihak: src.party ? (((r[src.party] ?? {}) as Obj).name as string) ?? null : null, keterangan: (r.description as string) || null,
            akun: bank.name ? String(bank.name).replace(/^IGP - /, '') : null, akun_no: (bank.no as string) || null, nominal: Number(r[src.amount] ?? 0),
          })
        }
        if (!res.sp || page >= res.sp.pageCount) break
      }
    }
    return out.sort((a, b) => b.tanggal.localeCompare(a.tanggal) || a.jenis.localeCompare(b.jenis))
  }, force)
}

// Saldo akun kas/bank per tanggal (dari neraca) untuk pencocokan dengan saldo real
export async function cashBalanceAt(accountNo: string, tanggal: string) {
  const rows = await bsAmounts(tanggal)
  const hit = rows.filter((r) => r.type === 'CASH_BANK' && (r.no === accountNo || r.parent === accountNo))
  if (!hit.length) fail(404, 'Akun kas/bank tidak ditemukan di neraca Accurate.')
  return round(hit.reduce((s, r) => s + r.amount, 0) * 100) / 100
}

// ---------- Piutang & hutang ----------
export type Receivable = { id: number; number: string; tanggal: string | null; jatuh_tempo: string | null; customer: string | null; customer_no: string | null; total: number; sisa: number; umur: number }
export async function receivables(force = false) {
  return cached('ar:outstanding', 10, async () => {
    const out: Receivable[] = []
    const today = todayWib()
    for (let page = 1; page <= 20; page++) {
      const res = await get<Obj[]>('/api/sales-invoice/list.do', { fields: 'id,number,transDate,dueDate,customer,totalAmount,primeOwing', 'filter.outstanding': 'true', 'sp.page': page, 'sp.pageSize': 100 })
      for (const r of res.d ?? []) {
        const c = (r.customer ?? {}) as Obj
        const due = fromAccurateDate(r.dueDate)
        out.push({
          id: Number(r.id), number: String(r.number), tanggal: fromAccurateDate(r.transDate), jatuh_tempo: due, customer: (c.name as string) ?? null, customer_no: (c.customerNo as string) ?? null,
          total: Number(r.totalAmount ?? 0), sisa: Number(r.primeOwing ?? 0), umur: due ? Math.round((Date.parse(today) - Date.parse(due)) / 86400e3) : 0,
        })
      }
      if (!res.sp || page >= res.sp.pageCount) break
    }
    return out.filter((r) => r.sisa > 0.5).sort((a, b) => b.umur - a.umur)
  }, force)
}
// Hutang supplier dari salinan faktur pembelian Accurate (sinkron Purchasing)
export async function payables() {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT pi.accurate_id AS id, pi.number, pi.trans_date, pi.due_date, pi.owing, v.name AS vendor_name FROM accurate_purchase_invoices pi
     LEFT JOIN accurate_vendors v ON v.accurate_id = pi.vendor_accurate_id WHERE pi.owing > 0 ORDER BY pi.due_date`,
  )
  return rows.map((r) => ({ id: Number(r.id), number: String(r.number), tanggal: r.trans_date as string, jatuh_tempo: (r.due_date as string) ?? null, vendor: (r.vendor_name as string) ?? null, sisa: Number(r.owing) }))
}
export const AGING = [
  { key: 'belum', label: 'Belum jatuh tempo', test: (u: number) => u <= 0 },
  { key: '1_30', label: '1–30 hari', test: (u: number) => u >= 1 && u <= 30 },
  { key: '31_60', label: '31–60 hari', test: (u: number) => u >= 31 && u <= 60 },
  { key: '61_90', label: '61–90 hari', test: (u: number) => u >= 61 && u <= 90 },
  { key: 'lebih_90', label: '> 90 hari', test: (u: number) => u > 90 },
]

// ---------- Forecast arus kas mingguan ----------
type Plan = RowDataPacket & { id: number; jenis: 'masuk' | 'keluar'; kategori: string; keterangan: string | null; tanggal: string; nominal: string; berulang: 'sekali' | 'mingguan' | 'bulanan'; sampai: string | null }
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400e3).toISOString().slice(0, 10)
function planDates(p: Plan, from: string, to: string) {
  const start = String(p.tanggal).slice(0, 10)
  const until = p.sampai ? String(p.sampai).slice(0, 10) : to
  const dates: string[] = []
  if (p.berulang === 'sekali') return start >= from && start <= to ? [start] : []
  for (let i = 0, d = start; d <= to && d <= until && i < 400; i++) {
    if (d >= from) dates.push(d)
    if (p.berulang === 'mingguan') d = addDays(d, 7)
    else {
      const day = Number(start.slice(8, 10))
      const next = shiftMonth(d.slice(0, 7), 1)
      d = `${next}-${String(Math.min(day, Number(monthEnd(next).slice(8, 10)))).padStart(2, '0')}`
    }
  }
  return dates
}

// 13 minggu ke depan: saldo awal = saldo kas & bank; masuk = piutang jatuh tempo (yang lewat tempo dimasukkan minggu pertama) + rencana;
// keluar = hutang supplier jatuh tempo + rencana (gaji, cicilan, pajak, dll.)
export async function forecast(weeks = 13) {
  const today = todayWib()
  const accounts = await cashAccounts()
  const saldo = accounts.filter((a) => !a.is_parent).reduce((s, a) => s + a.balance, 0)
  const ar = await receivables()
  const ap = await payables()
  const [plans] = await db.query<Plan[]>('SELECT * FROM cash_plans WHERE aktif = 1')
  const end = addDays(today, weeks * 7 - 1)
  const rows = Array.from({ length: weeks }, (_, i) => {
    const from = addDays(today, i * 7)
    const to = addDays(from, 6)
    const inRange = (d: string | null) => (i === 0 ? !d || d <= to : !!d && d >= from && d <= to)
    const piutang = ar.filter((r) => inRange(r.jatuh_tempo)).reduce((s, r) => s + r.sisa, 0)
    const hutang = ap.filter((r) => inRange(r.jatuh_tempo ? String(r.jatuh_tempo).slice(0, 10) : null)).reduce((s, r) => s + r.sisa, 0)
    const planned = plans.flatMap((p) => planDates(p, from, to).map(() => p))
    const rencanaMasuk = planned.filter((p) => p.jenis === 'masuk').reduce((s, p) => s + Number(p.nominal), 0)
    const rencanaKeluar = planned.filter((p) => p.jenis === 'keluar').reduce((s, p) => s + Number(p.nominal), 0)
    return { minggu: i + 1, dari: from, sampai: to, piutang: round(piutang), rencana_masuk: round(rencanaMasuk), hutang: round(hutang), rencana_keluar: round(rencanaKeluar), rincian: planned.map((p) => `${p.jenis === 'masuk' ? '+' : '−'} ${p.kategori}${p.keterangan ? ` (${p.keterangan})` : ''}`) }
  })
  let running = saldo
  const table = rows.map((r) => {
    const awal = running
    const masuk = r.piutang + r.rencana_masuk
    const keluar = r.hutang + r.rencana_keluar
    running = awal + masuk - keluar
    return { ...r, saldo_awal: round(awal), masuk, keluar, saldo_akhir: round(running) }
  })
  return { saldo_awal: round(saldo), sampai: end, minggu: table, terendah: table.reduce((m, r) => Math.min(m, r.saldo_akhir), Infinity) }
}

// ---------- Pajak ----------
export const TAX_TYPES: Record<string, { label: string; setor: number; lapor: number }> = {
  ppn: { label: 'PPN', setor: 31, lapor: 31 }, // setor & lapor paling lambat akhir bulan berikutnya
  pph21: { label: 'PPh 21', setor: 15, lapor: 20 },
  pph23: { label: 'PPh 23', setor: 15, lapor: 20 },
  pph4_2: { label: 'PPh 4 ayat 2', setor: 15, lapor: 20 },
  pph25: { label: 'PPh 25', setor: 15, lapor: 20 },
}
// Batas setor / lapor masa pajak (bulan berikutnya)
export function taxDeadline(masa: string, day: number) {
  const next = shiftMonth(masa, 1)
  return `${next}-${String(Math.min(day, Number(monthEnd(next).slice(8, 10)))).padStart(2, '0')}`
}

// PPN keluaran (faktur penjualan) & masukan (faktur pembelian) per masa
export async function vatSummary(masa: string, force = false) {
  const end = monthEnd(masa)
  return cached(`vat:${masa}`, ttlFor(end), async () => {
    const collect = async (path: string, party: string) => {
      const out: { id: number; number: string; tanggal: string | null; pihak: string | null; dpp: number; ppn: number; faktur_pajak: string | null }[] = []
      for (let page = 1; page <= 30; page++) {
        const res = await get<Obj[]>(path, {
          fields: `id,number,taxDate,transDate,dppAmount,tax1Amount,taxNumber,${party}`, 'sp.page': page, 'sp.pageSize': 100,
          'filter.transDate.op': 'BETWEEN', 'filter.transDate.val[0]': toAcc(`${masa}-01`), 'filter.transDate.val[1]': toAcc(end),
        })
        for (const r of res.d ?? []) {
          const ppn = Number(r.tax1Amount ?? 0)
          if (ppn) out.push({ id: Number(r.id), number: String(r.number), tanggal: fromAccurateDate(r.taxDate ?? r.transDate), pihak: (((r[party] ?? {}) as Obj).name as string) ?? null, dpp: Number(r.dppAmount ?? 0), ppn, faktur_pajak: (r.taxNumber as string) || null })
        }
        if (!res.sp || page >= res.sp.pageCount) break
      }
      return out
    }
    const keluaran = await collect('/api/sales-invoice/list.do', 'customer')
    const masukan = await collect('/api/purchase-invoice/list.do', 'vendor')
    const sum = (rows: typeof keluaran, k: 'dpp' | 'ppn') => round(rows.reduce((s, r) => s + r[k], 0))
    return {
      keluaran, masukan,
      total: { dpp_keluaran: sum(keluaran, 'dpp'), ppn_keluaran: sum(keluaran, 'ppn'), dpp_masukan: sum(masukan, 'dpp'), ppn_masukan: sum(masukan, 'ppn'), kurang_bayar: sum(keluaran, 'ppn') - sum(masukan, 'ppn') },
    }
  }, force)
}
