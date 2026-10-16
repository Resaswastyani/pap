import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canEditExpeditions, canViewExpeditions, readExpeditionInput } from '@/lib/orders'

// Daftar ekspedisi, termurah per kg lebih dulu; ?tujuan= untuk mencari rute
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  if (!canViewExpeditions(user)) fail(403, 'Anda tidak punya akses ke data ekspedisi.')
  const tujuan = str(new URL(request.url).searchParams.get('tujuan'), 100)
  const [items] = await db.query<RowDataPacket[]>(
    `SELECT e.*, u.name AS updated_by_name FROM expeditions e LEFT JOIN users u ON u.id = e.updated_by
     ${tujuan ? 'WHERE e.tujuan LIKE ? OR e.nama LIKE ?' : ''}
     ORDER BY e.aktif DESC, e.tujuan, (e.tarif_per_kg IS NULL), e.tarif_per_kg, e.nama`,
    tujuan ? [`%${tujuan}%`, `%${tujuan}%`] : [],
  )
  return NextResponse.json({
    items: items.map((e) => ({ ...e, tarif_per_kg: e.tarif_per_kg === null ? null : Number(e.tarif_per_kg), minimal_kg: e.minimal_kg === null ? null : Number(e.minimal_kg) })),
    canEdit: canEditExpeditions(user),
  })
})

export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  if (!canEditExpeditions(user)) fail(403, 'Data ekspedisi diubah oleh Marketing / Admin.')
  const e = readExpeditionInput(await readJson(request))
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO expeditions (nama, kontak, telepon, tujuan, tarif_per_kg, minimal_kg, estimasi_hari, keterangan, aktif, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [e.nama, e.kontak, e.telepon, e.tujuan, e.tarif_per_kg, e.minimal_kg, e.estimasi_hari, e.keterangan, e.aktif, user.id],
  )
  return NextResponse.json({ id: result.insertId }, { status: 201 })
})
