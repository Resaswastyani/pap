import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canSyncDamageLog, damageSheetDelete, damageSheetUpdate, readDamageInput, requireDamageLog, syncDamageSheet, type DamageRow } from '@/lib/damage-log'
import { canHandleRepair } from '@/lib/repairs'
import { trySheet } from '@/lib/sheet-write'
import type { UserProfile } from '@/lib/users'

type Ctx = { params: Promise<{ id: string }> }

// Isian form: pengisinya atau Teknik/GM. Baris dari spreadsheet: pengelola rekap (Teknik, GM, kepala Produksi/PPIC);
// perubahan ikut ditulis ke baris asalnya di spreadsheet.
async function editable(user: UserProfile, ctx: Ctx) {
  const id = int((await ctx.params).id) ?? fail(404, 'Data tidak ditemukan.')
  const [[row]] = await db.query<(RowDataPacket & DamageRow & { created_by: number | null })[]>(
    'SELECT id, source, sheet_tab, sheet_row, no_laporan, tanggal, mesin, mesin_key, komponen, kerusakan, tindakan, keterangan, created_by FROM machine_damage_logs WHERE id = ?',
    [id],
  )
  if (!row) fail(404, 'Data tidak ditemukan.')
  if (row.source === 'sheet' ? !canSyncDamageLog(user) : row.created_by !== user.id && !canHandleRepair(user)) {
    fail(403, 'Hanya pengisi laporan atau Teknik yang bisa mengubah data ini.')
  }
  return row
}

export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireDamageLog(user)
  const old = await editable(user, ctx)
  const v = readDamageInput(await readJson(request))
  await db.query(
    'UPDATE machine_damage_logs SET tanggal = ?, mesin = ?, mesin_key = ?, komponen = ?, kerusakan = ?, tindakan = ?, keterangan = ? WHERE id = ?',
    [v.tanggal, v.mesin, v.mesin_key, v.komponen, v.kerusakan, v.tindakan, v.keterangan, old.id],
  )
  // Tulis ke spreadsheet (isian form yang belum ada di sheet ditambahkan sebagai baris baru), lalu sinkron ulang
  const warning = await trySheet('rekap kerusakan', async () => {
    await damageSheetUpdate(old, v)
    if (old.source !== 'sheet') await db.query('DELETE FROM machine_damage_logs WHERE id = ?', [old.id])
    await syncDamageSheet()
  })
  return NextResponse.json({ ok: true, warning })
})

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireDamageLog(user)
  const old = await editable(user, ctx)
  await db.query('DELETE FROM machine_damage_logs WHERE id = ?', [old.id])
  const warning = old.source === 'sheet'
    ? await trySheet('rekap kerusakan', async () => {
      await damageSheetDelete(old)
      await syncDamageSheet()
    })
    : null
  return NextResponse.json({ ok: true, warning })
})
