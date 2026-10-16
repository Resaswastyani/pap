import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { canEditContent } from '@/lib/content'
import { logActivity } from '@/lib/marketing'
import {
  canRequest, DESIGN_SELECT, DESIGN_STATUS, designScope, designTodoSql, divisionUsers, isDesigner, logRequest, notifyRequest, readDesignBrief,
  readTarget, requireRequestMenu, setNomor,
} from '@/lib/requests'

export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireRequestMenu(user, 'desain')
  const url = new URL(request.url)
  const scope = designScope(user)
  const where = [scope.sql]
  const params: (string | number)[] = [...scope.params]
  const q = str(url.searchParams.get('q'), 100)
  if (q) {
    where.push('(d.nomor LIKE ? OR d.judul LIKE ? OR p.nama_usaha LIKE ? OR c.name LIKE ?)')
    params.push(...Array(4).fill(`%${q}%`))
  }
  const prospect = int(url.searchParams.get('prospect'))
  if (prospect) {
    where.push('d.prospect_id = ?')
    params.push(prospect)
  }
  const kategori = url.searchParams.get('kategori')
  if (kategori === 'klise' || kategori === 'konten') {
    where.push('d.kategori = ?')
    params.push(kategori)
  }
  const todo = designTodoSql(user)
  const from = 'FROM design_requests d LEFT JOIN prospects p ON p.id = d.prospect_id LEFT JOIN customers c ON c.id = d.customer_id'
  const [[counts]] = await db.query<(RowDataPacket & { todo: number; aktif: number })[]>(
    `SELECT COALESCE(SUM(${todo.sql}), 0) AS todo, COALESCE(SUM(d.status NOT IN ('disetujui', 'batal')), 0) AS aktif ${from} WHERE ${where.join(' AND ')}`,
    [...todo.params, ...params],
  )
  const [summary] = await db.query<(RowDataPacket & { status: string; n: number })[]>(`SELECT d.status, COUNT(*) AS n ${from} WHERE ${where.join(' AND ')} GROUP BY d.status`, params)
  const status = url.searchParams.get('status')
  if (status === 'todo') {
    where.push(todo.sql)
    params.push(...todo.params)
  } else if (status === 'aktif') {
    where.push("d.status NOT IN ('disetujui', 'batal')")
  } else if (status && status in DESIGN_STATUS) {
    where.push('d.status = ?')
    params.push(status)
  }
  const [items] = await db.query<RowDataPacket[]>(
    `${DESIGN_SELECT} WHERE ${where.join(' AND ')}
     ORDER BY FIELD(d.status, 'diajukan', 'revisi', 'dikerjakan', 'review', 'disetujui', 'batal'), COALESCE(d.deadline, '9999-12-31'), d.id DESC LIMIT 300`,
    params,
  )
  return NextResponse.json({
    items: items.map((d) => ({ ...d, design_count: Number(d.design_count) })),
    counts: { todo: Number(counts.todo), aktif: Number(counts.aktif) },
    summary: Object.fromEntries(summary.map((r) => [r.status, Number(r.n)])),
    roles: { canRequest: canRequest(user), designer: isDesigner(user) },
  })
})

// Brief desain -> notifikasi ke Tim Desain. File referensi diunggah setelahnya.
//   klise : desain cetakan untuk prospek/customer (hasil masuk Data Produk)
//   konten: gambar/video untuk Marketing Digital (hasil masuk bank konten), bisa ditautkan ke rencana konten
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireRequestMenu(user, 'desain')
  if (!canRequest(user)) fail(403, 'Request desain diajukan oleh Marketing.')
  const body = await readJson(request)
  const kategori = body.kategori === 'konten' ? 'konten' : 'klise'
  const jenisKonten = kategori === 'konten' && ['gambar', 'video', 'carousel', 'lainnya'].includes(String(body.jenis_konten)) ? String(body.jenis_konten) : null
  const target = kategori === 'klise' ? await readTarget(body, user) : { prospectId: null, customerId: null, productId: null }
  const brief = readDesignBrief(body)
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO design_requests (kategori, jenis_konten, prospect_id, customer_id, product_id, judul, jenis, ukuran, warna_cetak, brief, deadline, requested_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [kategori, jenisKonten, target.prospectId, target.customerId, target.productId, brief.judul, brief.jenis, brief.ukuran, brief.warna_cetak, brief.brief, brief.deadline, user.id],
  )
  const id = result.insertId
  const nomor = await setNomor('design_requests', 'DSN', id)
  // Ditautkan ke rencana konten: status konten menjadi "Produksi desain"
  const contentId = int(body.content_plan_id)
  if (kategori === 'konten' && contentId && canEditContent(user)) {
    await db.query("UPDATE content_plans SET design_request_id = ?, status = IF(status = 'ide', 'produksi', status) WHERE id = ?", [id, contentId])
  }
  await logRequest({ designId: id, userId: user.id, to: 'diajukan' })
  if (target.prospectId) await logActivity(db, { prospectId: target.prospectId, userId: user.id, jenis: 'catatan', hasil: `Request desain ${nomor}: ${brief.judul}` })
  await notifyRequest(await divisionUsers(['tim_desain']), user.id, {
    type: 'desain_update',
    title: `Request desain baru ${nomor}`,
    body: [brief.judul, brief.deadline && `deadline ${brief.deadline}`, `dari ${user.name}`].filter(Boolean).join(' · '),
    designId: id,
    refKey: `desain:${id}:diajukan:0`,
  })
  return NextResponse.json({ id, nomor }, { status: 201 })
})
