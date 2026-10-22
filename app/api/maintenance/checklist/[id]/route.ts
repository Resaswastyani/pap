import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canSyncMaintenanceSheet, requireMaintenanceSheet, stepSheetDelete, stepSheetUpdate, type SheetItemRow } from '@/lib/maintenance-sheet'
import { sheetStrict } from '@/lib/sheet-write'
import type { UserProfile } from '@/lib/users'

type Ctx = { params: Promise<{ id: string }> }

async function load(user: UserProfile, ctx: Ctx) {
  requireMaintenanceSheet(user)
  if (!canSyncMaintenanceSheet(user)) fail(403, 'Lembar perawatan dikelola divisi Teknik.')
  const id = int((await ctx.params).id) ?? fail(404, 'Langkah tidak ditemukan.')
  const [[row]] = await db.query<(RowDataPacket & SheetItemRow)[]>(
    'SELECT id, sheet_tab, part_no, part, kelompok, langkah, keterangan, sheet_row FROM maintenance_sheet_items WHERE id = ?', [id],
  )
  return row ?? fail(404, 'Langkah tidak ditemukan. Muat ulang lembar perawatan.')
}

// Ubah langkah maintenance: { langkah, keterangan } -> baris asalnya di spreadsheet, lalu sinkron ulang
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  const old = await load(user, ctx)
  const body = await readJson(request)
  const langkah = str(body.langkah, 2000) || fail(400, 'Isi langkah maintenance.')
  await sheetStrict(() => stepSheetUpdate(old, { langkah, keterangan: str(body.keterangan, 2000) || null }))
  return NextResponse.json({ ok: true })
})

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  const old = await load(user, ctx)
  await sheetStrict(() => stepSheetDelete(old))
  return NextResponse.json({ ok: true })
})
