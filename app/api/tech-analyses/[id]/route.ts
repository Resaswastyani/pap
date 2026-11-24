import { NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { softDelete } from '@/lib/recycle-bin'
import {
  canDireksiSection, canSubmitSection, canTeknikSection, direksiUsers, loadAnalysis, notifyAnalysis, readMarketingSection, readTeknikSection, requireTechAnalysis, TA_STATUS, teknikUsers,
} from '@/lib/tech-analysis'
import { isManagement } from '@/lib/users'

type Ctx = { params: Promise<{ id: string }> }
const analysisId = async (ctx: Ctx) => int((await ctx.params).id) ?? fail(404, 'Analisa teknik tidak ditemukan.')

export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTechAnalysis(user)
  const a = await loadAnalysis(await analysisId(ctx))
  return NextResponse.json({
    item: a,
    can: {
      marketing: canSubmitSection(user) && a.status !== 'selesai',
      teknik: canTeknikSection(user) && a.status !== 'draft' && a.status !== 'selesai',
      direksi: canDireksiSection(user) && (a.status === 'dianalisa' || a.status === 'selesai'),
      delete: user.role.isAdmin || isManagement(user) || (a.created_by === user.id && a.status === 'draft'),
    },
  })
})

// Simpan per bagian: { bagian: 'marketing' | 'teknik' | 'direksi', ...isian, selesai?: true (Teknik: tandai selesai dianalisa) }
export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTechAnalysis(user)
  const a = await loadAnalysis(await analysisId(ctx))
  const body = await readJson(request)
  if (body.bagian === 'marketing') {
    if (!canSubmitSection(user)) fail(403, 'Bagian ini diisi oleh Marketing / PPIC.')
    if (a.status === 'selesai') fail(400, 'Analisa sudah selesai (ada rekomendasi Direksi).')
    await db.query('UPDATE prospect_tech_analyses SET ?, updated_by = ? WHERE id = ?', [await readMarketingSection(body), user.id, a.id])
    await logActivity(request, user, { module: 'Prospek', action: 'update', entity: { type: 'tech_analysis', id: a.id, label: a.nomor }, description: `Mengubah spek order analisa teknik ${a.nomor}` })
    return NextResponse.json({ ok: true })
  }
  if (body.bagian === 'teknik') {
    if (!canTeknikSection(user)) fail(403, 'Bagian analisa proses diisi oleh Dept Teknik.')
    if (a.status === 'draft') fail(400, 'Analisa belum diserahkan Marketing ke Teknik.')
    if (a.status === 'selesai') fail(400, 'Analisa sudah selesai (ada rekomendasi Direksi).')
    const v = readTeknikSection(body)
    const finish = body.selesai === true
    if (finish && !v.bisa_produksi) fail(400, 'Isi kesimpulan: bisa / tidak bisa diproduksi.')
    await db.query(
      `UPDATE prospect_tech_analyses SET ?, updated_by = ?${finish ? ", status = 'dianalisa', teknik_oleh = ?, teknik_at = NOW()" : ''} WHERE id = ?`,
      finish ? [v, user.id, user.id, a.id] : [v, user.id, a.id],
    )
    if (finish) {
      await notifyAnalysis([a.created_by], a, 'Analisa teknik selesai dari Dept Teknik', 'dianalisa-m', user.id, true)
      await notifyAnalysis(await direksiUsers(), a, 'Analisa teknik menunggu rekomendasi Direksi', 'dianalisa-d', user.id)
    }
    await logActivity(request, user, { module: 'Prospek', action: 'update', entity: { type: 'tech_analysis', id: a.id, label: a.nomor }, description: `${finish ? 'Menyelesaikan' : 'Mengisi'} analisa teknik ${a.nomor}` })
    return NextResponse.json({ ok: true })
  }
  if (body.bagian === 'direksi') {
    if (!canDireksiSection(user)) fail(403, 'Rekomendasi diisi oleh Direksi (GM).')
    if (a.status !== 'dianalisa' && a.status !== 'selesai') fail(400, 'Rekomendasi Direksi diisi setelah Dept Teknik selesai menganalisa.')
    const rek = str(body.rekomendasi_direksi, 5000) || fail(400, 'Tulis rekomendasi Direksi.')
    await db.query("UPDATE prospect_tech_analyses SET rekomendasi_direksi = ?, direksi_oleh = ?, direksi_at = NOW(), status = 'selesai', updated_by = ? WHERE id = ?", [rek, user.id, user.id, a.id])
    await notifyAnalysis([a.created_by], a, 'Rekomendasi Direksi untuk analisa teknik', 'selesai-m', user.id, true)
    await notifyAnalysis([a.teknik_oleh], a, 'Rekomendasi Direksi untuk analisa teknik', 'selesai-t', user.id)
    await logActivity(request, user, { module: 'Prospek', action: 'update', entity: { type: 'tech_analysis', id: a.id, label: a.nomor }, description: `Rekomendasi Direksi pada analisa teknik ${a.nomor}` })
    return NextResponse.json({ ok: true })
  }
  return fail(400, 'Bagian tidak dikenal.')
})

