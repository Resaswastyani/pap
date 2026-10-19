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
  // Isi SPK: target hasil, formulasi / campuran bahan, tingkat kualitas, acuan kerja. SPK yang sudah terbit dikunci: tarik dulu untuk merevisi.
  const spkFields = ['target_qty', 'formulasi', 'tingkat_kualitas', 'acuan_kerja'].filter((key) => key in body)
  if (spkFields.length && job.spk_nomor && body.tarik_spk !== true) fail(400, 'SPK sudah terbit. Tarik SPK dulu untuk merevisi isinya.')
  if ('target_qty' in body) {
    const raw = body.target_qty === null || body.target_qty === '' ? null : Number(String(body.target_qty).replace(',', '.'))
    if (raw !== null && (!Number.isFinite(raw) || raw <= 0)) fail(400, 'Target jumlah produksi tidak valid.')
    sets.push('target_qty = ?'), args.push(raw)
  }
  if ('formulasi' in body) sets.push('formulasi = ?'), args.push(str(body.formulasi, 10000) || null)
  if ('tingkat_kualitas' in body) sets.push('tingkat_kualitas = ?'), args.push(str(body.tingkat_kualitas, 100) || null)
  if ('acuan_kerja' in body) sets.push('acuan_kerja = ?'), args.push(str(body.acuan_kerja, 10000) || null)
  // Terbitkan SPK: nomor SPK-YYYYMM-<id job>, terbit ulang setelah ditarik diberi akhiran revisi (-R1, -R2, ...)
  if (body.terbitkan_spk === true) {
    if (job.status === 'batal') fail(400, 'Job yang dibatalkan tidak bisa diterbitkan SPK-nya.')
    if (!job.spk_nomor) {
      sets.push("spk_nomor = CONCAT('SPK-', DATE_FORMAT(NOW(), '%Y%m'), '-', LPAD(id, 5, '0'), IF(spk_revisi > 0, CONCAT('-R', spk_revisi), '')), spk_terbit_at = NOW(), spk_terbit_oleh = ?")
      args.push(user.id)
    }
  }
  // Tarik SPK: SPK dicabut untuk direvisi, job produksi & laporan hasilnya tetap berjalan
  if (body.tarik_spk === true) {
    if (!job.spk_nomor) fail(400, 'SPK job ini belum terbit.')
    const alasan = str(body.alasan_tarik, 500)
    if (!alasan) fail(400, 'Tuliskan alasan menarik SPK.')
    sets.push('spk_nomor = NULL, spk_terbit_at = NULL, spk_terbit_oleh = NULL, spk_revisi = spk_revisi + 1, spk_ditarik_at = NOW(), spk_ditarik_oleh = ?, spk_alasan_tarik = ?')
    args.push(user.id, alasan)
  }
  // Batalkan produksi: job dihentikan di PAP-MS saja, Sales Order di Accurate tidak berubah
  if (body.batal === true) sets.push("status = 'batal'")
  if (sets.length) await db.query(`UPDATE production_jobs SET ${sets.join(', ')}, updated_by = ? WHERE id = ?`, [...args, user.id, job.id])
  if (body.batal === false && job.status === 'batal') {
    await db.query("UPDATE production_jobs SET status = 'menunggu', updated_by = ? WHERE id = ?", [user.id, job.id])
    await refreshJobStatus(job.id)
  }
  return NextResponse.json({ item: await loadJob(job.id) })
})
