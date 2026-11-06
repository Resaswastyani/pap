import { NextResponse } from 'next/server'
import { handle, requireUser } from '@/lib/api'
import { requireAccounting, todayWib } from '@/lib/accounting'
import { downPayments, dpRange, ensureDpFlags } from '@/lib/uang-muka'

export const maxDuration = 60

// Uang muka customer (faktur DP Accurate): ?mode=hari|bulan|tahun &nilai=YYYY-MM-DD|YYYY-MM|YYYY (default bulan ini)
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireAccounting(user, 'keuangan')
  const p = new URL(request.url).searchParams
  await ensureDpFlags()
  const range = dpRange(p.get('mode'), p.get('nilai'), todayWib())
  const data = await downPayments(range.dari, range.sampai)
  // Rincian: per bulan (mode tahun) atau per hari (mode bulan)
  const key = (t: string) => (range.mode === 'tahun' ? t.slice(0, 7) : t.slice(0, 10))
  const per = new Map<string, { total: number; jumlah: number }>()
  for (const r of data.items) {
    const k = key(r.tanggal)
    const cur = per.get(k) ?? { total: 0, jumlah: 0 }
    per.set(k, { total: cur.total + r.total, jumlah: cur.jumlah + 1 })
  }
  return NextResponse.json({ ...range, ...data, rincian: [...per.entries()].sort().map(([k, v]) => ({ key: k, ...v })) })
})
