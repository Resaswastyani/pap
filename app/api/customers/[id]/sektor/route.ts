import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { canManageCustomer, loadCustomer } from '@/lib/customers'
import { db } from '@/lib/db'
import type { RowDataPacket } from 'mysql2'
import { SECTOR_LABEL, SECTORS, sectorSql, type SectorKey } from '@/lib/sectors'

type Ctx = { params: Promise<{ id: string }> }

// Ubah kategori (sektor) customer: { sektor: 'laundry' | 'beras' | 'umum' | 'lainnya' | '' (otomatis) }.
// Disimpan di SIMPAP saja (tidak dikirim ke Accurate) dan tidak tertimpa sinkron.
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  if (!canManageCustomer(user)) fail(403, 'Anda tidak punya akses untuk mengubah kategori customer.')
  const customer = await loadCustomer(int((await ctx.params).id) ?? fail(404, 'Customer tidak ditemukan.'))
  const raw = String((await readJson(request)).sektor ?? '')
  const sektor = SECTORS.some((s) => s.key === raw) ? raw : raw === '' ? null : fail(400, 'Kategori tidak dikenal.')
  await db.query('UPDATE customers SET sektor_manual = ? WHERE id = ?', [sektor, customer.id])
  await logActivity(request, user, {
    module: 'Customer', action: 'update', entity: { type: 'customer', id: customer.id, label: customer.name },
    description: `Kategori ${customer.name}: ${sektor ? SECTOR_LABEL[sektor as keyof typeof SECTOR_LABEL] : 'otomatis'}`,
  })
  // Kategori yang berlaku sekarang (manual, atau hasil identifikasi otomatis)
  const [[row]] = await db.query<RowDataPacket[]>(`SELECT ${sectorSql('c.category')} AS sektor FROM customers c WHERE c.id = ?`, [customer.id])
  const efektif = String(row?.sektor ?? 'umum') as SectorKey
  return NextResponse.json({ ok: true, sektor: efektif, sektor_manual: sektor, toast: `Kategori ${customer.name} diubah menjadi ${SECTOR_LABEL[efektif]}${sektor ? '' : ' (otomatis)'}` })
})