// Alur: { action: 'serahkan' } Marketing -> Teknik; { action: 'tarik' } kembali ke draft; { action: 'buka' } Direksi membuka lagi untuk Teknik
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTechAnalysis(user)
  const a = await loadAnalysis(await analysisId(ctx))
  const body = await readJson(request)
  let to: keyof typeof TA_STATUS
  if (body.action === 'serahkan') {
    if (!canSubmitSection(user)) fail(403, 'Diserahkan oleh Marketing / PPIC.')
    if (a.status !== 'draft') fail(400, 'Analisa sudah diserahkan ke Teknik.')
    to = 'diserahkan'
    await db.query("UPDATE prospect_tech_analyses SET status = 'diserahkan', tanggal_serah = CURDATE(), updated_by = ? WHERE id = ?", [user.id, a.id])
    await notifyAnalysis(await teknikUsers(), a, `Analisa teknik order baru dari ${a.sumber === 'ppic' ? 'PPIC' : 'Marketing'}`, 'serah', user.id)
  } else if (body.action === 'tarik') {
    if (!canSubmitSection(user)) fail(403, 'Ditarik oleh Marketing / PPIC.')
    if (a.status !== 'diserahkan') fail(400, 'Hanya analisa yang belum dianalisa Teknik yang bisa ditarik.')
    to = 'draft'
    await db.query("UPDATE prospect_tech_analyses SET status = 'draft', updated_by = ? WHERE id = ?", [user.id, a.id])
  } else if (body.action === 'buka') {
    if (!canDireksiSection(user) && !canTeknikSection(user)) fail(403, 'Dibuka lagi oleh Teknik / Direksi.')
    if (a.status !== 'dianalisa' && a.status !== 'selesai') fail(400, 'Analisa belum selesai.')
    to = 'diserahkan'
    await db.query("UPDATE prospect_tech_analyses SET status = 'diserahkan', updated_by = ? WHERE id = ?", [user.id, a.id])
  } else return fail(400, 'Aksi tidak dikenal.')
  await logActivity(request, user, { module: 'Prospek', action: 'update', entity: { type: 'tech_analysis', id: a.id, label: a.nomor }, description: `Analisa teknik ${a.nomor}: ${TA_STATUS[a.status]} → ${TA_STATUS[to]}` })
  return NextResponse.json({ ok: true })
})

export const DELETE = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser()
  requireTechAnalysis(user)
  const a = await loadAnalysis(await analysisId(ctx))
  if (!(user.role.isAdmin || isManagement(user) || (a.created_by === user.id && a.status === 'draft'))) fail(403, 'Analisa yang sudah diserahkan hanya bisa dihapus GM / admin.')
  await softDelete({ table: 'prospect_tech_analyses', id: a.id, modul: 'Analisa Teknik Order', label: `${a.nomor} · ${a.nama_produk} · ${a.nama_customer}`, user })
  await logActivity(request, user, { module: 'Prospek', action: 'delete', entity: { type: 'tech_analysis', id: a.id, label: a.nomor }, description: `Menghapus analisa teknik ${a.nomor}` })
  return NextResponse.json({ ok: true })
})
