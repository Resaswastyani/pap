import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { canManageCustomer, saveCustomerToAccurate, upsertLocalCustomer } from '@/lib/customers'
import { db } from '@/lib/db'
import { canEditProspect, CLOSED_STATUS, loadProspect, logActivity, PIPELINE, requireMarketing, type ProspectStatus } from '@/lib/marketing'

type Ctx = { params: Promise<{ id: string }> }

// Prospek sudah order: hubungkan ke customer Accurate yang ada ({ customerId }) atau
// buat customer baru di Accurate dari data prospek ({ create: true }). Status naik ke "Order pertama".
export const POST = handle(async (request: Request, { params }: Ctx) => {
  const user = await requireUser()
  requireMarketing(user, 'prospek')
  const prospect = await loadProspect(Number((await params).id), user)
  if (!canEditProspect(user, prospect as never)) fail(403, 'Anda hanya dapat mengubah prospek milik Anda.')
  if (!canManageCustomer(user)) fail(403, 'Anda tidak punya akses untuk membuat customer.')
  const body = await readJson(request)

  let customerId: number
  if (body.create) {
    const input = {
      name: prospect.nama_usaha,
      email: prospect.email,
      mobile_phone: prospect.telepon,
      work_phone: null,
      bill_street: prospect.alamat,
      bill_city: prospect.kota,
      bill_province: null,
      bill_zip: null,
      npwp_no: null,
      notes: [prospect.kontak_nama && `Kontak: ${prospect.kontak_nama}${prospect.kontak_jabatan ? ` (${prospect.kontak_jabatan})` : ''}`, prospect.kebutuhan && `Kebutuhan: ${prospect.kebutuhan}`, 'Dari prospek PAP-MS']
        .filter(Boolean).join('\n'),
    }
    const saved = await saveCustomerToAccurate(input, null)
    customerId = await upsertLocalCustomer(input, saved.accurateId, saved.customerNo)
  } else {
    const [[row]] = await db.query<(RowDataPacket & { id: number })[]>('SELECT id FROM customers WHERE id = ?', [int(body.customerId) ?? 0])
    customerId = row?.id ?? fail(400, 'Pilih customer yang akan dihubungkan.')
  }

  const status = prospect.status as ProspectStatus
  const advance = !CLOSED_STATUS.includes(status) && PIPELINE.indexOf(status) < PIPELINE.indexOf('order_pertama')
  await db.query('UPDATE prospects SET customer_id = ?, status = ? WHERE id = ?', [customerId, advance ? 'order_pertama' : status, prospect.id])
  await logActivity(db, {
    prospectId: prospect.id, customerId, userId: user.id, jenis: 'status',
    hasil: body.create ? 'Customer baru dibuat di Accurate dari data prospek' : 'Dihubungkan ke customer Accurate',
    statusFrom: advance ? status : null, statusTo: advance ? 'order_pertama' : null,
  })
  return NextResponse.json({ customerId })
})
