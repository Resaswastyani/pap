import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { readDamageInput, requireDamageLog } from '@/lib/damage-log'
import { canHandleRepair } from '@/lib/repairs'
import type { UserProfile } from '@/lib/users'

type Ctx = { params: Promise<{ id: string }> }

// Hanya isian dari aplikasi yang bisa diubah/dihapus (baris dari Google Drive diubah di spreadsheet), oleh pengisinya atau Teknik/GM
async function editable(user: UserProfile, ctx: Ctx) {
  const id = int((await ctx.params).id) ?? fail(404, 'Data tidak ditemukan.')
  const [[row]] = await db.query<(RowDataPacket & { source: string; created_by: number | null })[]>('SELECT source, created_by FROM machine_damage_logs WHERE id = ?', [id])
  if (!row) fail(404, 'Data tidak ditemukan.')
  if (row.source !== 'app') fail(400, 'Data dari Google Drive diubah langsung di spreadsheet, lalu sinkron ulang.')
  if (row.created_by !== user.id && !canHandleRepair(user)) fail(403, 'Hanya pengisi laporan atau Teknik yang bisa mengubah data ini.')
  return id
}

export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireDamageLog(user)
  const id = await editable(user, ctx)
  const v = readDamageInput(await readJson(request))
  await db.query(
    'UPDATE machine_damage_logs SET tanggal = ?, mesin = ?, mesin_key = ?, komponen = ?, kerusakan = ?, tindakan = ?, keterangan = ? WHERE id = ?',
    [v.tanggal, v.mesin, v.mesin_key, v.komponen, v.kerusakan, v.tindakan, v.keterangan, id],
  )
  return NextResponse.json({ ok: true })
})

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireDamageLog(user)
  const id = await editable(user, ctx)
  await db.query('DELETE FROM machine_damage_logs WHERE id = ?', [id])
  return NextResponse.json({ ok: true })
})
