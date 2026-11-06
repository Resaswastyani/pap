import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { handle, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import {
  AGING, bsAmounts, bsSummary, cashAccounts, clearAccountingCache, isPeriode, monthEnd, payables, plAmounts, plSummary, plTrend, receivables, requireAccounting, shiftMonth, todayWib, yearRange,
} from '@/lib/accounting'

export const maxDuration = 60

// Ringkasan keuangan (metrik finansial): ?tahun=YYYY (akumulasi tahun itu, default tahun ini) atau ?periode=YYYY-MM &refresh=1
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireAccounting(user, 'keuangan')
  const p = new URL(request.url).searchParams
  if (p.get('refresh') === '1') await clearAccountingCache()
  const today = todayWib()
  const tahun = p.get('tahun') ? yearRange(p.get('tahun')) : null
  const periode = tahun ? tahun.periode : isPeriode(p.get('periode')) ? p.get('periode')! : today.slice(0, 7)
  const end = periode === today.slice(0, 7) ? today : monthEnd(periode)
  const pl = plSummary(await plAmounts(`${periode}-01`, end))
  const ytd = plSummary(await plAmounts(`${periode.slice(0, 4)}-01-01`, end))
  const bs = bsSummary(await bsAmounts(end))
  // Mode tahun: grafik Jan s.d. bulan terakhir tahun itu
  const trend = await plTrend(periode, tahun ? Number(periode.slice(5, 7)) : 12)
  const accounts = await cashAccounts()
  const ar = await receivables()
  const ap = await payables()
  const last3 = (tahun && trend.length < 3 ? await plTrend(periode, 3) : trend).slice(-3)
  const sales90 = last3.reduce((s, t) => s + t.pendapatan, 0)
  const cogs90 = last3.reduce((s, t) => s + t.hpp, 0)
  const arTotal = ar.reduce((s, r) => s + r.sisa, 0)
  const apTotal = ap.reduce((s, r) => s + r.sisa, 0)
  const apOverdue = ap.filter((r) => r.jatuh_tempo && String(r.jatuh_tempo).slice(0, 10) < today).reduce((s, r) => s + r.sisa, 0)
  // Target: mode tahun = jumlah target bulanan Jan s.d. bulan terakhir
  const [targets] = tahun
    ? await db.query<RowDataPacket[]>('SELECT kategori, SUM(nilai) AS nilai FROM finance_targets WHERE periode BETWEEN ? AND ? GROUP BY kategori', [`${tahun.tahun}-01`, periode])
    : await db.query<RowDataPacket[]>('SELECT kategori, nilai FROM finance_targets WHERE periode = ?', [periode])
  const prev = trend.find((t) => t.periode === shiftMonth(periode, -1))
  // Pembanding tahun: tahun lalu pada rentang yang sama
  const prevYear = tahun ? plSummary(await plAmounts(`${Number(tahun.tahun) - 1}-01-01`, `${Number(tahun.tahun) - 1}${end.slice(4)}`)) : null
  return NextResponse.json({
    periode, tahun: tahun?.tahun ?? null, sampai: end, pl, ytd, bs, trend, prev, prev_year: prevYear ? { pendapatan: prevYear.pendapatan, laba_bersih: prevYear.laba_bersih } : null,
    kas: { total: Math.round(accounts.filter((a) => !a.is_parent).reduce((s, a) => s + a.balance, 0)), akun: accounts.filter((a) => !a.is_parent).length },
    piutang: { total: Math.round(arTotal), faktur: ar.length, lewat_tempo: Math.round(ar.filter((r) => r.umur > 0).reduce((s, r) => s + r.sisa, 0)), aging: AGING.map((a) => ({ key: a.key, label: a.label, nilai: Math.round(ar.filter((r) => a.test(r.umur)).reduce((s, r) => s + r.sisa, 0)) })) },
    hutang: { total: Math.round(apTotal), faktur: ap.length, lewat_tempo: Math.round(apOverdue) },
    // Hari rata-rata piutang tertagih (DSO) & hutang dibayar (DPO), basis 90 hari terakhir
    dso: sales90 ? Math.round(arTotal / (sales90 / 90)) : null,
    dpo: cogs90 ? Math.round(apTotal / (cogs90 / 90)) : null,
    targets: Object.fromEntries(targets.map((t) => [t.kategori, Number(t.nilai)])),
  })
})
