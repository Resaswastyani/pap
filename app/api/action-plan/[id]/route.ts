import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { canManageAP, isPersonOf, loadProgram, notifyPeople, pushPrograms, readProgramInput, removeProgramFromSheet, requireManageAP, savePeople , requireActionPlan } from '@/lib/action-plan'
import { db } from '@/lib/db'
import { softDelete } from '@/lib/recycle-bin'

type Ctx = { params: Promise<{ id: string }> }
type Row = RowDataPacket & Record<string, unknown>
const idOf = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Program tidak ditemukan.')

// Detail program: riwayat progress (termasuk batal / aktif kembali) dan issue terkait
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireActionPlan(user)
  const program = await loadProgram(await idOf(ctx), user)
  const [progress] = await db.query<Row[]>(
    `SELECT g.*, u.name AS user_name FROM action_progress g LEFT JOIN users u ON u.id = g.user_id WHERE g.program_id = ? ORDER BY g.tanggal DESC, g.id DESC`,
    [program.id],
  )
  const [issues] = await db.query<Row[]>('SELECT * FROM action_issues WHERE program_id = ? ORDER BY tanggal DESC, id DESC', [program.id])
  const peran = await isPersonOf(program.id, user.id)
  return NextResponse.json({
    program, progress, issues,
    can: { manage: canManageAP(user), update: program.status !== 'Cancelled' && (canManageAP(user) || !!peran), peran },
  })
})

// Ubah program & PIC (Admin / Super Admin). Status Cancelled hanya lewat tombol Batalkan.
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireActionPlan(user)
  requireManageAP(user)
  const program = await loadProgram(await idOf(ctx), user)
  const body = await readJson(request)
  const input = readProgramInput(body)
  if (program.status === 'Cancelled') input.status = 'Cancelled'
  else if (input.status === 'Cancelled') fail(400, 'Gunakan tombol "Batalkan" untuk membatalkan program.')
  const progress = input.progress ?? Number(program.progress)
  await db.query('UPDATE action_programs SET ? WHERE id = ?', [{ ...input, progress, updated_by: user.id }, program.id])
  let added: number[] = []
  if (body.pic !== undefined || body.support !== undefined) added = await savePeople(program.id, body.pic, body.support)
  await notifyPeople(added, user.id, { id: program.id, kode: String(program.kode), nama: input.nama }, `Anda menjadi PIC / support Action Plan ${program.kode}`)
  const warning = await pushPrograms([program.id])
  return NextResponse.json({ ok: true, warning })
})

// Hapus permanen dari daftar (masuk Data Terhapus). Untuk menghentikan program gunakan "Batalkan" agar tetap tercatat.
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireActionPlan(user)
  requireManageAP(user)
  const program = await loadProgram(await idOf(ctx), user)
  await softDelete({ table: 'action_programs', id: program.id, modul: 'Action Plan', label: `${program.kode} · ${program.nama}`, user })
  const warning = await removeProgramFromSheet(String(program.kode))
  return NextResponse.json({ ok: true, warning })
})
