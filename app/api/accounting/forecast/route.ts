import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { canManageAccounting, forecast, requireAccounting } from '@/lib/accounting'
import { db } from '@/lib/db'
import { readPlan } from '@/lib/accounting-input'

export const maxDuration = 60

// Forecast arus kas 13 minggu + daftar rencana kas
export const GET = handle(async () => {
  const user = await requireUser()
  requireAccounting(user, 'arus-kas')
  const [plans] = await db.query<RowDataPacket[]>(
    `SELECT p.id, p.jenis, p.kategori, p.keterangan, p.tanggal, p.nominal, p.berulang, p.sampai, p.aktif, u.name AS created_name
     FROM cash_plans p LEFT JOIN users u ON u.id = p.created_by ORDER BY p.aktif DESC, p.tanggal`,
  )
  return NextResponse.json({ ...(await forecast()), plans: plans.map((p) => ({ ...p, nominal: Number(p.nominal), aktif: !!p.aktif })), can: { manage: canManageAccounting(user) } })
})

// Tambah rencana kas (gaji, cicilan, sewa, pajak, pemasukan lain)
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireAccounting(user, 'arus-kas')
  if (!canManageAccounting(user)) fail(403, 'Rencana kas dikelola oleh divisi Accounting.')
  const v = readPlan(await readJson(request))
  const [res] = await db.query<ResultSetHeader>(
    'INSERT INTO cash_plans (jenis, kategori, keterangan, tanggal, nominal, berulang, sampai, aktif, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [v.jenis, v.kategori, v.keterangan, v.tanggal, v.nominal, v.berulang, v.sampai, v.aktif, user.id],
  )
  return NextResponse.json({ id: res.insertId })
})
