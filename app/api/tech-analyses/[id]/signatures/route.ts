import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity'
import { fail, handle, int, readJson, requireUser } from '@/lib/api'
import { mySignature } from '@/lib/quotation-signature'
import { canSignAs, loadAnalysis, requireTechAnalysis } from '@/lib/tech-analysis'
import { addTaSignature, isTaSignRole, listTaSignatures, type TaSignRole } from '@/lib/tech-analysis-signature'

type Ctx = { params: Promise<{ id: string }> }

const label = (peran: TaSignRole, sumber: string | null) => (peran === 'pengaju' ? `Dept ${sumber === 'ppic' ? 'PPIC' : 'Marketing'}` : peran === 'teknik' ? 'Dept Tehnik' : 'Direksi')

export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTechAnalysis(user)
  const a = await loadAnalysis(int((await ctx.params).id) ?? fail(404, 'Analisa teknik tidak ditemukan.'))
  const [items, mine] = await Promise.all([listTaSignatures(a.id), mySignature(user.id)])
  return NextResponse.json({ items, mine, can: canSignAs(user, a) })
})

// Tandatangani: { peran: 'pengaju' | 'teknik' | 'direksi', nama, jabatan, image (data URL PNG), setuju: true, simpan?: true }
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTechAnalysis(user)
  const a = await loadAnalysis(int((await ctx.params).id) ?? fail(404, 'Analisa teknik tidak ditemukan.'))
  const body = await readJson(request)
  const peran = isTaSignRole(body.peran) ? body.peran : fail(400, 'Peran tanda tangan tidak valid.')
  if (!canSignAs(user, a)[peran]) fail(403, `Anda tidak bisa menandatangani sebagai ${label(peran, a.sumber)} pada analisa ini.`)
  const h = request.headers
  const res = await addTaSignature(a.id, peran, user, body, { ip: h.get('x-forwarded-for')?.split(',')[0].trim() || h.get('x-real-ip') || null, ua: h.get('user-agent') })
  await logActivity(request, user, {
    module: 'Analisa Teknik', action: 'update', entity: { type: 'tech_analysis', id: a.id, label: a.nomor },
    description: `Tanda tangan digital ${label(peran, a.sumber)} pada ${a.nomor} oleh ${res.nama}`,
  })
  return NextResponse.json({ ok: true, token: res.token, toast: `${a.nomor} ditandatangani (${label(peran, a.sumber)}) oleh ${res.nama}` })
})
