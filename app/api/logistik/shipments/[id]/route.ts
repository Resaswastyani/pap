import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canManageLogistik, readShipment, requireLogistik, saveShipment, serializeShipment, setShipmentStatus, SHIPMENT_SELECT, shipmentItems } from '@/lib/logistik'
import { softDelete } from '@/lib/recycle-bin'

type Ctx = { params: Promise<{ id: string }> }
const shipId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Pengiriman tidak ditemukan.')
async function manager() {
  const user = await requireUser()
  requireLogistik(user, 'pengiriman')
  if (!canManageLogistik(user)) fail(403, 'Pengiriman dikelola Inventory & Logistik / PPIC.')
  return user
}

export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireLogistik(user, 'pengiriman')
  const id = await shipId(ctx)
  const [[row]] = await db.query<(RowDataPacket & Record<string, unknown>)[]>(`${SHIPMENT_SELECT} WHERE s.id = ?`, [id])
  if (!row) fail(404, 'Pengiriman tidak ditemukan.')
  return NextResponse.json({ item: serializeShipment(row), items: await shipmentItems(id), can: { manage: canManageLogistik(user) } })
})

// Ubah isi pengiriman
export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const user = await manager()
  return NextResponse.json({ id: await saveShipment(readShipment(await readJson(request)), user.id, await shipId(ctx)) })
})

// Ubah status: { status, tanggal, no_resi, estimasi_hari, penerima }
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await manager()
  await setShipmentStatus(await shipId(ctx), await readJson(request), user.id)
  return NextResponse.json({ ok: true })
})

// Hapus (hanya yang masih packing / batal)
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  await manager()
  await softDelete({
    table: 'shipments', id: await shipId(ctx), modul: 'Pengiriman', user: await requireUser(),
    guard: { sql: "status IN ('packing', 'batal')", params: [], message: 'Hanya pengiriman berstatus Packing / Batal yang bisa dihapus.' },
  })
  return NextResponse.json({ ok: true })
})
