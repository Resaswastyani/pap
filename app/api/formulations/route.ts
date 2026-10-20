import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageFormulations, canSeeCost, canViewFormulations, loadFormulation, loadFormulations, PLASTIC_TYPES, readFormulationInput, requireFormulations, saveItems } from '@/lib/formulations'
import { canManageProduction } from '@/lib/production'

// Daftar formulasi: ?status=aktif (default) | arsip | semua &q= ; dipakai juga oleh pilihan formulasi di SPK (PPIC)
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  if (!canViewFormulations(user) && !canManageProduction(user)) fail(403, 'Anda tidak punya akses ke menu Formulasi Produk.')
  const params = new URL(request.url).searchParams
  const where: string[] = []
  const args: unknown[] = []
  const status = params.get('status') ?? 'aktif'
  if (status === 'aktif' || status === 'arsip') where.push('f.status = ?'), args.push(status)
  const q = str(params.get('q'), 100)
  if (q) where.push('(f.kode LIKE ? OR f.nama LIKE ? OR f.jenis_plastik LIKE ? OR p.nama LIKE ? OR c.name LIKE ?)'), args.push(...Array(5).fill(`%${q}%`))
  const items = await loadFormulations(where.length ? `WHERE ${where.join(' AND ')}` : '', args, user)
  const [materials] = await db.query<RowDataPacket[]>("SELECT id, kode, nama, jenis, satuan, aktif FROM raw_materials ORDER BY aktif DESC, FIELD(jenis, 'resin', 'pewarna', 'aditif', 'tinta', 'lainnya'), nama")
  return NextResponse.json({ items, materials, plasticTypes: PLASTIC_TYPES, can: { manage: canManageFormulations(user), cost: canSeeCost(user) } })
})

export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireFormulations(user)
  if (!canManageFormulations(user)) fail(403, 'Formulasi produk dikelola PPIC.')
  const input = await readFormulationInput(await readJson(request))
  const conn = await db.getConnection()
  let id = 0
  try {
    await conn.beginTransaction()
    const [res] = await conn.query<ResultSetHeader>(
      'INSERT INTO formulations (kode, nama, jenis_plastik, tingkat_kualitas, product_id, status, catatan, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [input.kode, input.nama, input.jenis, input.kualitas, input.productId, input.status, input.catatan, user.id],
    )
    id = res.insertId
    await saveItems(conn, id, input.items)
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') fail(409, `Kode formulasi ${input.kode} sudah dipakai.`)
    throw error
  } finally {
    conn.release()
  }
  return NextResponse.json({ item: await loadFormulation(id, user) }, { status: 201 })
})
