import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { handle, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canApproveLeave, createLeave, LEAVE_SELECT, leaveBalances, readLeave, requireLeave, serializeLeave, todayWib } from '@/lib/leave'

type Row = RowDataPacket & Record<string, unknown>

// Izin & Cuti: ?status=menunggu|semua &tahun= &q= ; HRD / GM melihat semua, lainnya pengajuan yang dibuatnya
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireLeave(user)
  const p = new URL(request.url).searchParams
  const hr = canApproveLeave(user)
  const today = todayWib()
  const tahun = Number(p.get('tahun')) || Number(today.slice(0, 4))
  const q = str(p.get('q'), 100)
  const where = ["(YEAR(l.tanggal_mulai) = ? OR l.status = 'diajukan')"]
  const args: unknown[] = [tahun]
  if (!hr) {
    where.push('l.created_by = ?')
    args.push(user.id)
  }
  if (p.get('status') === 'menunggu') where.push("l.status = 'diajukan'")
  if (q) {
    where.push('(l.nama LIKE ? OR l.nip LIKE ? OR l.nomor LIKE ?)')
    args.push(`%${q}%`, `%${q}%`, `%${q}%`)
  }
  const [rows] = await db.query<Row[]>(`${LEAVE_SELECT} WHERE ${where.join(' AND ')} ORDER BY l.status = 'diajukan' DESC, l.tanggal_mulai DESC, l.id DESC LIMIT 1000`, args)
  const [emps] = await db.query<Row[]>("SELECT nip, nama, divisi, jabatan, DATE_FORMAT(tgl_masuk, '%Y-%m-%d') AS tgl_masuk FROM employees WHERE tgl_berhenti IS NULL ORDER BY nama")
  const bal = await leaveBalances(tahun)
  const [[stat]] = await db.query<Row[]>(
    `SELECT SUM(status = 'diajukan') AS menunggu, SUM(status = 'disetujui' AND ? BETWEEN tanggal_mulai AND tanggal_selesai) AS hari_ini,
       SUM(status = 'disetujui' AND tanggal_mulai > ? AND tanggal_mulai <= ? + INTERVAL 7 DAY) AS minggu_ini,
       SUM(IF(status = 'disetujui' AND jenis = 'cuti' AND YEAR(tanggal_mulai) = ?, hari, 0)) AS cuti_tahun
     FROM leave_requests ${hr ? '' : 'WHERE created_by = ?'}`,
    hr ? [today, today, today, tahun] : [today, today, today, tahun, user.id],
  )
  return NextResponse.json({
    items: rows.map(serializeLeave),
    employees: emps.map((e) => ({ nip: String(e.nip), nama: String(e.nama), divisi: (e.divisi as string) ?? null, jabatan: (e.jabatan as string) ?? null, tgl_masuk: (e.tgl_masuk as string) ?? null, cuti: bal.get(String(e.nip)) ?? null })),
    stats: { menunggu: Number(stat?.menunggu ?? 0), hari_ini: Number(stat?.hari_ini ?? 0), minggu_ini: Number(stat?.minggu_ini ?? 0), cuti_tahun: Number(stat?.cuti_tahun ?? 0) },
    tahun, can: { approve: hr },
  })
})

export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireLeave(user)
  return NextResponse.json(await createLeave(readLeave(await readJson(request)), user))
})
