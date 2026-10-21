import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { canManageCapacity, capacityTotals, loadCapacities, loadCapacityInfo, readCapacityInput, requireCapacity, saveCapacityInfo } from '@/lib/capacity'
import { db } from '@/lib/db'

// Daftar kapasitas produksi + total per jenis plastik + keterangan dokumen
export const GET = handle(async () => {
  const user = await requireUser()
  requireCapacity(user)
  const items = await loadCapacities()
  return NextResponse.json({ items, totals: capacityTotals(items), info: await loadCapacityInfo(), can: { manage: canManageCapacity(user) } })
})

// Tambah baris kapasitas
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireCapacity(user)
  if (!canManageCapacity(user)) fail(403, 'Kapasitas produksi diatur PPIC, kepala Produksi, atau GM.')
  const v = readCapacityInput(await readJson(request))
  const [[last]] = await db.query<(RowDataPacket & { urut: number | null })[]>('SELECT MAX(urut) AS urut FROM production_capacities')
  const [res] = await db.query<ResultSetHeader>(
    `INSERT INTO production_capacities (jenis_plastik, lebar_maks_cm, kapasitas_maks_ton, efisiensi_pct, mesin, jumlah_mesin, catatan, urut, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [v.jenis_plastik, v.lebar_maks_cm, v.kapasitas_maks_ton, v.efisiensi_pct, v.mesin, v.jumlah_mesin, v.catatan, Number(last?.urut ?? 0) + 1, user.id],
  )
  return NextResponse.json({ id: res.insertId })
})

// Ubah keterangan dokumen (judul, tanggal, catatan, penanda tangan)
export const PUT = handle(async (request: Request) => {
  const user = await requireUser()
  requireCapacity(user)
  if (!canManageCapacity(user)) fail(403, 'Kapasitas produksi diatur PPIC, kepala Produksi, atau GM.')
  return NextResponse.json({ info: await saveCapacityInfo(await readJson(request), user.id) })
})
