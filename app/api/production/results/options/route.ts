import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { handle, requireUser } from '@/lib/api'
import { requireMenu } from '@/lib/customers'
import { db } from '@/lib/db'
import { canViewProduction, GOOD_QTY_SQL } from '@/lib/production'
import { currentShift } from '@/lib/production-results'

// Pilihan form lapor hasil: tahap dari job yang belum selesai (SPK terbit lebih dulu), mesin aktif, & tanggal/shift berjalan
export const GET = handle(async () => {
  const user = await requireUser()
  requireMenu(user, canViewProduction(user))
  const [stages] = await db.query<RowDataPacket[]>(
    `SELECT s.id, s.job_id, s.urutan, s.tahap, s.machine_id, s.status, s.progress, COALESCE(s.target_qty, j.target_qty, j.quantity) AS target,
       COALESCE(s.target_unit, j.unit) AS unit, j.nomor, j.spk_nomor, j.item_name, c.name AS customer_name, j.due_date,
       (SELECT SUM(${GOOD_QTY_SQL}) FROM production_results r WHERE r.stage_id = s.id) AS hasil_baik
     FROM production_stages s JOIN production_jobs j ON j.id = s.job_id LEFT JOIN customers c ON c.id = j.customer_id
     WHERE j.status IN ('menunggu', 'dijadwalkan', 'berjalan') AND s.status <> 'dilewati'
     ORDER BY j.spk_nomor IS NULL, j.due_date IS NULL, j.due_date, j.id, s.urutan
     LIMIT 1500`,
  )
  const [machines] = await db.query<RowDataPacket[]>("SELECT id, kode, nama, tahap FROM machines WHERE status <> 'nonaktif' ORDER BY tahap, nama")
  return NextResponse.json({
    current: currentShift(),
    stages: stages.map((s) => ({ ...s, target: s.target === null ? null : Number(s.target), hasil_baik: s.hasil_baik === null ? null : Number(s.hasil_baik) })),
    machines,
  })
})
