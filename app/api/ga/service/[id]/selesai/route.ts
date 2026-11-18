import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { recordService, requireService } from '@/lib/ga-service'

type Ctx = { params: Promise<{ id: string }> }

// Catat service selesai: { tanggal, vendor, biaya, keterangan, kondisi, jadwal_berikutnya }
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireService(user, true)
  const id = int((await ctx.params).id) ?? fail(404, 'Jadwal service tidak ditemukan.')
  return NextResponse.json(await recordService(id, await readJson(request), user.id), { status: 201 })
})
