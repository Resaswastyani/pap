import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import {
  addInventarisLog, assertKodeFree, canManageInventaris, INV_KONDISI, loadInventaris, LOG_SELECT, readInventarisInput, requireInventaris,
  requireInventarisManage, serializeLog,
} from '@/lib/inventaris'
import { softDelete } from '@/lib/recycle-bin'

type Ctx = { params: Promise<{ id: string }> }
const itemId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Barang inventaris tidak ditemukan.')

// Detail barang + riwayat
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireInventaris(user)
  const item = await loadInventaris(await itemId(ctx))
  const [logs] = await db.query<RowDataPacket[]>(`${LOG_SELECT} WHERE l.item_id = ? ORDER BY l.tanggal DESC, l.id DESC LIMIT 300`, [item.id])
  return NextResponse.json({ item, logs: logs.map(serializeLog), can: { manage: canManageInventaris(user) } })
})

// Ubah data barang (perubahan lokasi / pemegang / kondisi otomatis masuk riwayat),
// atau { status: 'dihapuskan', alasan } / { status: 'aktif' } untuk menghapuskan / mengaktifkan kembali
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireInventarisManage(user)
  const item = await loadInventaris(await itemId(ctx))
  const body = await readJson(request)

  if ('status' in body && Object.keys(body).every((k) => k === 'status' || k === 'alasan')) {
    if (body.status === 'dihapuskan') {
      const alasan = str(body.alasan, 1000)
      if (!alasan) fail(400, 'Tulis alasan penghapusan (mis. dijual, rusak berat, hilang).')
      await db.query("UPDATE ga_inventaris SET status = 'dihapuskan' WHERE id = ?", [item.id])
      await addInventarisLog({ itemId: item.id, jenis: 'penghapusan', keterangan: `Dihapuskan dari inventaris: ${alasan}`, userId: user.id })
    } else {
      await db.query("UPDATE ga_inventaris SET status = 'aktif' WHERE id = ?", [item.id])
      await addInventarisLog({ itemId: item.id, jenis: 'catatan', keterangan: 'Diaktifkan kembali di inventaris', userId: user.id })
    }
    return NextResponse.json({ item: await loadInventaris(item.id) })
  }

  const input = await readInventarisInput(body)
  const kode = input.kode ?? item.kode
  if (kode !== item.kode) await assertKodeFree(kode, item.id)
  await db.query(
    `UPDATE ga_inventaris SET kode = ?, nama = ?, kategori = ?, merek = ?, nomor_seri = ?, lokasi = ?, pemegang_id = ?, pemegang_lain = ?,
       tanggal_beli = ?, harga_beli = ?, kondisi = ?, catatan = ? WHERE id = ?`,
    [kode, input.nama, input.kategori, input.merek, input.nomorSeri, input.lokasi, input.pemegangId, input.pemegangLain,
      input.tanggalBeli, input.hargaBeli, input.kondisi, input.catatan, item.id],
  )
  const after = await loadInventaris(item.id)
  const holder = (r: typeof item) => r.pemegang_nama ?? r.pemegang_lain ?? null
  const moves = [
    (item.lokasi ?? null) !== (after.lokasi ?? null) && `Lokasi: ${item.lokasi ?? '—'} → ${after.lokasi ?? '—'}`,
    holder(item) !== holder(after) && `Pemegang: ${holder(item) ?? '—'} → ${holder(after) ?? '—'}`,
  ].filter(Boolean)
  if (moves.length) await addInventarisLog({ itemId: item.id, jenis: 'mutasi', keterangan: moves.join('; '), userId: user.id })
  if (item.kondisi !== after.kondisi) {
    await addInventarisLog({ itemId: item.id, jenis: 'kondisi', keterangan: `Kondisi: ${INV_KONDISI[item.kondisi as keyof typeof INV_KONDISI]} → ${INV_KONDISI[after.kondisi as keyof typeof INV_KONDISI]}`, userId: user.id })
  }
  return NextResponse.json({ item: after })
})

// Hapus data (salah input) -> masuk Data Terhapus, bisa dipulihkan
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireInventarisManage(user)
  const id = await itemId(ctx)
  await softDelete({ table: 'ga_inventaris', id, modul: 'Inventaris', user })
  return NextResponse.json({ ok: true })
})
