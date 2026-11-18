import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageService, createSchedule, listSchedules, listServiceLogs, requireService, serviceSummary } from '@/lib/ga-service'

// Jadwal service + ringkasan + riwayat service setahun (?tahun=YYYY) + pilihan barang & PIC untuk form
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireService(user)
  const tahun = Number(new URL(request.url).searchParams.get('tahun') ?? new Date().getFullYear())
  if (!Number.isInteger(tahun) || tahun < 2000 || tahun > 2100) fail(400, 'Tahun tidak valid.')
  const [items, riwayat] = await Promise.all([listSchedules({ includeInactive: true }), listServiceLogs(tahun)])
  const [barang] = await db.query<RowDataPacket[]>("SELECT id, kode, nama, kategori, lokasi, nomor_seri FROM ga_inventaris WHERE status = 'aktif' ORDER BY kategori, nama")
  const [users] = await db.query<RowDataPacket[]>('SELECT u.id, u.name, d.name AS division_name FROM users u JOIN divisions d ON d.id = u.division_id WHERE u.is_active = 1 ORDER BY u.name')
  const thisYear = Number(new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 4))
  const biaya = (tahun === thisYear ? riwayat : await listServiceLogs(thisYear)).reduce((n, r) => n + (r.biaya ?? 0), 0)
  return NextResponse.json({ items, riwayat, summary: serviceSummary(items, biaya), barang, users, can: { manage: canManageService(user) } })
})

// Tambah jadwal service
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireService(user, true)
  return NextResponse.json({ item: await createSchedule(await readJson(request), user.id) }, { status: 201 })
})
