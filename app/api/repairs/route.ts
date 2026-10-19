import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canHandleRepair, canReportRepair, createRepair, loadRepair, readRepairInput, REPAIR_SELECT, REPAIR_STATUS, requireRepairs, serializeRepair, technicians } from '@/lib/repairs'

// Daftar laporan kerusakan: ?status=terbuka (default) | semua | baru | dikerjakan | ... &machine=ID &q=
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireRepairs(user)
  const params = new URL(request.url).searchParams
  const where: string[] = []
  const args: unknown[] = []
  const status = params.get('status') ?? 'terbuka'
  if (status === 'terbuka') where.push("r.status IN ('baru', 'dikerjakan', 'menunggu_part')")
  else if (status in REPAIR_STATUS) where.push('r.status = ?'), args.push(status)
  const machine = int(params.get('machine'))
  if (machine) where.push('r.machine_id = ?'), args.push(machine)
  if (params.get('saya') === '1') where.push('(r.teknisi_id = ? OR r.reported_by = ?)'), args.push(user.id, user.id)
  const q = str(params.get('q'), 100)
  if (q) where.push('(r.nomor LIKE ? OR m.nama LIKE ? OR m.kode LIKE ? OR r.keluhan LIKE ?)'), args.push(...Array(4).fill(`%${q}%`))
  const [items] = await db.query<RowDataPacket[]>(
    `${REPAIR_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY FIELD(r.status, 'baru', 'dikerjakan', 'menunggu_part', 'selesai', 'batal'), FIELD(r.prioritas, 'darurat', 'tinggi', 'normal'), r.created_at DESC
     LIMIT 300`,
    args,
  )
  const [[summary]] = await db.query<RowDataPacket[]>(
    `SELECT SUM(status IN ('baru', 'dikerjakan', 'menunggu_part')) AS terbuka,
       SUM(status IN ('baru', 'dikerjakan', 'menunggu_part') AND prioritas = 'darurat') AS darurat,
       SUM(status = 'baru') AS baru,
       SUM(status = 'selesai' AND selesai_at >= NOW() - INTERVAL 30 DAY) AS selesai_30,
       ROUND(AVG(IF(status = 'selesai' AND selesai_at >= NOW() - INTERVAL 30 DAY, TIMESTAMPDIFF(MINUTE, created_at, selesai_at), NULL))) AS rata_menit
     FROM machine_repairs`,
  )
  const [[stopped]] = await db.query<(RowDataPacket & { n: number })[]>(
    "SELECT COUNT(DISTINCT machine_id) AS n FROM machine_repairs WHERE mesin_berhenti = 1 AND status IN ('baru', 'dikerjakan', 'menunggu_part')",
  )
  const [machines] = await db.query<RowDataPacket[]>("SELECT id, kode, nama, tahap, status FROM machines WHERE status <> 'nonaktif' OR id IN (SELECT machine_id FROM machine_repairs) ORDER BY tahap, nama")
  return NextResponse.json({
    items: items.map(serializeRepair),
    summary: { ...Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, Number(v ?? 0)])), mesin_berhenti: Number(stopped.n) },
    machines,
    technicians: canHandleRepair(user) ? await technicians() : [],
    can: { report: canReportRepair(user), handle: canHandleRepair(user) },
  })
})

// Lapor kerusakan mesin: { machine_id, keluhan, prioritas, mesin_berhenti }
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  if (!canReportRepair(user)) fail(403, 'Anda tidak punya akses untuk melaporkan kerusakan mesin.')
  const id = await createRepair(readRepairInput(await readJson(request)), user)
  return NextResponse.json({ item: await loadRepair(id) }, { status: 201 })
})
