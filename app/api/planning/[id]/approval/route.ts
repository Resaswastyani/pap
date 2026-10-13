import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { PERMISSIONS } from '@/lib/permissions'
import { loadPlanning, planningAbilities, serializePlanning } from '@/lib/planning'

type Ctx = { params: Promise<{ id: string }> }

// Approve / tolak planning (lead divisi, admin, super admin)
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser(PERMISSIONS.planningApprove)
  const row = await loadPlanning(user, int((await ctx.params).id) ?? fail(404, 'Planning tidak ditemukan.'))
  if (!planningAbilities(user, row).approve) fail(403, 'Anda tidak dapat meng-approve planning divisi lain.')
  const body = await readJson(request)
  const action = body.action
  if (action !== 'approve' && action !== 'reject') fail(400, 'Aksi approval tidak valid.')
  const note = str(body.note, 500) || null
  if (action === 'reject' && !note) fail(400, 'Alasan penolakan wajib diisi.')

  await db.query('UPDATE plannings SET approval = ?, approval_note = ?, approved_by = ?, approved_at = NOW() WHERE id = ?', [
    action === 'approve' ? 'disetujui' : 'ditolak',
    note,
    user.id,
    row.id,
  ])
  return NextResponse.json({ item: serializePlanning(user, await loadPlanning(user, row.id)) })
})
