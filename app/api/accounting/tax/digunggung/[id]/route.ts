import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { canManageAccounting, requireAccounting, requireOpen } from '@/lib/accounting'
import { db } from '@/lib/db'
import { readDigunggung } from '@/lib/digunggung'
import { softDelete } from '@/lib/recycle-bin'

type Ctx = { params: Promise<{ id: string }> }

async function load(ctx: Ctx) {
  const id = int((await ctx.params).id) ?? fail(404, 'Faktur digunggung tidak ditemukan.')
  const [[row]] = await db.query<RowDataPacket[]>('SELECT id, masa, nomor FROM tax_digunggung WHERE id = ?', [id])
  if (!row) fail(404, 'Faktur digunggung tidak ditemukan.')
  return row as RowDataPacket & { id: number; masa: string; nomor: string }
}
async function guard() {
  const user = await requireUser()
  requireAccounting(user, 'pajak')
  if (!canManageAccounting(user)) fail(403, 'PPN digunggung dikelola oleh divisi Accounting.')
  return user
}

// Ubah (nomor tetap; masa mengikuti tanggal faktur)
export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const user = await guard()
  const row = await load(ctx)
  const v = readDigunggung(await readJson(request))
  await requireOpen(row.masa, 'PPN digunggung')
  await requireOpen(v.masa, 'PPN digunggung')
  await db.query(
    `UPDATE tax_digunggung SET masa = ?, tanggal = ?, no_faktur_pajak = ?, customer = ?, jatuh_tempo = ?, dpp = ?, dpp_nilai_lain = ?, ppn = ?, total = ?, catatan = ?, updated_by = ? WHERE id = ?`,
    [v.masa, v.tanggal, v.no_faktur_pajak, v.customer, v.jatuh_tempo, v.dpp, v.dpp_nilai_lain, v.ppn, v.total, v.catatan, user.id, row.id],
  )
  return NextResponse.json({ ok: true })
})

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await guard()
  const row = await load(ctx)
  await requireOpen(row.masa, 'PPN digunggung')
  await softDelete({ table: 'tax_digunggung', id: row.id, modul: 'Pajak', label: `PPN digunggung ${row.nomor}`, user })
  return NextResponse.json({ ok: true })
})
