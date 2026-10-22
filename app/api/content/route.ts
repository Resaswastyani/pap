import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, readJson, requireUser, str } from '@/lib/api'
import { canEditContent, CONTENT_SELECT, loadContent, readContentInput, requireContent, serializeContent } from '@/lib/content'
import { db } from '@/lib/db'
import { contentSheetCreate, type ContentRow } from '@/lib/content-sheet'
import { trySheet } from '@/lib/sheet-write'

// Rencana konten satu bulan (?bulan=YYYY-MM) + ringkasan hasil
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireContent(user)
  const raw = str(new URL(request.url).searchParams.get('bulan'), 7)
  const now = new Date(Date.now() + 7 * 3600e3)
  const bulan = /^\d{4}-\d{2}$/.test(raw) ? raw : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const [items] = await db.query<RowDataPacket[]>(
    `${CONTENT_SELECT} WHERE c.jadwal_tayang >= ? AND c.jadwal_tayang < ? + INTERVAL 1 MONTH ORDER BY c.jadwal_tayang`,
    [`${bulan}-01`, `${bulan}-01`],
  )
  const [[sum]] = await db.query<(RowDataPacket & Record<string, string | null>)[]>(
    `SELECT COUNT(*) AS total, COALESCE(SUM(status = 'tayang'), 0) AS tayang, COALESCE(SUM(status IN ('ide', 'produksi')), 0) AS disiapkan,
       COALESCE(SUM(reach), 0) AS reach, COALESCE(SUM(engagement), 0) AS engagement, COALESCE(SUM(leads), 0) AS leads, COALESCE(SUM(anggaran), 0) AS anggaran
     FROM content_plans WHERE status <> 'batal' AND jadwal_tayang >= ? AND jadwal_tayang < ? + INTERVAL 1 MONTH`,
    [`${bulan}-01`, `${bulan}-01`],
  )
  const [users] = await db.query<RowDataPacket[]>(
    `SELECT u.id, u.name, d.name AS division_name FROM users u JOIN divisions d ON d.id = u.division_id
     WHERE u.is_active = 1 AND d.code IN ('marketing_digital', 'marketing', 'tim_desain') ORDER BY d.code = 'marketing_digital' DESC, u.name`,
  )
  return NextResponse.json({
    bulan,
    items: items.map(serializeContent),
    summary: Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, Number(v ?? 0)])),
    users,
    canEdit: canEditContent(user),
  })
})

export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireContent(user)
  if (!canEditContent(user)) fail(403, 'Kalender konten dikelola Marketing Digital.')
  const c = readContentInput(await readJson(request))
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO content_plans (judul, platform, jenis, jadwal_tayang, status, tujuan, target_sektor, caption, anggaran, link_hasil, reach, engagement, leads, catatan, pic_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [c.judul, c.platform, c.jenis, c.jadwal_tayang, c.status, c.tujuan, c.target_sektor, c.caption, c.anggaran, c.link_hasil, c.reach, c.engagement, c.leads, c.catatan, c.pic_id ?? user.id, user.id],
  )
  // Konten baru ikut ditambahkan sebagai baris di Google Sheet "Konten Planning"
  const warning = await trySheet('baris konten', async () => contentSheetCreate((await loadContent(result.insertId)) as unknown as ContentRow))
  return NextResponse.json({ id: result.insertId, warning }, { status: 201 })
})
