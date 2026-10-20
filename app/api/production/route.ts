import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { handle, int, requireUser, str, pageParams } from '@/lib/api'
import { requireMenu } from '@/lib/customers'
import { db } from '@/lib/db'
import { canManageProduction, canProgressProduction, canViewProduction, JOB_SELECT, JOB_STATUS, PRODUCTION_SO_MAX_AGE_DAYS, serializeJob } from '@/lib/production'

// Daftar job produksi + ringkasan
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireMenu(user, canViewProduction(user))
  const params = new URL(request.url).searchParams
  const where: string[] = []
  const args: unknown[] = []
  const status = params.get('status')
  if (status === 'aktif') where.push("j.status IN ('menunggu', 'dijadwalkan', 'berjalan')")
  else if (status === 'terlambat') where.push("j.status IN ('menunggu', 'dijadwalkan', 'berjalan') AND j.due_date < CURDATE()")
  else if (status && status in JOB_STATUS) where.push('j.status = ?'), args.push(status)
  const spk = params.get('spk')
  if (spk === 'terbit') where.push('j.spk_nomor IS NOT NULL')
  else if (spk === 'belum') where.push('j.spk_nomor IS NULL')
  const q = str(params.get('q'), 100)
  if (q) where.push('(j.item_name LIKE ? OR j.so_number LIKE ? OR j.nomor LIKE ? OR j.spk_nomor LIKE ? OR c.name LIKE ?)'), args.push(...Array(5).fill(`%${q}%`))
  const machine = int(params.get('machine'))
  if (machine) where.push('EXISTS (SELECT 1 FROM production_stages s WHERE s.job_id = j.id AND s.machine_id = ?)'), args.push(machine)
  const { page, pageSize } = pageParams(params, 50)
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const [items] = await db.query<Parameters<typeof serializeJob>[0][]>(
    `${JOB_SELECT} ${whereSql}
     ORDER BY FIELD(j.status, 'berjalan', 'dijadwalkan', 'menunggu', 'selesai', 'batal'), (j.prioritas = 'tinggi') DESC, j.due_date IS NULL, j.due_date, j.id
     LIMIT ? OFFSET ?`,
    [...args, pageSize, (page - 1) * pageSize],
  )
  const [[{ total }]] = await db.query<(RowDataPacket & { total: number })[]>(
    `SELECT COUNT(*) AS total FROM production_jobs j LEFT JOIN customers c ON c.id = j.customer_id ${whereSql}`,
    args,
  )
  const [[summary]] = await db.query<RowDataPacket[]>(
    `SELECT SUM(status = 'menunggu') AS menunggu, SUM(status = 'dijadwalkan') AS dijadwalkan, SUM(status = 'berjalan') AS berjalan,
       SUM(status IN ('menunggu', 'dijadwalkan', 'berjalan') AND due_date < CURDATE()) AS terlambat,
       SUM(status = 'selesai' AND updated_at >= CURDATE() - INTERVAL 7 DAY) AS selesai_minggu,
       SUM(status IN ('menunggu', 'dijadwalkan', 'berjalan') AND spk_nomor IS NOT NULL) AS spk_aktif,
       SUM(status IN ('menunggu', 'dijadwalkan', 'berjalan') AND spk_nomor IS NULL) AS spk_belum
     FROM production_jobs`,
  )
  return NextResponse.json({
    items: items.map(serializeJob),
    total: Number(total),
    page,
    pageSize,
    summary: Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, Number(v ?? 0)])),
    maxAgeDays: PRODUCTION_SO_MAX_AGE_DAYS,
    can: { manage: canManageProduction(user), progress: canProgressProduction(user) },
  })
})
