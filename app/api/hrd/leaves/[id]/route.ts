import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { deleteLeave, loadLeave, readLeave, requireLeave, setLeaveStatus, updateLeave } from '@/lib/leave'

type Ctx = { params: Promise<{ id: string }> }
const leaveId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Pengajuan tidak ditemukan.')

export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireLeave(user)
  return NextResponse.json({ item: await loadLeave(await leaveId(ctx)) })
})

export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireLeave(user)
  await updateLeave(await leaveId(ctx), readLeave(await readJson(request)), user)
  return NextResponse.json({ ok: true })
})

// { action: 'setujui' | 'tolak' | 'batal', catatan }
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireLeave(user)
  const body = await readJson(request)
  return NextResponse.json({ status: await setLeaveStatus(await leaveId(ctx), String(body.action ?? ''), str(body.catatan, 500), user) })
})

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireLeave(user)
  await deleteLeave(await leaveId(ctx), user)
  return NextResponse.json({ ok: true })
})
