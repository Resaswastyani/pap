import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser, str } from '@/lib/api'
import { requireMenu } from '@/lib/customers'
import { db } from '@/lib/db'
import { canManageMachines, PRODUCTION_STAGES, readMachineInput } from '@/lib/production'

const canViewMachines = (menus: string[]) => menus.includes('data-mesin') || menus.includes('jadwal-produksi')

// Daftar mesin + beban jadwal (tahap belum selesai yang memakai mesin)
export const GET = handle(async () => {
  const user = await requireUser()
  requireMenu(user, canViewMachines(user.menus))
  const [items] = await db.query<RowDataPacket[]>(
    `SELECT m.*, (SELECT COUNT(*) FROM production_stages s JOIN production_jobs j ON j.id = s.job_id AND j.status <> 'batal'
       WHERE s.machine_id = m.id AND s.status IN ('belum', 'berjalan')) AS antrian,
       (SELECT CONCAT(j.nomor, ' · ', j.item_name) FROM production_stages s JOIN production_jobs j ON j.id = s.job_id
       WHERE s.machine_id = m.id AND s.status = 'berjalan' ORDER BY s.actual_start DESC LIMIT 1) AS sedang_dikerjakan
     FROM machines m ORDER BY FIELD(m.status, 'aktif', 'maintenance', 'nonaktif'), FIELD(m.tahap, 'Blow', 'Cetak', 'Bag making'), m.kode`,
  )
  return NextResponse.json({ items: items.map((m) => ({ ...m, antrian: Number(m.antrian) })), tahap: PRODUCTION_STAGES, canManage: canManageMachines(user) })
})

export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  if (!canManageMachines(user)) fail(403, 'Hanya PPIC / Teknik yang dapat menambah mesin.')
  const input = readMachineInput(await readJson(request))
  const [result] = await db.query<ResultSetHeader>(
    'INSERT INTO machines (kode, nama, tahap, kapasitas, status, keterangan) VALUES (?, ?, ?, ?, ?, ?)',
    [input.kode, input.nama, input.tahap, input.kapasitas, input.status, input.keterangan],
  )
  return NextResponse.json({ id: result.insertId }, { status: 201 })
})
