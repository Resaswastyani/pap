import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { loadItem, MOVE_SELECT, readItemInput, serializeMove } from '@/lib/tech-items'
import { canManageTeknik, requireTeknikMenu } from '@/lib/teknik'

type Ctx = { params: Promise<{ id: string }> }
const itemId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Barang tidak ditemukan.')

// Detail barang + kartu stok (mutasi terbaru)
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTeknikMenu(user, 'sparepart', 'Sparepart & Peralatan')
  const item = await loadItem(await itemId(ctx))
  const [moves] = await db.query<RowDataPacket[]>(`${MOVE_SELECT} WHERE mv.item_id = ? ORDER BY mv.id DESC LIMIT 200`, [item.id])
  return NextResponse.json({ item, moves: moves.map(serializeMove) })
})

// Ubah data barang (stok diubah lewat mutasi); kirim { aktif } saja untuk menonaktifkan / mengaktifkan kembali
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTeknikMenu(user, 'sparepart', 'Sparepart & Peralatan')
  if (!canManageTeknik(user)) fail(403, 'Data peralatan & sparepart diatur oleh divisi Teknik.')
  const item = await loadItem(await itemId(ctx))
  const body = await readJson(request)
  if (Object.keys(body).length === 1 && 'aktif' in body) {
    await db.query('UPDATE tech_items SET aktif = ? WHERE id = ?', [body.aktif ? 1 : 0, item.id])
  } else {
    const input = await readItemInput(body)
    await db.query(
      `UPDATE tech_items SET kode = ?, nama = ?, jenis = ?, kategori = ?, machine_id = ?, satuan = ?, stok_minimum = ?, lokasi = ?, kondisi = ?, catatan = ? WHERE id = ?`,
      [input.kode, input.nama, input.jenis, input.kategori, input.machineId, input.satuan, input.stokMinimum, input.lokasi, input.kondisi, input.catatan, item.id],
    )
  }
  return NextResponse.json({ item: await loadItem(item.id) })
})
