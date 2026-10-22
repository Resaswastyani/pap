import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { handle, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import {
  AGING, bsAmounts, bsSummary, cashAccounts, clearAccountingCache, isPeriode, monthEnd, payables, plAmounts, plSummary, plTrend, receivables, requireAccounting, shiftMonth, todayWib,
} from '@/lib/accounting'

export const maxDuration = 60

// Ringkasan keuangan (metrik finansial): ?periode=YYYY-MM &refresh=1
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireAccounting(user, 'keuangan')
  const p = new URL(request.url).searchParams
  if (p.get('refresh') === '1') await clearAccountingCache()
  const today = todayWib()
  const periode = isPeriode(p.get('periode')) ? p.get('periode')! : today.slice(0, 7)
  const end = periode === today.slice(0, 7) ? today : monthEnd(periode)
  const pl = plSummary(await plAmounts(`${periode}-01`, end))
  const ytd = plSummary(await plAmounts(`${periode.slice(0, 4)}-01-01`, end))
  const bs = bsSummary(await bsAmounts(end))
  const trend = await plTrend(periode, 12)
  const accounts = await cashAccounts()
  const ar = await receivables()
  const ap = await payables()
  const last3 = trend.slice(-3)
  const sales90 = last3.reduce((s, t) => s + t.pendapatan, 0)
  const cogs90 = last3.reduce((s, t) => s + t.hpp, 0)
  const arTotal = ar.reduce((s, r) => s + r.sisa, 0)
  const apTotal = ap.reduce((s, r) => s + r.sisa, 0)
  const apOverdue = ap.filter((r) => r.jatuh_tempo && String(r.jatuh_tempo).slice(0, 10) < today).reduce((s, r) => s + r.sisa, 0)
  const [targets] = await db.query<RowDataPacket[]>('SELECT kategori, nilai FROM finance_targets WHERE periode = ?', [periode])
  const prev = trend.find((t) => t.periode === shiftMonth(periode, -1))
  return NextResponse.json({
    periode, sampai: end, pl, ytd, bs, trend, prev,
    kas: { total: Math.round(accounts.filter((a) => !a.is_parent).reduce((s, a) => s + a.balance, 0)), akun: accounts.filter((a) => !a.is_parent).length },
    piutang: { total: Math.round(arTotal), faktur: ar.length, lewat_tempo: Math.round(ar.filter((r) => r.umur > 0).reduce((s, r) => s + r.sisa, 0)), aging: AGING.map((a) => ({ key: a.key, label: a.label, nilai: Math.round(ar.filter((r) => a.test(r.umur)).reduce((s, r) => s + r.sisa, 0)) })) },
    hutang: { total: Math.round(apTotal), faktur: ap.length, lewat_tempo: Math.round(apOverdue) },
    // Hari rata-rata piutang tertagih (DSO) & hutang dibayar (DPO), basis 90 hari terakhir
    dso: sales90 ? Math.round(arTotal / (sales90 / 90)) : null,
    dpo: cogs90 ? Math.round(apTotal / (cogs90 / 90)) : null,
    targets: Object.fromEntries(targets.map((t) => [t.kategori, Number(t.nilai)])),
  })
})
