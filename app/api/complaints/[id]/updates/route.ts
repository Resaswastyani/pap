import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { addUpdate, loadComplaint, notifyComplaint, requireComplaints } from '@/lib/complaints'

type Ctx = { params: Promise<{ id: string }> }

// Komentar / catatan progres di riwayat tracking (semua yang punya menu)
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireComplaints(user)
  const c = await loadComplaint(int((await ctx.params).id) ?? fail(404, 'Kendala customer tidak ditemukan.'))
  const body = await readJson(request)
  const pesan = str(body.pesan, 5000) || fail(400, 'Tulis catatan / komentar.')
  await addUpdate(c.id, user.id, body.jenis === 'tindakan' ? 'tindakan' : 'komentar', pesan!)
  await notifyComplaint([c.pic_id, c.dilaporkan_oleh].filter((x) => x !== user.id), c, `${user.name} menambah catatan`, pesan!.slice(0, 120), `c${Date.now()}`)
  return NextResponse.json({ ok: true })
})
