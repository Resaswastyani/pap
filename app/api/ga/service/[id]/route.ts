import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { loadSchedule, requireService, updateSchedule } from '@/lib/ga-service'
import { softDelete } from '@/lib/recycle-bin'

type Ctx = { params: Promise<{ id: string }> }
const scheduleId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Jadwal service tidak ditemukan.')

// Ubah jadwal, atau { aktif } untuk menghentikan / mengaktifkan lagi
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireService(user, true)
  return NextResponse.json({ item: await updateSchedule(await scheduleId(ctx), await readJson(request)) })
})

// Hapus jadwal (riwayat service yang sudah dicatat tetap ada di barangnya) -> Data Terhapus
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireService(user, true)
  const id = await scheduleId(ctx)
  await loadSchedule(id)
  await softDelete({ table: 'ga_service_schedules', id, modul: 'Jadwal Service Inventaris', user })
  return NextResponse.json({ ok: true })
})
