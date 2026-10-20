import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { accurate, accurateEnabled } from '@/lib/accurate'
import { storeBomDetail } from '@/lib/accurate-sync'
import { db } from '@/lib/db'
import { canManageFormulations, loadFormulation, readBomInput, readExtras, requireFormulations, saveBomToAccurate, saveExtras } from '@/lib/formulations'

// [id] = id Bill of Material di Accurate
type Ctx = { params: Promise<{ id: string }> }
const bomId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Formulasi tidak ditemukan.')

// Detail: ambil versi terbaru dari Accurate (bila gagal, salinan PAP-MS tetap ditampilkan) + SPK yang memakainya
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireFormulations(user)
  const id = await bomId(ctx)
  if (accurateEnabled()) {
    try {
      const res = await accurate<Record<string, unknown>>('/api/bill-of-material/detail.do', { params: { id } })
      await storeBomDetail(res.d, null)
    } catch (error) {
      console.warn('[bom detail]', (error as Error).message)
    }
  }
  const item = await loadFormulation(id)
  const [jobs] = item.id
    ? await db.query<RowDataPacket[]>(
      `SELECT j.id, j.nomor, j.spk_nomor, j.item_name, j.status, c.name AS customer_name FROM production_jobs j LEFT JOIN customers c ON c.id = j.customer_id
       WHERE j.formulasi_id = ? ORDER BY j.status IN ('selesai', 'batal'), j.id DESC LIMIT 50`,
      [item.id],
    )
    : [[]]
  return NextResponse.json({ item, jobs, can: { manage: canManageFormulations(user) && accurateEnabled() } })
})

// Ubah: { items?, hasil?, deskripsi? } -> disimpan ke Accurate; { jenis_plastik, tingkat_kualitas, catatan, status } -> data PPIC di PAP-MS
export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireFormulations(user)
  if (!canManageFormulations(user)) fail(403, 'Formulasi produk dikelola PPIC.')
  const existing = await loadFormulation(await bomId(ctx))
  const body = await readJson(request)
  if (Array.isArray(body.items)) await saveBomToAccurate(await readBomInput(body, existing), existing)
  await saveExtras(existing.bom_accurate_id, readExtras(body), user.id)
  return NextResponse.json({ item: await loadFormulation(existing.bom_accurate_id) })
})
