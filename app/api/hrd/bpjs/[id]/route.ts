import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { removeBpjs, requireBpjs, saveBpjs } from '@/lib/bpjs-report'
import { canManageHr } from '@/lib/hrd'
import type { UserProfile } from '@/lib/users'

// [id] = id pengaturan gaji (employee_payrolls)
type Ctx = { params: Promise<{ id: string }> }

async function target(user: UserProfile, ctx: Ctx) {
  requireBpjs(user)
  if (!canManageHr(user)) fail(403, 'Kepesertaan BPJS dikelola HRD.')
  return int((await ctx.params).id) ?? fail(404, 'Pengaturan gaji tidak ditemukan.')
}

// Daftarkan / ubah kepesertaan: nomor, upah dilaporkan, ditanggung pegawai / perusahaan
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  const id = await target(user, ctx)
  return NextResponse.json(await saveBpjs(id, await readJson(request), user.id))
})

// Hapus kepesertaan: ?program=tk|kes|semua
export const DELETE = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  const id = await target(user, ctx)
  return NextResponse.json(await removeBpjs(id, new URL(request.url).searchParams.get('program') ?? '', user.id))
})
