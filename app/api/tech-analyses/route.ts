import type { ResultSetHeader } from 'mysql2'
import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import {
  canDireksiSection, canPpicSection, canSubmitSection, canTeknikSection, defaultProses, listAnalyses, loadAnalysis, nextAnalysisNumber, notifyAnalysis, readMarketingSection,
  requireTechAnalysis, teknikUsers,
} from '@/lib/tech-analysis'

// Daftar Analisa Teknik Order: ?prospect_id&status&q
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireTechAnalysis(user)
  const data = await listAnalyses(new URL(request.url).searchParams)
  return NextResponse.json({ ...data, can: { create: canSubmitSection(user), ppic: canPpicSection(user), teknik: canTeknikSection(user), direksi: canDireksiSection(user) } })
})

// Buat analisa baru (Marketing, atau PPIC dari Sales Order: sumber = 'ppic').
// serahkan: true = langsung diserahkan ke Dept Teknik (status diserahkan + notifikasi Teknik)
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireTechAnalysis(user)
  const body = await readJson(request)
  const ppic = body.sumber === 'ppic'
  if (ppic ? !canPpicSection(user) : !canSubmitSection(user)) fail(403, ppic ? 'Pengajuan dari Sales Order dibuat oleh PPIC.' : 'Analisa teknik order diajukan oleh Marketing / PPIC.')
  const v = await readMarketingSection(body)
  const nomor = await nextAnalysisNumber()
  const serahkan = body.serahkan === true
  const [res] = await db.query<ResultSetHeader>('INSERT INTO prospect_tech_analyses SET ?', [{
    ...v, nomor, sumber: ppic ? 'ppic' : 'marketing', proses: JSON.stringify(defaultProses()), created_by: user.id, updated_by: user.id,
    ...(serahkan ? { status: 'diserahkan', tanggal_serah: new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10) } : {}),
  }])
  const a = await loadAnalysis(res.insertId)
  if (serahkan) await notifyAnalysis(await teknikUsers(), a, `Analisa teknik order baru dari ${ppic ? 'PPIC' : 'Marketing'}`, 'serah', user.id)
  await logActivity(request, user, { module: 'Prospek', action: 'create', entity: { type: 'tech_analysis', id: a.id, label: a.nomor }, description: `Analisa teknik ${a.nomor} · ${a.nama_produk} · ${a.nama_customer}` })
  return NextResponse.json({ ok: true, id: a.id, nomor })
})
