import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { loadItem } from '@/lib/tech-items'
import { canManageTeknik, canProcessPurchase, decimal, isDate, MOVE_JENIS, moveStock, requireTeknikMenu, todayWib, type MoveJenis } from '@/lib/teknik'

type Ctx = { params: Promise<{ id: string }> }

// Mutasi stok: { jenis: masuk|keluar|penyesuaian, jumlah, tanggal, keterangan, repair_id }
// penyesuaian = stok opname: "jumlah" adalah stok hasil hitung fisik, selisihnya dicatat.
// Teknik mencatat semua jenis; Purchasing boleh mencatat barang masuk.
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTeknikMenu(user, 'sparepart', 'Sparepart & Peralatan')
  const item = await loadItem(int((await ctx.params).id) ?? fail(404, 'Barang tidak ditemukan.'))
  const body = await readJson(request)
  const jenis = str(body.jenis, 20) as MoveJenis
  if (!(jenis in MOVE_JENIS)) fail(400, 'Pilih jenis mutasi.')
  if (!canManageTeknik(user) && !(jenis === 'masuk' && canProcessPurchase(user))) fail(403, 'Mutasi stok dicatat oleh divisi Teknik.')
  if (!item.aktif) fail(400, 'Barang ini sudah nonaktif.')
  const tanggal = str(body.tanggal, 10) || todayWib()
  if (!isDate(tanggal)) fail(400, 'Tanggal tidak valid.')
  const angka = decimal(body.jumlah, jenis === 'penyesuaian' ? 'Stok hasil hitung' : 'Jumlah')
  if (jenis !== 'penyesuaian' && angka <= 0) fail(400, 'Jumlah harus lebih dari 0.')
  const jumlah = jenis === 'penyesuaian' ? angka - item.stok : angka
  if (jenis === 'penyesuaian' && jumlah === 0) fail(400, 'Stok hasil hitung sama dengan stok tercatat.')
  let repairId: number | null = null
  if (jenis === 'keluar' && body.repair_id) {
    repairId = int(body.repair_id)
    const [[r]] = await db.query<RowDataPacket[]>('SELECT id FROM machine_repairs WHERE id = ?', [repairId])
    if (!r) fail(400, 'Laporan perbaikan tidak ditemukan.')
  }
  const stok = await moveStock({ itemId: item.id, jenis, jumlah, tanggal, keterangan: str(body.keterangan, 500) || null, repairId, userId: user.id })
  return NextResponse.json({ stok, item: await loadItem(item.id) }, { status: 201 })
})
