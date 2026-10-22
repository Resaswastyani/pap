import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import {
  BS_ASSET_TYPES, BS_LIAB_TYPES, bsAmounts, bsSummary, canSetTarget, groupByType, isPeriode, monthEnd, PL_TYPES, plAmounts, plSummary, requireAccounting, shiftMonth, todayWib,
} from '@/lib/accounting'
import { db } from '@/lib/db'

export const maxDuration = 60
const KATEGORI = ['pendapatan', 'hpp', 'biaya', 'laba_bersih'] as const

// Laporan keuangan bulanan: laba rugi (bulan / s.d. bulan ini), neraca per akhir bulan, target management
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireAccounting(user, 'laporan-keuangan')
  const p = new URL(request.url).searchParams
  const today = todayWib()
  const periode = isPeriode(p.get('periode')) ? p.get('periode')! : today.slice(0, 7)
  const end = periode === today.slice(0, 7) ? today : monthEnd(periode)
  const ytd = p.get('jenis') === 'ytd'
  const from = ytd ? `${periode.slice(0, 4)}-01-01` : `${periode}-01`
  const plRows = await plAmounts(from, end)
  const prevP = shiftMonth(periode, -1)
  const prevRows = ytd ? null : await plAmounts(`${prevP}-01`, monthEnd(prevP))
  const bsRows = await bsAmounts(end)
  const [targets] = await db.query<RowDataPacket[]>('SELECT kategori, nilai FROM finance_targets WHERE periode = ?', [periode])
  const pl = plSummary(plRows)
  const bs = bsSummary(bsRows)
  return NextResponse.json({
    periode, dari: from, sampai: end, jenis: ytd ? 'ytd' : 'bulan',
    laba_rugi: { ringkasan: pl, sebelumnya: prevRows ? plSummary(prevRows) : null, kelompok: groupByType(plRows, PL_TYPES) },
    neraca: { ringkasan: bs, aset: groupByType(bsRows, BS_ASSET_TYPES), kewajiban: groupByType(bsRows, BS_LIAB_TYPES) },
    targets: Object.fromEntries(targets.map((t) => [t.kategori, Number(t.nilai)])),
    can: { target: canSetTarget(user) },
  })
})

// Target bulanan management: { periode, pendapatan, hpp, biaya, laba_bersih } (kosong = hapus target)
export const PUT = handle(async (request: Request) => {
  const user = await requireUser()
  requireAccounting(user, 'laporan-keuangan')
  if (!canSetTarget(user)) fail(403, 'Target keuangan diatur oleh management.')
  const body = await readJson(request)
  const periode = String(body.periode ?? '')
  if (!isPeriode(periode)) fail(400, 'Periode tidak valid.')
  for (const k of KATEGORI) {
    const raw = body[k]
    if (raw === '' || raw === null || raw === undefined) {
      await db.query('DELETE FROM finance_targets WHERE periode = ? AND kategori = ?', [periode, k])
      continue
    }
    const v = Number(String(raw).replace(',', '.'))
    if (!Number.isFinite(v) || Math.abs(v) > 1e14) fail(400, `Target ${k.replace('_', ' ')} tidak valid.`)
    await db.query('INSERT INTO finance_targets (periode, kategori, nilai, updated_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE nilai = VALUES(nilai), updated_by = VALUES(updated_by)', [periode, k, v, user.id])
  }
  return NextResponse.json({ ok: true })
})
