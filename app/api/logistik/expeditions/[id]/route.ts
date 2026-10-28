import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageLogistik, readRoute, requireLogistik } from '@/lib/logistik'
import { canEditExpeditions } from '@/lib/orders'
import { softDelete } from '@/lib/recycle-bin'

type Ctx = { params: Promise<{ id: string }> }
async function guard(ctx: Ctx) {
  const user = await requireUser()
  requireLogistik(user, 'ekspedisi')
  if (!canManageLogistik(user) && !canEditExpeditions(user)) fail(403, 'Ekspedisi dikelola Inventory & Logistik / PPIC / Marketing.')
  return { user, id: int((await ctx.params).id) ?? fail(404, 'Ekspedisi tidak ditemukan.') }
}

// Riwayat tarif rute ini dari SO
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireLogistik(user, 'ekspedisi')
  const id = int((await ctx.params).id) ?? fail(404, 'Ekspedisi tidak ditemukan.')
  const [rates] = await db.query<RowDataPacket[]>(
    `SELECT id, sumber, so_number, DATE_FORMAT(tanggal, '%Y-%m-%d') AS tanggal, kota, provinsi, tarif_per_kg, estimasi_min, estimasi_max
     FROM expedition_rates WHERE expedition_id = ? ORDER BY tanggal DESC, id DESC LIMIT 300`,
    [id],
  )
  return NextResponse.json({ rates: rates.map((r) => ({ ...r, tarif_per_kg: r.tarif_per_kg === null ? null : Number(r.tarif_per_kg) })) })
})

// Ubah: baris otomatis yang diubah manual menjadi sumber 'manual' (tidak ditimpa sinkron SO lagi)
export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const { user, id } = await guard(ctx)
  const v = readRoute(await readJson(request))
  const [[dup]] = await db.query<RowDataPacket[]>('SELECT id FROM expeditions WHERE nama_key = ? AND tujuan = ? AND id <> ?', [v.nama_key, v.tujuan, id])
  if (dup) fail(400, `Ekspedisi ${v.nama} ke ${v.tujuan} sudah ada.`)
  const keys = Object.keys(v) as (keyof typeof v)[]
  const [res] = await db.query<ResultSetHeader>(
    `UPDATE expeditions SET ${keys.map((k) => `${String(k)} = ?`).join(', ')}, sumber = 'manual', updated_by = ? WHERE id = ?`,
    [...keys.map((k) => v[k]), user.id, id],
  )
  if (!res.affectedRows) fail(404, 'Ekspedisi tidak ditemukan.')
  return NextResponse.json({ ok: true })
})

// Hapus bila belum dipakai pengiriman / quotation; selain itu dinonaktifkan
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const { id } = await guard(ctx)
  const [[used]] = await db.query<RowDataPacket[]>(
    'SELECT (SELECT COUNT(*) FROM shipments WHERE expedition_id = ?) + (SELECT COUNT(*) FROM quotations WHERE expedition_id = ?) AS n', [id, id],
  )
  if (Number(used.n)) {
    await db.query('UPDATE expeditions SET aktif = 0 WHERE id = ?', [id])
    return NextResponse.json({ ok: true, nonaktif: true })
  }
  await softDelete({ table: 'expeditions', id, modul: 'Ekspedisi', user: await requireUser() })
  return NextResponse.json({ ok: true })
})
