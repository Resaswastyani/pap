import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canEditExpeditions, readExpeditionInput } from '@/lib/orders'
import { softDelete } from '@/lib/recycle-bin'

type Ctx = { params: Promise<{ id: string }> }

export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  if (!canEditExpeditions(user)) fail(403, 'Data ekspedisi diubah oleh Marketing / Admin.')
  const id = int((await ctx.params).id) ?? fail(404, 'Ekspedisi tidak ditemukan.')
  const e = readExpeditionInput(await readJson(request))
  await db.query(
    `UPDATE expeditions SET nama = ?, kontak = ?, telepon = ?, tujuan = ?, tarif_per_kg = ?, minimal_kg = ?, estimasi_hari = ?, keterangan = ?, aktif = ?, updated_by = ? WHERE id = ?`,
    [e.nama, e.kontak, e.telepon, e.tujuan, e.tarif_per_kg, e.minimal_kg, e.estimasi_hari, e.keterangan, e.aktif, user.id, id],
  )
  return NextResponse.json({ ok: true })
})

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  if (!canEditExpeditions(user)) fail(403, 'Data ekspedisi diubah oleh Marketing / Admin.')
  await softDelete({ table: 'expeditions', id: int((await ctx.params).id) ?? 0, modul: 'Ekspedisi', user })
  return NextResponse.json({ ok: true })
})
