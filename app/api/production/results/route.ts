import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { requireMenu } from '@/lib/customers'
import { db } from '@/lib/db'
import { canManageProduction, canProgressProduction, canQcProduction, canViewProduction, GOOD_QTY_SQL } from '@/lib/production'
import { currentShift, readResultInput, refreshStageProgress, RESULT_SELECT, serializeResult } from '@/lib/production-results'

// Laporan hasil produksi: ?tanggal=YYYY-MM-DD (default tanggal shift berjalan) &shift=1|2|3 &qc=menunggu, atau ?job=ID (semua laporan job)
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireMenu(user, canViewProduction(user))
  const params = new URL(request.url).searchParams
  const now = currentShift()
  const job = int(params.get('job'))
  const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(params.get('tanggal') ?? '') ? params.get('tanggal')! : now.tanggal
  const where: string[] = []
  const args: unknown[] = []
  if (job) where.push('r.job_id = ?'), args.push(job)
  else if (params.get('qc') === 'menunggu') where.push("r.status_qc = 'menunggu'")
  else where.push('r.tanggal = ?'), args.push(tanggal)
  const shift = int(params.get('shift'))
  if (!job && shift && shift >= 1 && shift <= 3) where.push('r.shift = ?'), args.push(shift)
  const [items] = await db.query<RowDataPacket[]>(`${RESULT_SELECT} WHERE ${where.join(' AND ')} ORDER BY r.tanggal DESC, r.shift, s.tahap, r.id LIMIT 500`, args)
  // Rekap per shift & satuan untuk tanggal terpilih
  const [rekap] = await db.query<RowDataPacket[]>(
    `SELECT r.shift, COALESCE(r.satuan, '') AS satuan, COUNT(*) AS laporan, SUM(r.jumlah_hasil) AS hasil, SUM(r.jumlah_reject) AS reject,
       SUM(${GOOD_QTY_SQL}) AS baik, SUM(r.status_qc = 'menunggu') AS menunggu_qc, SUM(r.kendala IS NOT NULL) AS kendala
     FROM production_results r WHERE r.tanggal = ? GROUP BY r.shift, COALESCE(r.satuan, '') ORDER BY r.shift`,
    [tanggal],
  )
  const [[pending]] = await db.query<(RowDataPacket & { n: number })[]>("SELECT COUNT(*) AS n FROM production_results WHERE status_qc = 'menunggu'")
  return NextResponse.json({
    tanggal,
    current: now,
    items: items.map(serializeResult),
    rekap: rekap.map((r) => ({
      shift: Number(r.shift), satuan: r.satuan || null, laporan: Number(r.laporan), hasil: Number(r.hasil ?? 0), reject: Number(r.reject ?? 0),
      baik: Number(r.baik ?? 0), menunggu_qc: Number(r.menunggu_qc ?? 0), kendala: Number(r.kendala ?? 0),
    })),
    pendingQc: Number(pending.n),
    can: { report: canProgressProduction(user), qc: canQcProduction(user), manage: canManageProduction(user) },
  })
})

// Lapor hasil produksi satu tahap untuk satu shift (KA Shift / operator Produksi)
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  if (!canProgressProduction(user)) fail(403, 'Anda tidak punya akses untuk melaporkan hasil produksi.')
  const input = await readResultInput(await readJson(request))
  const [res] = await db.query<ResultSetHeader>(
    `INSERT INTO production_results (job_id, stage_id, tanggal, shift, machine_id, jumlah_hasil, jumlah_reject, satuan, operator, kendala, catatan, reported_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.stage.job_id, input.stage.id, input.tanggal, input.shift, input.machineId, input.hasil, input.reject, input.satuan, input.operator, input.kendala, input.catatan, user.id],
  )
  await refreshStageProgress(input.stage.id)
  const [[item]] = await db.query<RowDataPacket[]>(`${RESULT_SELECT} WHERE r.id = ?`, [res.insertId])
  return NextResponse.json({ item: serializeResult(item) })
})
