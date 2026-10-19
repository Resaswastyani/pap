import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { requireMenu } from '@/lib/customers'
import { db } from '@/lib/db'
import { canManageProduction, canProgressProduction, canViewProduction, loadJob, loadStages, refreshJobStatus } from '@/lib/production'
import { loadProductFiles } from '@/lib/products'

type Ctx = { params: Promise<{ id: string }> }

// Detail job: tahap, spesifikasi & desain produk (acuan produksi)
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireMenu(user, canViewProduction(user))
  const job = await loadJob(int((await ctx.params).id) ?? fail(404, 'Job produksi tidak ditemukan.'))
  const [[product]] = job.product_id
    ? await db.query<RowDataPacket[]>('SELECT id, nama, kode, jenis, spesifikasi, bahan, keterangan FROM customer_products WHERE id = ?', [job.product_id])
    : [[null]]
  const [[stock]] = job.item_accurate_id
    ? await db.query<RowDataPacket[]>('SELECT COALESCE(quantity_on_hand, quantity) AS qty, unit FROM accurate_items WHERE accurate_id = ?', [job.item_accurate_id])
    : [[null]]
  return NextResponse.json({
    item: job,
    stages: await loadStages(job.id),
    product,
    files: product ? await loadProductFiles(product.id) : [],
    stock: stock ? { qty: stock.qty === null ? null : Number(stock.qty), unit: stock.unit } : null,
    can: { manage: canManageProduction(user), progress: canProgressProduction(user) },
  })
})

// Prioritas, catatan, batal / aktifkan lagi (PPIC)
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  if (!canManageProduction(user)) fail(403, 'Hanya Kepala PPIC atau General Manager yang dapat mengubah job produksi.')
  const job = await loadJob(int((await ctx.params).id) ?? fail(404, 'Job produksi tidak ditemukan.'))
  const body = await readJson(request)
  const sets: string[] = []
  const args: unknown[] = []
  if ('prioritas' in body) sets.push('prioritas = ?'), args.push(body.prioritas === 'tinggi' ? 'tinggi' : 'normal')
  if ('catatan' in body) sets.push('catatan = ?'), args.push(str(body.catatan, 5000) || null)
  if (body.batal === true) sets.push("status = 'batal'")
  if (sets.length) await db.query(`UPDATE production_jobs SET ${sets.join(', ')}, updated_by = ? WHERE id = ?`, [...args, user.id, job.id])
  if (body.batal === false && job.status === 'batal') {
    await db.query("UPDATE production_jobs SET status = 'menunggu', updated_by = ? WHERE id = ?", [user.id, job.id])
    await refreshJobStatus(job.id)
  }
  return NextResponse.json({ item: await loadJob(job.id) })
})
