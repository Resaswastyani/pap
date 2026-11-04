import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { addInventarisLog, INV_KONDISI, loadInventaris, readDate, readMoney, requireInventarisManage, todayWib, type InvKondisi } from '@/lib/inventaris'

type Ctx = { params: Promise<{ id: string }> }

// Catat riwayat manual: { jenis: 'perbaikan' | 'catatan', tanggal, keterangan, biaya, kondisi (opsional: kondisi setelahnya) }
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireInventarisManage(user)
  const item = await loadInventaris(int((await ctx.params).id) ?? fail(404, 'Barang inventaris tidak ditemukan.'))
  const body = await readJson(request)
  const jenis = body.jenis === 'perbaikan' ? 'perbaikan' : 'catatan'
  const keterangan = str(body.keterangan, 5000)
  if (!keterangan) fail(400, jenis === 'perbaikan' ? 'Tulis apa yang diperbaiki.' : 'Tulis catatannya.')
  const tanggal = readDate(body.tanggal, 'Tanggal') ?? todayWib()
  if (tanggal > todayWib()) fail(400, 'Tanggal tidak boleh di masa depan.')
  await addInventarisLog({ itemId: item.id, jenis, keterangan, biaya: jenis === 'perbaikan' ? readMoney(body.biaya, 'Biaya') : null, tanggal, userId: user.id })
  const kondisi = str(body.kondisi, 20) as InvKondisi
  if (kondisi && kondisi in INV_KONDISI && kondisi !== item.kondisi) {
    await db.query('UPDATE ga_inventaris SET kondisi = ? WHERE id = ?', [kondisi, item.id])
    await addInventarisLog({ itemId: item.id, jenis: 'kondisi', keterangan: `Kondisi: ${INV_KONDISI[item.kondisi as InvKondisi]} → ${INV_KONDISI[kondisi]}`, tanggal, userId: user.id })
  }
  return NextResponse.json({ ok: true }, { status: 201 })
})
