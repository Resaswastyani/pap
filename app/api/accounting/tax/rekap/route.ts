import { NextResponse } from 'next/server'
import { handle, requireUser } from '@/lib/api'
import { isClosed, requireAccounting, todayWib, vatWithDigunggung, yearRange } from '@/lib/accounting'

export const maxDuration = 60

// Rekap PPN per masa dalam satu tahun (?tahun=YYYY): keluaran, digunggung, masukan, kurang / lebih bayar
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireAccounting(user, 'pajak')
  const { tahun } = yearRange(new URL(request.url).searchParams.get('tahun'))
  const now = todayWib().slice(0, 7)
  const masa = Array.from({ length: 12 }, (_, i) => `${tahun}-${String(i + 1).padStart(2, '0')}`).filter((m) => m <= now)
  const rows: { masa: string; ppn_keluaran: number; ppn_digunggung: number; ppn_masukan: number; kurang_bayar: number; ditutup: boolean }[] = []
  for (const m of masa) {
    const v = await vatWithDigunggung(m)
    rows.push({ masa: m, ppn_keluaran: v.total.ppn_keluaran, ppn_digunggung: v.total.ppn_digunggung, ppn_masukan: v.total.ppn_masukan, kurang_bayar: v.total.kurang_bayar, ditutup: await isClosed(m) })
  }
  const sum = (k: 'ppn_keluaran' | 'ppn_digunggung' | 'ppn_masukan' | 'kurang_bayar') => rows.reduce((s, r) => s + r[k], 0)
  return NextResponse.json({ tahun, masa: rows, total: { ppn_keluaran: sum('ppn_keluaran'), ppn_digunggung: sum('ppn_digunggung'), ppn_masukan: sum('ppn_masukan'), kurang_bayar: sum('kurang_bayar') } })
})
