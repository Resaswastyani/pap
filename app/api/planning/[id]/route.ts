import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { PERMISSIONS, PLANNING_STATUS } from '@/lib/permissions'
import { assertDivision, canViewAllDivisions, loadFiles, loadPlanning, parseDate, planningAbilities, serializePlanning } from '@/lib/planning'

type Ctx = { params: Promise<{ id: string }> }

const planningId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Planning tidak ditemukan.')

export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser(PERMISSIONS.planningView)
  const row = await loadPlanning(user, await planningId(ctx))
  return NextResponse.json({ item: serializePlanning(user, row), files: await loadFiles(row.id) })
})

// Edit planning. Yang boleh diubah tergantung hak:
// - edit (lead/admin divisi, atau pembuatnya): semua field
// - progress (staff divisi): status & progress saja
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser(PERMISSIONS.planningView)
  const row = await loadPlanning(user, await planningId(ctx))
  const ability = planningAbilities(user, row)
  const body = await readJson(request)
  const sets: string[] = []
  const args: unknown[] = []

  const wantsDetail = ['judul', 'deskripsi', 'tanggal_mulai', 'tanggal_selesai', 'division_id'].some((key) => key in body)
  if (wantsDetail && !ability.edit) fail(403, 'Anda hanya dapat mengubah progress planning ini.')
  if (!ability.edit && !ability.progress) fail(403, 'Anda tidak punya akses untuk mengubah planning ini.')

  if ('judul' in body) {
    const judul = str(body.judul, 200)
    if (!judul) fail(400, 'Judul wajib diisi.')
    sets.push('judul = ?')
    args.push(judul)
  }
  if ('deskripsi' in body) {
    sets.push('deskripsi = ?')
    args.push(str(body.deskripsi, 5000) || null)
  }
  const mulai = 'tanggal_mulai' in body ? parseDate(body.tanggal_mulai, 'Tanggal mulai') : row.tanggal_mulai
  const selesai = 'tanggal_selesai' in body ? parseDate(body.tanggal_selesai, 'Tanggal selesai') : row.tanggal_selesai
  if (selesai < mulai) fail(400, 'Tanggal selesai tidak boleh sebelum tanggal mulai.')
  if ('tanggal_mulai' in body) sets.push('tanggal_mulai = ?'), args.push(mulai)
  if ('tanggal_selesai' in body) sets.push('tanggal_selesai = ?'), args.push(selesai)
  if ('division_id' in body && Number(body.division_id) !== row.division_id) {
    if (!canViewAllDivisions(user)) fail(403, 'Anda tidak dapat memindahkan planning ke divisi lain.')
    sets.push('division_id = ?')
    args.push(await assertDivision(body.division_id))
  }

  let progress = row.progress
  if ('progress' in body) {
    progress = Number(body.progress)
    if (!Number.isInteger(progress) || progress < 0 || progress > 100) fail(400, 'Progress harus 0–100.')
    sets.push('progress = ?')
    args.push(progress)
  }
  if ('status' in body) {
    if (typeof body.status !== 'string' || !(body.status in PLANNING_STATUS)) fail(400, 'Status tidak valid.')
    sets.push('status = ?')
    args.push(body.status)
    if (body.status === 'selesai' && !('progress' in body)) sets.push('progress = 100')
  } else if ('progress' in body) {
    // Status mengikuti progress bila tidak diisi
    sets.push('status = ?')
    args.push(progress >= 100 ? 'selesai' : progress > 0 ? 'berjalan' : row.status)
  }

  if (!sets.length) fail(400, 'Tidak ada perubahan.')

  await db.query(`UPDATE plannings SET ${sets.join(', ')} WHERE id = ?`, [...args, row.id])
  const updated = await loadPlanning(user, row.id)
  return NextResponse.json({ item: serializePlanning(user, updated) })
})

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser(PERMISSIONS.planningView)
  const row = await loadPlanning(user, await planningId(ctx))
  if (!planningAbilities(user, row).delete) fail(403, 'Anda tidak punya akses untuk menghapus planning ini.')
  await db.query('DELETE FROM plannings WHERE id = ?', [row.id])
  return NextResponse.json({ ok: true })
})
