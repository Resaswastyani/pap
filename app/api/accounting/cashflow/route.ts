import { NextResponse } from 'next/server'
import { handle, requireUser } from '@/lib/api'
import { cashTransactionsRange, requireAccounting, yearRange } from '@/lib/accounting'

export const maxDuration = 60

// Realisasi kas masuk / keluar per bulan dalam satu tahun (?tahun=YYYY), dari transaksi kas & bank Accurate
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireAccounting(user, 'arus-kas')
  const p = new URL(request.url).searchParams
  const r = yearRange(p.get('tahun'))
  const tx = await cashTransactionsRange(r.dari, r.sampai, p.get('refresh') === '1')
  const bulan = Array.from({ length: Number(r.sampai.slice(5, 7)) }, (_, i) => `${r.tahun}-${String(i + 1).padStart(2, '0')}`).map((m) => {
    const rows = tx.filter((t) => t.tanggal.startsWith(m))
    const masuk = Math.round(rows.filter((t) => t.jenis === 'masuk').reduce((s, t) => s + t.nominal, 0))
    const keluar = Math.round(rows.filter((t) => t.jenis === 'keluar').reduce((s, t) => s + t.nominal, 0))
    const per = (jenis: 'masuk' | 'keluar') => Object.entries(rows.filter((t) => t.jenis === jenis).reduce<Record<string, number>>((acc, t) => ({ ...acc, [t.sumber]: (acc[t.sumber] ?? 0) + t.nominal }), {})).map(([sumber, nominal]) => ({ sumber, nominal: Math.round(nominal) }))
    return { periode: m, masuk, keluar, bersih: masuk - keluar, rincian_masuk: per('masuk'), rincian_keluar: per('keluar') }
  })
  return NextResponse.json({ ...r, bulan, total: { masuk: bulan.reduce((s, b) => s + b.masuk, 0), keluar: bulan.reduce((s, b) => s + b.keluar, 0) } })
})
