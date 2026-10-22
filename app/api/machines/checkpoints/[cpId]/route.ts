import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { checkpointSheetDelete, checkpointSheetUpdate, type CheckpointRow } from '@/lib/machine-sheet'
import { canManageMachines } from '@/lib/production'
import { sheetStrict } from '@/lib/sheet-write'
import type { UserProfile } from '@/lib/users'

type Ctx = { params: Promise<{ cpId: string }> }

async function load(user: UserProfile, ctx: Ctx) {
  if (!canManageMachines(user)) fail(403, 'Critical point dikelola PPIC & Teknik.')
  const id = int((await ctx.params).cpId) ?? fail(404, 'Critical point tidak ditemukan.')
  const [[row]] = await db.query<(RowDataPacket & CheckpointRow)[]>(
    'SELECT id, machine_id, komponen, komponen_urut, jenis, urut, teks, keterangan, link, sheet_ref FROM machine_checkpoints WHERE id = ?', [id],
  )
  return row ?? fail(404, 'Critical point tidak ditemukan. Muat ulang data mesin.')
}

// Ubah langkah / catatan: { teks, keterangan, link } -> baris asalnya di spreadsheet, lalu sinkron ulang
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  const old = await load(user, ctx)
  const body = await readJson(request)
  const teks = str(body.teks, 5000) || fail(400, 'Isi langkah perawatan.')
  const link = str(body.link, 1000) || null
  if (link && !/^https?:\/\//i.test(link)) fail(400, 'Link harus diawali http:// atau https://')
  await sheetStrict(() => checkpointSheetUpdate(old, { teks, keterangan: str(body.keterangan, 2000) || null, link }))
  return NextResponse.json({ ok: true })
})

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  const old = await load(user, ctx)
  await sheetStrict(() => checkpointSheetDelete(old))
  return NextResponse.json({ ok: true })
})
