import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageFormulations, loadFormulation, readFormulationInput, requireFormulations, saveItems } from '@/lib/formulations'

type Ctx = { params: Promise<{ id: string }> }
const formulationId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Formulasi tidak ditemukan.')

export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireFormulations(user)
  const item = await loadFormulation(await formulationId(ctx), user)
  // SPK yang memakai formulasi ini
  const [jobs] = await db.query<RowDataPacket[]>(
    `SELECT j.id, j.nomor, j.spk_nomor, j.item_name, j.status, c.name AS customer_name FROM production_jobs j LEFT JOIN customers c ON c.id = j.customer_id
     WHERE j.formulasi_id = ? ORDER BY j.status IN ('selesai', 'batal'), j.id DESC LIMIT 50`,
    [item.id],
  )
  return NextResponse.json({ item, jobs, can: { manage: canManageFormulations(user) } })
})

// Ubah formulasi; komposisi bahan berubah -> versi naik (SPK yang sudah terbit tetap menyimpan salinan komposisi lama)
export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireFormulations(user)
  if (!canManageFormulations(user)) fail(403, 'Formulasi produk dikelola PPIC.')
  const id = await formulationId(ctx)
  await loadFormulation(id, user)
  const input = await readFormulationInput(await readJson(request))
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query(
      'UPDATE formulations SET kode = ?, nama = ?, jenis_plastik = ?, tingkat_kualitas = ?, product_id = ?, status = ?, catatan = ?, updated_by = ? WHERE id = ?',
      [input.kode, input.nama, input.jenis, input.kualitas, input.productId, input.status, input.catatan, user.id, id],
    )
    if (await saveItems(conn, id, input.items)) await conn.query('UPDATE formulations SET versi = versi + 1 WHERE id = ?', [id])
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') fail(409, `Kode formulasi ${input.kode} sudah dipakai.`)
    throw error
  } finally {
    conn.release()
  }
  return NextResponse.json({ item: await loadFormulation(id, user) })
})

// Hapus hanya bila belum pernah dipakai SPK; selain itu arsipkan
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireFormulations(user)
  if (!canManageFormulations(user)) fail(403, 'Formulasi produk dikelola PPIC.')
  const item = await loadFormulation(await formulationId(ctx), user)
  if (item.dipakai_total) fail(400, `Formulasi sudah dipakai ${item.dipakai_total} SPK. Arsipkan saja agar riwayat SPK tetap utuh.`)
  await db.query('DELETE FROM formulations WHERE id = ?', [item.id])
  return NextResponse.json({ ok: true })
})
