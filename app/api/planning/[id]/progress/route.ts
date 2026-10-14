import type { ResultSetHeader } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, requireUser } from '@/lib/api'
import { db } from '@/lib/db'
import { PERMISSIONS, PLANNING_STATUS } from '@/lib/permissions'
import { insertAttachment, loadNotes, loadPlanning, planningAbilities, serializePlanning, validLink, validUpload } from '@/lib/planning'

type Ctx = { params: Promise<{ id: string }> }

// Update progress + catatan progress opsional (multipart):
//   progress, status, catatan, links (JSON [{ name, url }]), files (bisa lebih dari satu)
// Catatan hanya dibuat bila ada teks, link, atau file. Tanggal & waktu catatan otomatis.
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const user = await requireUser(PERMISSIONS.planningView)
  const row = await loadPlanning(user, int((await ctx.params).id) ?? fail(404, 'Planning tidak ditemukan.'))
  if (!planningAbilities(user, row).progress) fail(403, 'Anda tidak punya akses untuk update progress planning ini.')

  const form = await request.formData().catch(() => fail(400, 'Data progress tidak valid.'))
  const progress = Number(form.get('progress') ?? row.progress)
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) fail(400, 'Progress harus 0–100.')
  const status = String(form.get('status') ?? row.status)
  if (!(status in PLANNING_STATUS)) fail(400, 'Status tidak valid.')
  const catatan = String(form.get('catatan') ?? '').trim().slice(0, 5000)
  let rawLinks: unknown = []
  try {
    rawLinks = JSON.parse(String(form.get('links') || '[]'))
  } catch {
    fail(400, 'Data link tidak valid.')
  }
  const links = (Array.isArray(rawLinks) ? rawLinks : []).map((link) => validLink(link ?? {}))
  const files = form.getAll('files').filter((value) => value instanceof File && value.size).map(validUpload)
  const hasNote = !!catatan || links.length > 0 || files.length > 0
  const changed = progress !== row.progress || status !== row.status
  if (!changed && !hasNote) fail(400, 'Tidak ada perubahan progress atau catatan.')

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    if (changed) await conn.query('UPDATE plannings SET progress = ?, status = ? WHERE id = ?', [progress, status, row.id])
    if (hasNote) {
      const [result] = await conn.query<ResultSetHeader>(
        'INSERT INTO planning_progress_notes (planning_id, progress, status, catatan, created_by) VALUES (?, ?, ?, ?, ?)',
        [row.id, progress, status, catatan || null, user.id],
      )
      const target = { planningId: row.id, noteId: result.insertId, userId: user.id }
      for (const link of links) await insertAttachment(conn, target, { link })
      for (const file of files) await insertAttachment(conn, target, { file })
    }
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
  const updated = await loadPlanning(user, row.id)
  return NextResponse.json({ item: serializePlanning(user, updated), notes: await loadNotes(user, updated) }, { status: 201 })
})
