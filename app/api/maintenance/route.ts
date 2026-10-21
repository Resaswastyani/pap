import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { loadPlan, PLAN_SELECT, readPlanInput, serializePlan } from '@/lib/maintenance'
import { technicians } from '@/lib/repairs'
import { canManageTeknik, requireTeknikMenu, todayWib } from '@/lib/teknik'

// Jadwal perawatan: ?status=aktif|terlambat|minggu|nonaktif|semua &machine= &q=
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireTeknikMenu(user, 'perawatan-mesin', 'Perawatan Mesin')
  const params = new URL(request.url).searchParams
  const today = todayWib()
  const where: string[] = []
  const args: unknown[] = [today]
  const status = params.get('status') || 'aktif'
  if (status === 'terlambat') where.push('p.aktif = 1 AND p.berikutnya < ?'), args.push(today)
  else if (status === 'minggu') where.push('p.aktif = 1 AND p.berikutnya <= ? + INTERVAL 7 DAY'), args.push(today)
  else if (status === 'nonaktif') where.push('p.aktif = 0')
  else if (status !== 'semua') where.push('p.aktif = 1')
  const machine = int(params.get('machine'))
  if (machine) where.push('p.machine_id = ?'), args.push(machine)
  const q = str(params.get('q'), 100)
  if (q) where.push('(p.judul LIKE ? OR p.komponen LIKE ? OR m.nama LIKE ? OR m.kode LIKE ?)'), args.push(...Array(4).fill(`%${q}%`))
  const [rows] = await db.query<RowDataPacket[]>(
    `${PLAN_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.aktif DESC, p.berikutnya, m.nama LIMIT 500`,
    args,
  )
  const [[summary]] = await db.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(aktif = 1), 0) AS aktif, COALESCE(SUM(aktif = 1 AND berikutnya < ?), 0) AS terlambat,
       COALESCE(SUM(aktif = 1 AND berikutnya <= ? + INTERVAL 7 DAY), 0) AS minggu,
       (SELECT COUNT(*) FROM maintenance_logs WHERE tanggal > ? - INTERVAL 30 DAY) AS checkup_30,
       (SELECT COUNT(*) FROM maintenance_logs WHERE tanggal > ? - INTERVAL 30 DAY AND hasil <> 'baik') AS temuan_30
     FROM maintenance_plans`,
    [today, today, today, today],
  )
  const [machines] = await db.query<RowDataPacket[]>('SELECT id, kode, nama, tahap, status FROM machines ORDER BY nama')
  // Komponen dari critical point Data Mesin sebagai pilihan saat membuat jadwal
  const [komponen] = await db.query<RowDataPacket[]>('SELECT DISTINCT machine_id, komponen FROM machine_checkpoints ORDER BY machine_id, komponen')
  return NextResponse.json({
    today,
    items: rows.map(serializePlan),
    summary: Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, Number(v ?? 0)])),
    machines,
    komponen,
    technicians: await technicians(),
    can: { manage: canManageTeknik(user) },
  })
})

export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireTeknikMenu(user, 'perawatan-mesin', 'Perawatan Mesin')
  if (!canManageTeknik(user)) fail(403, 'Jadwal perawatan diatur oleh divisi Teknik.')
  const input = await readPlanInput(await readJson(request))
  const [res] = await db.query<ResultSetHeader>(
    'INSERT INTO maintenance_plans (machine_id, judul, komponen, interval_hari, berikutnya, pic_id, catatan, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [input.machineId, input.judul, input.komponen, input.interval, input.berikutnya, input.picId, input.catatan, user.id],
  )
  return NextResponse.json({ id: res.insertId, item: await loadPlan(res.insertId) }, { status: 201 })
})
