import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import {
  canProcessGa, GA_PR_FLOW, GA_PR_STATUS, loadGaPr, loadGaPrItems, notifyGaPr, readGaPrInput, requireGaRequest, saveGaPrItems, saveGaRealisasi, serializeGaPr,
  type GaPrStatus,
} from '@/lib/ga-requests'

type Ctx = { params: Promise<{ id: string }> }
const idOf = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Pengajuan tidak ditemukan.')

export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireGaRequest(user)
  const pr = await loadGaPr(await idOf(ctx), user)
  const process = canProcessGa(user)
  const mine = pr.requested_by === user.id
  return NextResponse.json({
    item: serializeGaPr(pr),
    items: await loadGaPrItems(Number(pr.id)),
    can: { process, edit: mine && pr.status === 'diajukan', cancel: (mine || process) && ['diajukan', 'disetujui'].includes(String(pr.status)) },
  })
})

// { status, catatan, vendor, bought_at, realisasi: [{ id, harga_realisasi }] } = ubah status; selain itu ubah isi (pengaju, selama masih diajukan)
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireGaRequest(user)
  const id = await idOf(ctx)
  const pr = await loadGaPr(id, user)
  const body = await readJson(request)
  const from = pr.status as GaPrStatus
  const mine = pr.requested_by === user.id
  if (!body.status) {
    if (!mine || from !== 'diajukan') fail(403, 'Pengajuan hanya bisa diubah pengaju selama belum diproses.')
    const input = readGaPrInput(body)
    await db.query('UPDATE ga_purchase_requests SET judul = ?, kategori = ?, prioritas = ?, dibutuhkan = ?, keperluan = ? WHERE id = ?',
      [input.judul, input.kategori, input.prioritas, input.dibutuhkan, input.keperluan, id])
    await saveGaPrItems(id, input.items)
    return NextResponse.json({ ok: true })
  }
  const to = str(body.status, 20) as GaPrStatus
  if (!(to in GA_PR_STATUS) || !GA_PR_FLOW[from].includes(to)) fail(400, `Status tidak bisa diubah dari "${GA_PR_STATUS[from]}" ke "${GA_PR_STATUS[to] ?? to}".`)
  if (to === 'batal' ? !(mine || canProcessGa(user)) : !canProcessGa(user)) fail(403, 'Pengajuan diproses General Affair.')
  const catatan = str(body.catatan, 2000) || null
  if (['ditolak', 'batal'].includes(to) && !catatan) fail(400, 'Tulis alasannya.')
  const sets = ['status = ?']
  const values: unknown[] = [to]
  if (catatan) { sets.push('catatan_ga = ?'); values.push(catatan) }
  if (to === 'disetujui' || to === 'ditolak') { sets.push('approved_by = ?', 'approved_at = NOW()'); values.push(user.id) }
  if (to === 'dibeli') {
    const tanggal = str(body.bought_at, 10)
    if (tanggal && !/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) fail(400, 'Tanggal beli tidak valid.')
    sets.push('vendor = ?', 'bought_at = ?')
    values.push(str(body.vendor, 200) || null, tanggal || new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10))
    await saveGaRealisasi(id, body.realisasi)
  }
  await db.query(`UPDATE ga_purchase_requests SET ${sets.join(', ')} WHERE id = ? AND status = ?`, [...values, id, from])
  await notifyGaPr(id, user, false)
  return NextResponse.json({ ok: true })
})

// Hapus: pengaju selama masih diajukan, atau GA / GM
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireGaRequest(user)
  const id = await idOf(ctx)
  const pr = await loadGaPr(id, user)
  if (!canProcessGa(user) && !(pr.requested_by === user.id && pr.status === 'diajukan')) fail(403, 'Pengajuan yang sudah diproses tidak bisa dihapus.')
  await db.query('DELETE FROM ga_purchase_requests WHERE id = ?', [id])
  return NextResponse.json({ ok: true })
})
