import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { checkpointSheetCreate } from '@/lib/machine-sheet'
import { canManageMachines } from '@/lib/production'
import { sheetStrict } from '@/lib/sheet-write'

type Ctx = { params: Promise<{ id: string }> }

// Tambah langkah critical point: { komponen, teks, keterangan, link } -> ditulis ke spreadsheet Mapping Teknis Mesin, lalu sinkron ulang
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  if (!canManageMachines(user)) fail(403, 'Critical point dikelola PPIC & Teknik.')
  const id = int((await ctx.params).id) ?? fail(404, 'Mesin tidak ditemukan.')
  const body = await readJson(request)
  const komponen = str(body.komponen, 150) || fail(400, 'Isi nama komponen.')
  const teks = str(body.teks, 5000) || fail(400, 'Isi langkah perawatan.')
  const link = str(body.link, 1000) || null
  if (link && !/^https?:\/\//i.test(link)) fail(400, 'Link harus diawali http:// atau https://')
  await sheetStrict(() => checkpointSheetCreate(id, komponen, { teks, keterangan: str(body.keterangan, 2000) || null, link }))
  return NextResponse.json({ ok: true })
})
