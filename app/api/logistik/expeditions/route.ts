import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageLogistik, listRoutes, readRoute, requireLogistik } from '@/lib/logistik'
import { canEditExpeditions } from '@/lib/orders'

// Daftar ekspedisi per tujuan (sama dengan Master Data > Ekspedisi), dengan pemakaian dari SO 12 bulan
export const GET = handle(async () => {
  const user = await requireUser()
  requireLogistik(user, 'ekspedisi')
  const [[synced]] = await db.query<(RowDataPacket & { value: string })[]>("SELECT value FROM app_settings WHERE `key` = 'logistik.ekspedisi_synced'")
  return NextResponse.json({ items: await listRoutes(), synced_at: synced?.value ?? null, can: { manage: canManageLogistik(user) || canEditExpeditions(user) } })
})

// Tambah rute ekspedisi (isian manual)
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireLogistik(user, 'ekspedisi')
  if (!canManageLogistik(user) && !canEditExpeditions(user)) fail(403, 'Ekspedisi dikelola Inventory & Logistik / PPIC / Marketing.')
  const v = readRoute(await readJson(request))
  const [[dup]] = await db.query<RowDataPacket[]>('SELECT id FROM expeditions WHERE nama_key = ? AND tujuan = ?', [v.nama_key, v.tujuan])
  if (dup) fail(400, `Ekspedisi ${v.nama} ke ${v.tujuan} sudah ada; ubah baris yang ada.`)
  const keys = Object.keys(v) as (keyof typeof v)[]
  const [res] = await db.query<ResultSetHeader>(`INSERT INTO expeditions (${keys.join(', ')}, sumber, updated_by) VALUES (?)`, [[...keys.map((k) => v[k]), 'manual', user.id]])
  return NextResponse.json({ id: res.insertId })
})
