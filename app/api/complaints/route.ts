import type { ResultSetHeader } from 'mysql2'
import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity'
import { handle, readJson, requireUser } from '@/lib/api'
import { addUpdate, canManageComplaints, listComplaints, loadComplaint, nextComplaintNumber, notifyComplaint, readComplaintInput, requireComplaints } from '@/lib/complaints'
import { db } from '@/lib/db'

// Kendala Customer: daftar + ringkasan (?from&to&status&kategori&prioritas&pic&q)
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireComplaints(user)
  const data = await listComplaints(new URL(request.url).searchParams)
  return NextResponse.json({ ...data, can: { create: true, manage: canManageComplaints(user) } })
})

// Catat keluhan baru
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireComplaints(user)
  const v = await readComplaintInput(await readJson(request))
  const nomor = await nextComplaintNumber()
  const [res] = await db.query<ResultSetHeader>('INSERT INTO customer_complaints SET ?', [{ ...v, nomor, status: 'baru', dilaporkan_oleh: user.id }])
  await addUpdate(res.insertId, user.id, 'sistem', `Keluhan dicatat oleh ${user.name}${v.pic_id ? '' : '. PIC belum ditentukan.'}`, null, 'baru')
  const c = await loadComplaint(res.insertId)
  if (c.pic_id && c.pic_id !== user.id) await notifyComplaint([c.pic_id], c, 'Kendala customer baru untuk Anda', `target ${c.target_selesai ?? '-'}`, 'pic')
  await logActivity(request, user, { module: 'Kendala Customer', action: 'create', entity: { type: 'customer_complaint', id: c.id, label: c.nomor }, description: `Kendala customer ${c.nomor} · ${c.customer_nama} · ${c.judul}` })
  return NextResponse.json({ ok: true, id: c.id, nomor })
})
