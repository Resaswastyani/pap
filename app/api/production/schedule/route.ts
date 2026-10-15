import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, requireUser } from '@/lib/api'
import { requireMenu } from '@/lib/customers'
import { db } from '@/lib/db'
import { canViewProduction } from '@/lib/production'

// Jadwal per mesin: tahap yang direncanakan dalam rentang tanggal (from inklusif, to eksklusif, YYYY-MM-DD)
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireMenu(user, canViewProduction(user))
  const params = new URL(request.url).searchParams
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) fail(400, 'Rentang tanggal tidak valid.')
  const [stages] = await db.query<RowDataPacket[]>(
    `SELECT s.id, s.job_id, s.tahap, s.machine_id, s.plan_start, s.plan_end, s.status, s.progress,
       j.nomor, j.item_name, j.quantity, j.unit, j.due_date, j.prioritas, c.name AS customer_name
     FROM production_stages s
     JOIN production_jobs j ON j.id = s.job_id AND j.status <> 'batal'
     LEFT JOIN customers c ON c.id = j.customer_id
     WHERE s.status <> 'dilewati' AND s.plan_start < ? AND COALESCE(s.plan_end, s.plan_start) >= ?
     ORDER BY s.plan_start`,
    [to, from],
  )
  const [machines] = await db.query<RowDataPacket[]>("SELECT id, kode, nama, tahap, status FROM machines WHERE status <> 'nonaktif' ORDER BY FIELD(tahap, 'Blow', 'Cetak', 'Bag making'), kode")
  return NextResponse.json({ stages: stages.map((s) => ({ ...s, quantity: s.quantity === null ? null : Number(s.quantity) })), machines })
})
