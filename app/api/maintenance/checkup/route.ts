import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { LOG_SELECT, readCheckupInput, serializeLog } from '@/lib/maintenance'
import { canReportRepair, createRepair, REPAIR_PRIORITY, type RepairPriority } from '@/lib/repairs'
import { addDays, CHECKUP_RESULT, canManageTeknik, isDate, requireTeknikMenu } from '@/lib/teknik'

// Riwayat checkup (Dokumen checkup & maintenance mesin): ?machine= &dari= &sampai= &hasil=
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireTeknikMenu(user, 'perawatan-mesin', 'Perawatan Mesin')
  const params = new URL(request.url).searchParams
  const where: string[] = []
  const args: unknown[] = []
  const machine = int(params.get('machine'))
  if (machine) where.push('l.machine_id = ?'), args.push(machine)
  if (isDate(params.get('dari'))) where.push('l.tanggal >= ?'), args.push(params.get('dari'))
  if (isDate(params.get('sampai'))) where.push('l.tanggal <= ?'), args.push(params.get('sampai'))
  const hasil = params.get('hasil')
  if (hasil && hasil in CHECKUP_RESULT) where.push('l.hasil = ?'), args.push(hasil)
  const q = str(params.get('q'), 100)
  if (q) where.push('(l.temuan LIKE ? OR l.tindakan LIKE ? OR p.judul LIKE ? OR m.nama LIKE ?)'), args.push(...Array(4).fill(`%${q}%`))
  const [rows] = await db.query<RowDataPacket[]>(
    `${LOG_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY l.tanggal DESC, l.id DESC LIMIT 500`,
    args,
  )
  return NextResponse.json({ items: rows.map(serializeLog) })
})

// Catat checkup: { plan_id?, machine_id, tanggal, hasil, temuan, tindakan, durasi_menit, lapor_kerusakan?, prioritas?, mesin_berhenti? }
// Checkup terjadwal memajukan jatuh tempo berikutnya = tanggal checkup + interval.
// Hasil "rusak" bisa langsung dilaporkan ke Kerusakan Mesin.
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireTeknikMenu(user, 'perawatan-mesin', 'Perawatan Mesin')
  if (!canManageTeknik(user)) fail(403, 'Checkup perawatan dicatat oleh divisi Teknik.')
  const body = await readJson(request)
  const input = await readCheckupInput(body)
  const lapor = body.lapor_kerusakan === true && input.hasil !== 'baik'
  if (lapor && !canReportRepair(user)) fail(403, 'Anda tidak punya akses ke menu Kerusakan Mesin.')

  const [res] = await db.query<ResultSetHeader>(
    'INSERT INTO maintenance_logs (plan_id, machine_id, tanggal, hasil, temuan, tindakan, durasi_menit, dikerjakan_oleh) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [input.plan?.id ?? null, input.machineId, input.tanggal, input.hasil, input.temuan, input.tindakan, input.durasi, user.id],
  )
  const id = res.insertId
  // Checkup lama yang baru dicatat tidak memundurkan jadwal
  if (input.plan && (!input.plan.terakhir || input.tanggal >= String(input.plan.terakhir).slice(0, 10))) {
    await db.query('UPDATE maintenance_plans SET terakhir = ?, berikutnya = ? WHERE id = ?', [input.tanggal, addDays(input.tanggal, Number(input.plan.interval_hari)), input.plan.id])
  }
  let repairId: number | null = null
  if (lapor) {
    repairId = await createRepair({
      machineId: input.machineId,
      keluhan: `Temuan checkup${input.plan ? ` "${input.plan.judul}"` : ''}: ${input.temuan}`,
      prioritas: typeof body.prioritas === 'string' && body.prioritas in REPAIR_PRIORITY ? (body.prioritas as RepairPriority) : 'normal',
      mesinBerhenti: body.mesin_berhenti === true,
    }, user)
    await db.query('UPDATE maintenance_logs SET repair_id = ? WHERE id = ?', [repairId, id])
  }
  const [[item]] = await db.query<RowDataPacket[]>(`${LOG_SELECT} WHERE l.id = ?`, [id])
  return NextResponse.json({ id, item: serializeLog(item), repairId }, { status: 201 })
})
