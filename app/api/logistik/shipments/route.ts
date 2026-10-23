import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageLogistik, mulaiPantau, readShipment, requireLogistik, saveShipment, serializeShipment, SHIPMENT_SELECT, shipCandidates } from '@/lib/logistik'

type Row = RowDataPacket & Record<string, unknown>

// Pengiriman: daftar (?status=aktif|selesai|semua &q=), SO yang perlu dikirim, ringkasan ketepatan waktu
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireLogistik(user, 'pengiriman')
  const p = new URL(request.url).searchParams
  const status = p.get('status') ?? 'aktif'
  const q = str(p.get('q'), 100)
  const where: string[] = []
  const args: unknown[] = []
  if (status === 'aktif') where.push("s.status IN ('packing', 'siap_kirim', 'dikirim')")
  else if (status === 'selesai') where.push("s.status IN ('diterima', 'batal')", 's.created_at >= CURDATE() - INTERVAL 180 DAY')
  else where.push('s.created_at >= CURDATE() - INTERVAL 365 DAY')
  if (q) {
    where.push('(s.nomor LIKE ? OR s.customer_name LIKE ? OR s.no_resi LIKE ? OR s.ekspedisi_nama LIKE ? OR EXISTS (SELECT 1 FROM shipment_items si WHERE si.shipment_id = s.id AND si.so_number LIKE ?))')
    args.push(...Array(5).fill(`%${q}%`))
  }
  const [rows] = await db.query<Row[]>(
    `${SHIPMENT_SELECT} WHERE ${where.join(' AND ')}
     ORDER BY FIELD(s.status, 'packing', 'siap_kirim', 'dikirim', 'diterima', 'batal'), COALESCE(s.tanggal_kirim, s.rencana_kirim, DATE(s.created_at)) DESC LIMIT 500`,
    args,
  )
  const [[stat]] = await db.query<Row[]>(
    `SELECT SUM(status IN ('packing', 'siap_kirim')) AS disiapkan, SUM(status = 'dikirim') AS dalam_perjalanan,
       SUM(status = 'dikirim' AND target_tiba < CURDATE()) AS terlambat_tiba,
       SUM(status = 'diterima' AND tanggal_diterima >= CURDATE() - INTERVAL 30 DAY) AS diterima_30,
       SUM(status = 'diterima' AND tanggal_diterima >= CURDATE() - INTERVAL 30 DAY AND target_tiba IS NOT NULL AND tanggal_diterima <= target_tiba) AS tepat_30,
       SUM(status = 'diterima' AND tanggal_diterima >= CURDATE() - INTERVAL 30 DAY AND target_tiba IS NOT NULL) AS bertarget_30
     FROM shipments`,
  )
  const candidates = await shipCandidates()
  const [[tol]] = await db.query<Row[]>("SELECT value FROM app_settings WHERE `key` = 'logistik.toleransi_kirim_hari'")
  const n = (v: unknown) => Number(v ?? 0)
  return NextResponse.json({
    items: rows.map(serializeShipment),
    candidates,
    stats: {
      perlu_kirim: candidates.length, terlambat_kirim: candidates.filter((c) => c.terlambat).length, disiapkan: n(stat.disiapkan), dalam_perjalanan: n(stat.dalam_perjalanan),
      terlambat_tiba: n(stat.terlambat_tiba), diterima_30: n(stat.diterima_30),
      tepat_waktu_pct: n(stat.bertarget_30) ? Math.round((n(stat.tepat_30) / n(stat.bertarget_30)) * 100) : null,
    },
    toleransi_hari: Number(tol?.value ?? 0),
    mulai_pantau: await mulaiPantau(),
    can: { manage: canManageLogistik(user) },
  })
})

// Buat pengiriman (dari SO atau manual); { action: 'pengaturan', hari, mulai } = standar waktu pengiriman & tanggal mulai dipantau
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireLogistik(user, 'pengiriman')
  if (!canManageLogistik(user)) fail(403, 'Pengiriman dikelola Inventory & Logistik / PPIC.')
  const body = await readJson(request)
  if (body.action === 'pengaturan') {
    const v = Number(body.hari)
    if (!Number.isInteger(v) || v < 0 || v > 30) fail(400, 'Toleransi harus 0–30 hari.')
    const mulai = String(body.mulai ?? '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(mulai)) fail(400, 'Tanggal mulai pantau tidak valid.')
    await db.query("INSERT INTO app_settings (`key`, value, updated_by) VALUES ('logistik.mulai_kirim', ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)", [mulai, user.id])
    await db.query(
      "INSERT INTO app_settings (`key`, value, updated_by) VALUES ('logistik.toleransi_kirim_hari', ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)",
      [String(v), user.id],
    )
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ id: await saveShipment(readShipment(body), user.id) })
})
