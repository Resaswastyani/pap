import type { ResultSetHeader } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canEditPrices, readMaterialInput, requireHpp } from '@/lib/hpp'

// Tambah bahan baku: Purchasing / Admin / GM
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireHpp(user)
  if (!canEditPrices(user)) fail(403, 'Hanya Purchasing / Admin / GM yang dapat mengubah bahan baku.')
  const m = readMaterialInput(await readJson(request))
  const [result] = await db.query<ResultSetHeader>(
    'INSERT INTO raw_materials (kode, nama, jenis, satuan, harga, density, keterangan, aktif, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [m.kode, m.nama, m.jenis, m.satuan, m.harga, m.density, m.keterangan, m.aktif, user.id],
  )
  await db.query('INSERT INTO raw_material_prices (material_id, harga, updated_by) VALUES (?, ?, ?)', [result.insertId, m.harga, user.id])
  return NextResponse.json({ id: result.insertId }, { status: 201 })
})
