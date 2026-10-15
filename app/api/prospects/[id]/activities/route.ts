import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { ACTIVITY_TYPES, canEditProspect, loadProspect, logActivity, parseDateTime, PROSPECT_STATUS, requireMarketing, type ProspectStatus } from '@/lib/marketing'

type Ctx = { params: Promise<{ id: string }> }

// Catat follow-up (WA / telepon / email / catatan), opsional sekaligus ubah status & jadwal follow-up berikutnya
export const POST = handle(async (request: Request, { params }: Ctx) => {
  const user = await requireUser()
  requireMarketing(user, 'prospek')
  const prospect = await loadProspect(Number((await params).id), user)
  if (!canEditProspect(user, prospect as never)) fail(403, 'Anda hanya dapat mencatat follow-up prospek milik Anda.')
  const body = await readJson(request)
  const jenis = str(body.jenis, 20)
  if (!(jenis in ACTIVITY_TYPES)) fail(400, 'Jenis aktivitas tidak valid.')
  const hasil = str(body.hasil, 5000)
  if (!hasil) fail(400, 'Isi hasil follow-up.')
  const next = str(body.status, 30) as ProspectStatus
  const changeStatus = next && next !== prospect.status
  if (changeStatus && !(next in PROSPECT_STATUS)) fail(400, 'Status prospek tidak valid.')
  if (changeStatus && next === 'gagal' && !str(body.alasan_gagal, 500)) fail(400, 'Isi alasan prospek gagal.')
  const nextFollowup = parseDateTime(body.next_followup_at, 'Jadwal follow-up')

  await logActivity(db, { prospectId: prospect.id, userId: user.id, jenis, hasil, statusFrom: changeStatus ? prospect.status : null, statusTo: changeStatus ? next : null })
  await db.query(
    `UPDATE prospects SET next_followup_at = ?, status = ?, alasan_gagal = ? WHERE id = ?`,
    [nextFollowup, changeStatus ? next : prospect.status, changeStatus ? (next === 'gagal' ? str(body.alasan_gagal, 500) : null) : prospect.alasan_gagal, prospect.id],
  )
  return NextResponse.json({ ok: true }, { status: 201 })
})
