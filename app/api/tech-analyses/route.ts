import type { ResultSetHeader } from 'mysql2'
import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity'
import { fail, handle, readJson, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import {
  canDireksiSection, canMarketingSection, canTeknikSection, defaultProses, listAnalyses, loadAnalysis, nextAnalysisNumber, readMarketingSection, requireTechAnalysis,
} from '@/lib/tech-analysis'

// Daftar Analisa Teknik Order: ?prospect_id&status&q
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireTechAnalysis(user)
  const data = await listAnalyses(new URL(request.url).searchParams)
  return NextResponse.json({ ...data, can: { create: canMarketingSection(user), teknik: canTeknikSection(user), direksi: canDireksiSection(user) } })
})

// Buat analisa baru (bagian Marketing)
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireTechAnalysis(user)
  if (!canMarketingSection(user)) fail(403, 'Analisa teknik order dibuat oleh Marketing.')
  const v = await readMarketingSection(await readJson(request))
  const nomor = await nextAnalysisNumber()
  const [res] = await db.query<ResultSetHeader>('INSERT INTO prospect_tech_analyses SET ?', [{ ...v, nomor, proses: JSON.stringify(defaultProses()), created_by: user.id, updated_by: user.id }])
  const a = await loadAnalysis(res.insertId)
  await logActivity(request, user, { module: 'Prospek', action: 'create', entity: { type: 'tech_analysis', id: a.id, label: a.nomor }, description: `Analisa teknik ${a.nomor} · ${a.nama_produk} · ${a.nama_customer}` })
  return NextResponse.json({ ok: true, id: a.id, nomor })
})
