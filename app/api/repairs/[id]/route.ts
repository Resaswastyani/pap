import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { parseLocalDateTime } from '@/lib/production'
import { canHandleRepair, loadRepair, notifyRepairUpdate, OPEN_STATUSES, REPAIR_PRIORITY, REPAIR_STATUS, requireRepairs, syncMachineStatus, technicians, type RepairStatus } from '@/lib/repairs'

type Ctx = { params: Promise<{ id: string }> }
const repairId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Laporan kerusakan tidak ditemukan.')

export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireRepairs(user)
  const item = await loadRepair(await repairId(ctx))
  return NextResponse.json({
    item,
    technicians: canHandleRepair(user) ? await technicians() : [],
    can: { handle: canHandleRepair(user), cancel: item.status === 'baru' && (item.reported_by === user.id || canHandleRepair(user)) },
  })
})

// Teknik: { teknisi_id, status, prioritas, penyebab, tindakan, sparepart, target_selesai, mesin_berhenti }
// Pelapor: { batal: true } selama laporan belum dikerjakan, atau ubah keluhan
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireRepairs(user)
  const repair = await loadRepair(await repairId(ctx))
  const body = await readJson(request)
  const handler = canHandleRepair(user)
  const sets: string[] = []
  const args: unknown[] = []
  let status = repair.status as RepairStatus
  let assigned: number | null = null

  if (body.batal === true) {
    if (repair.status !== 'baru' && !handler) fail(403, 'Laporan yang sudah dikerjakan Teknik tidak bisa dibatalkan pelapor.')
    if (repair.reported_by !== user.id && !handler) fail(403, 'Hanya pelapor atau Teknik yang dapat membatalkan laporan.')
    status = 'batal'
  } else if (!handler) {
    // Pelapor hanya bisa memperbaiki keluhan selama laporan masih baru
    if (repair.reported_by !== user.id || repair.status !== 'baru') fail(403, 'Penanganan kerusakan dilakukan divisi Teknik.')
    if ('keluhan' in body) sets.push('keluhan = ?'), args.push(str(body.keluhan, 5000) || fail(400, 'Keluhan wajib diisi.'))
  } else {
    if ('teknisi_id' in body) {
      const teknisi = body.teknisi_id ? int(body.teknisi_id) : null
      if (teknisi && !(await technicians()).some((t) => t.id === teknisi)) fail(400, 'Teknisi harus dari divisi Teknik.')
      sets.push('teknisi_id = ?'), args.push(teknisi)
      if (teknisi && teknisi !== repair.teknisi_id) assigned = teknisi
    }
    if (typeof body.status === 'string') {
      if (!(body.status in REPAIR_STATUS)) fail(400, 'Status tidak valid.')
      status = body.status as RepairStatus
    }
    if (typeof body.prioritas === 'string' && body.prioritas in REPAIR_PRIORITY) sets.push('prioritas = ?'), args.push(body.prioritas)
    if ('mesin_berhenti' in body) sets.push('mesin_berhenti = ?'), args.push(body.mesin_berhenti ? 1 : 0)
    for (const key of ['penyebab', 'tindakan', 'sparepart'] as const) if (key in body) sets.push(`${key} = ?`), args.push(str(body[key], 5000) || null)
    if ('target_selesai' in body) {
      const target = parseLocalDateTime(body.target_selesai)
      if (target === undefined) fail(400, 'Format target selesai tidak valid.')
      sets.push('target_selesai = ?'), args.push(target)
    }
    if (status === 'selesai' && !(str(body.tindakan, 5000) || repair.tindakan)) fail(400, 'Tuliskan tindakan perbaikan sebelum menandai selesai.')
  }

  if (status !== repair.status) {
    sets.push('status = ?'), args.push(status)
    // Mulai dikerjakan & selesai dicatat otomatis; dibuka lagi -> waktu selesai dihapus
    if (OPEN_STATUSES.includes(status) && status !== 'baru') sets.push('mulai_at = COALESCE(mulai_at, NOW())')
    if (status === 'selesai' || status === 'batal') sets.push('selesai_at = NOW()')
    else sets.push('selesai_at = NULL')
    // Teknisi yang mulai mengerjakan tanpa penugasan otomatis jadi teknisi
    if (status === 'dikerjakan' && handler && !repair.teknisi_id && !('teknisi_id' in body) && user.division.code === 'teknik') sets.push('teknisi_id = ?'), args.push(user.id)
  }
  if (!sets.length) return NextResponse.json({ item: repair })
  await db.query(`UPDATE machine_repairs SET ${sets.join(', ')}, updated_by = ? WHERE id = ?`, [...args, user.id, repair.id])
  await syncMachineStatus(repair.machine_id)
  if (status !== repair.status || assigned) await notifyRepairUpdate(repair.id, user, assigned)
  return NextResponse.json({ item: await loadRepair(repair.id) })
})
