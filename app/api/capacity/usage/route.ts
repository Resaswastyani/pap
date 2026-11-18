import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { canManageCapacity, deleteUsage, loadUsage, requireCapacity, saveUsage } from '@/lib/capacity'

const DENIED = 'Kapasitas produksi diatur PPIC, kepala Produksi, Teknik, atau GM.'

// Kapasitas terpakai per bulan dalam satu tahun: ?tahun=YYYY
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireCapacity(user)
  const tahun = Number(new URL(request.url).searchParams.get('tahun') ?? new Date().getFullYear())
  if (!Number.isInteger(tahun) || tahun < 2000 || tahun > 2100) fail(400, 'Tahun tidak valid.')
  return NextResponse.json({ ...(await loadUsage(tahun)), can: { manage: canManageCapacity(user) } })
})

// Isi / ubah kapasitas terpakai satu bulan: { periode, items: [{ capacity_id, terpakai_ton, catatan }] }
export const PUT = handle(async (request: Request) => {
  const user = await requireUser()
  requireCapacity(user)
  if (!canManageCapacity(user)) fail(403, DENIED)
  return NextResponse.json(await saveUsage(await readJson(request), user.id))
})

// Hapus seluruh isian satu bulan: ?periode=YYYY-MM
export const DELETE = handle(async (request: Request) => {
  const user = await requireUser()
  requireCapacity(user)
  if (!canManageCapacity(user)) fail(403, DENIED)
  return NextResponse.json({ removed: await deleteUsage(new URL(request.url).searchParams.get('periode') ?? '') })
})
