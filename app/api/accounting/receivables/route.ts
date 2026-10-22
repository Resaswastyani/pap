import { NextResponse } from 'next/server'
import { handle, requireUser } from '@/lib/api'
import { AGING, payables, receivables, requireAccounting, todayWib } from '@/lib/accounting'

export const maxDuration = 60

// Piutang customer (faktur belum lunas dari Accurate) + umur piutang, dan hutang supplier jatuh tempo
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireAccounting(user, 'piutang')
  const force = new URL(request.url).searchParams.get('refresh') === '1'
  const ar = await receivables(force)
  const ap = await payables()
  const today = todayWib()
  // Ringkasan per customer
  const per = new Map<string, { customer: string; customer_no: string | null; faktur: number; sisa: number; lewat_tempo: number; umur_max: number }>()
  for (const r of ar) {
    const key = r.customer_no ?? r.customer ?? '-'
    const cur = per.get(key) ?? { customer: r.customer ?? '—', customer_no: r.customer_no, faktur: 0, sisa: 0, lewat_tempo: 0, umur_max: 0 }
    cur.faktur++
    cur.sisa += r.sisa
    if (r.umur > 0) cur.lewat_tempo += r.sisa
    cur.umur_max = Math.max(cur.umur_max, r.umur)
    per.set(key, cur)
  }
  return NextResponse.json({
    piutang: ar,
    aging: AGING.map((a) => ({ key: a.key, label: a.label, nilai: Math.round(ar.filter((r) => a.test(r.umur)).reduce((s, r) => s + r.sisa, 0)), faktur: ar.filter((r) => a.test(r.umur)).length })),
    per_customer: [...per.values()].sort((a, b) => b.sisa - a.sisa),
    hutang: ap.map((r) => ({ ...r, umur: r.jatuh_tempo ? Math.round((Date.parse(today) - Date.parse(String(r.jatuh_tempo).slice(0, 10))) / 86400e3) : 0 })),
  })
})
