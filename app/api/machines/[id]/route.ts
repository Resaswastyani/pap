import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { softDelete } from '@/lib/recycle-bin'
import { loadMachineDetail } from '@/lib/machine-sheet'
import { canManageMachines, readMachineInput } from '@/lib/production'

type Ctx = { params: Promise<{ id: string }> }

// Detail mesin: critical point perawatan per komponen, data pembantu (SOP), laporan kerusakan terakhir
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  if (!['data-mesin', 'jadwal-produksi', 'perbaikan-mesin'].some((m) => user.menus.includes(m as never))) fail(403, 'Anda tidak punya akses ke Data Mesin.')
  const id = int((await ctx.params).id) ?? fail(404, 'Mesin tidak ditemukan.')
  return NextResponse.json({ ...(await loadMachineDetail(id)), canManage: canManageMachines(user) })
})

export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  if (!canManageMachines(user)) fail(403, 'Hanya PPIC / Teknik yang dapat mengubah mesin.')
  const id = int((await ctx.params).id) ?? fail(404, 'Mesin tidak ditemukan.')
  const input = readMachineInput(await readJson(request))
  await db.query('UPDATE machines SET kode = ?, nama = ?, tahap = ?, kapasitas = ?, status = ?, keterangan = ? WHERE id = ?', [
    input.kode, input.nama, input.tahap, input.kapasitas, input.status, input.keterangan, id,
  ])
  return NextResponse.json({ ok: true })
})

// Tahap yang memakai mesin ini menjadi tanpa mesin (perlu dijadwalkan ulang)
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  if (!canManageMachines(user)) fail(403, 'Hanya PPIC / Teknik yang dapat menghapus mesin.')
  const id = int((await ctx.params).id) ?? fail(404, 'Mesin tidak ditemukan.')
  await softDelete({ table: 'machines', id, modul: 'Data Mesin', user })
  return NextResponse.json({ ok: true })
})
