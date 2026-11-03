import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { canEditCycle, loadCustomer, readCycleInput } from '@/lib/customers'

type Ctx = { params: Promise<{ id: string }> }

// Isi / ubah cycle order customer secara manual (hari atau bulan); kosong = kembali ke hasil analisis otomatis.
// Dipakai dari menu Customer dan Repeat Order oleh tim marketing / pengelola customer.
export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  if (!canEditCycle(user)) fail(403, 'Cycle order diatur oleh tim marketing.')
  const customer = await loadCustomer(int((await ctx.params).id) ?? fail(404, 'Customer tidak ditemukan.'))
  const cycle = readCycleInput(await readJson(request))
  await db.query(
    'UPDATE customers SET cycle_manual_days = ?, cycle_manual_unit = ?, cycle_manual_by = ?, cycle_manual_at = ? WHERE id = ?',
    cycle ? [cycle.days, cycle.unit, user.id, new Date(), customer.id] : [null, null, null, null, customer.id],
  )
  return NextResponse.json({ item: await loadCustomer(customer.id) })
})
