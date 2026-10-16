import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { computeKpi, KPI_KEYS, KPI_METRICS, kpiUsers, loadTargets, previousPeriode, readPeriode, requireKpi, seesAllKpi } from '@/lib/kpi'

// KPI marketing per sales: realisasi bulan ini, bulan lalu (pembanding), dan target
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireKpi(user)
  const periode = readPeriode(new URL(request.url).searchParams.get('periode'))
  const prev = previousPeriode(periode)
  const users = await kpiUsers(user)
  const ids = users.map((u) => u.id)
  const [now, before, targets] = await Promise.all([computeKpi(ids, periode), computeKpi(ids, prev), loadTargets(ids, periode)])
  return NextResponse.json({
    periode,
    sebelumnya: prev,
    metrics: KPI_METRICS,
    rows: users.map((u) => ({ ...u, nilai: now.get(u.id), sebelumnya: before.get(u.id), target: targets.get(u.id) ?? {} })),
    canSetTarget: seesAllKpi(user),
  })
})

// Simpan target: { periode, user_id, targets: { metric: angka } } atau salin dari bulan lalu: { periode, copy: true }
export const PUT = handle(async (request: Request) => {
  const user = await requireUser()
  requireKpi(user)
  if (!seesAllKpi(user)) fail(403, 'Hanya Lead / GM yang dapat mengatur target KPI.')
  const body = await readJson(request)
  const periode = readPeriode(body.periode)
  if (body.copy) {
    await db.query(
      `INSERT INTO kpi_targets (user_id, periode, metric, target, updated_by)
       SELECT user_id, ?, metric, target, ? FROM kpi_targets WHERE periode = ?
       ON DUPLICATE KEY UPDATE target = VALUES(target), updated_by = VALUES(updated_by)`,
      [periode, user.id, previousPeriode(periode)],
    )
    return NextResponse.json({ ok: true })
  }
  const userId = int(body.user_id) ?? fail(400, 'Pilih sales.')
  const allowed = (await kpiUsers(user)).some((u) => u.id === userId)
  if (!allowed) fail(400, 'Sales tidak ditemukan.')
  const raw = (body.targets ?? {}) as Record<string, unknown>
  const rows: unknown[][] = []
  for (const key of KPI_KEYS) {
    if (raw[key] === undefined || raw[key] === '') continue
    const n = Number(String(raw[key]).replace(/\./g, '').replace(',', '.'))
    if (!Number.isFinite(n) || n < 0) fail(400, `Target ${KPI_METRICS[key].label} tidak valid.`)
    rows.push([userId, periode, key, n, user.id])
  }
  await db.query('DELETE FROM kpi_targets WHERE user_id = ? AND periode = ?', [userId, periode])
  if (rows.length) await db.query('INSERT INTO kpi_targets (user_id, periode, metric, target, updated_by) VALUES ?', [rows])
  return NextResponse.json({ ok: true })
})
