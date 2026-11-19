import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { requireMenu } from '@/lib/customers'
import { db } from '@/lib/db'
import { canViewProduction } from '@/lib/production'
import { canPlanShifts, loadPlanShifts, readShiftRows } from '@/lib/production-plan-shifts'

type Ctx = { params: Promise<{ id: string; lineId: string }> }

// Simpan pembagian shift satu baris formula MP (menggantikan pembagian sebelumnya; kosong = hapus semua)
export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireMenu(user, canViewProduction(user))
  if (!canPlanShifts(user)) fail(403, 'Pembagian shift diatur PPIC / Kepala Produksi.')
  const params = await ctx.params
  const moId = int(params.id) ?? fail(404, 'Rencana produksi tidak ditemukan.')
  const lineId = int(params.lineId) ?? fail(404, 'Formula produksi tidak ditemukan.')
  const [[line]] = await db.query<(RowDataPacket & { number: string | null; item_name: string | null; quantity: string | null; unit: string | null })[]>(
    `SELECT mo.number, l.item_name, l.quantity, l.unit FROM accurate_manufacture_order_items l
     JOIN accurate_manufacture_orders mo ON mo.accurate_id = l.mo_accurate_id WHERE l.mo_accurate_id = ? AND l.line_id = ?`,
    [moId, lineId],
  )
  if (!line) fail(404, 'Formula produksi tidak ditemukan.')
  const rows = readShiftRows(await readJson(request))

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('DELETE FROM production_plan_shifts WHERE mo_accurate_id = ? AND line_id = ?', [moId, lineId])
    if (rows.length) {
      await conn.query(
        'INSERT INTO production_plan_shifts (mo_accurate_id, line_id, shift, tanggal, quantity, unit_price, catatan, created_by, updated_by) VALUES ?',
        [rows.map((r) => [moId, lineId, r.shift, r.tanggal, r.quantity, r.unit_price, r.catatan, user.id, user.id])],
      )
    }
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }

  const ringkas = rows.map((r) => `Shift ${r.shift} ${r.quantity.toLocaleString('id-ID')}${line.unit ? ` ${line.unit}` : ''}`).join(', ')
  await logActivity(request, user, {
    module: 'Rencana Produksi', action: 'update', entity: null,
    description: `Pembagian shift ${line.number ?? moId} · ${line.item_name ?? ''}: ${ringkas || 'dikosongkan'}`,
  })
  return NextResponse.json({ ok: true, shifts: (await loadPlanShifts([moId])).get(`${moId}:${lineId}`) ?? [] })
})
