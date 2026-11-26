import type { RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canSignAs, loadAnalysis, requireTechAnalysis } from '@/lib/tech-analysis'
import { revokeTaSignature } from '@/lib/tech-analysis-signature'

type Ctx = { params: Promise<{ id: string; sigId: string }> }

// Cabut tanda tangan (riwayat tetap tersimpan): { alasan }. Hanya yang berhak menandatangani peran itu.
export const DELETE = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTechAnalysis(user)
  const p = await ctx.params
  const a = await loadAnalysis(int(p.id) ?? fail(404, 'Analisa teknik tidak ditemukan.'))
  const sigId = int(p.sigId) ?? fail(404, 'Tanda tangan tidak ditemukan.')
  const [[s]] = await db.query<(RowDataPacket & { peran: 'pengaju' | 'teknik' | 'direksi' })[]>('SELECT peran FROM tech_analysis_signatures WHERE id = ? AND analysis_id = ?', [sigId, a.id])
  if (!s) fail(404, 'Tanda tangan tidak ditemukan.')
  if (!canSignAs(user, a)[s!.peran] && !user.role.isAdmin) fail(403, 'Anda tidak bisa mencabut tanda tangan ini.')
  const body = await readJson(request).catch(() => ({}) as Record<string, unknown>)
  const res = await revokeTaSignature(a.id, sigId, user, str(body.alasan, 255))
  await logActivity(request, user, {
    module: 'Analisa Teknik', action: 'update', entity: { type: 'tech_analysis', id: a.id, label: a.nomor },
    description: `Mencabut tanda tangan ${res.nama} pada ${a.nomor}`,
  })
  return NextResponse.json({ ok: true, toast: `Tanda tangan ${res.nama} pada ${a.nomor} dicabut` })
})
