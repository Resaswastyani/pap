import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { NextResponse } from 'next/server'
import { fail, handle, int, readJson, requireUser, str } from '@/lib/api'
import { db } from '@/lib/db'
import { logActivity } from '@/lib/marketing'
import {
  canApproveSample, canRequest, isPPIC, isProduksi, logRequest, notifyRequest, readSampleRequest, readTarget, saveSampleItems, requireRequestMenu,
  sampleApprovers, SAMPLE_SELECT, SAMPLE_STATUS, sampleScope, sampleTodoSql, setNomor,
} from '@/lib/requests'

// Daftar request sample + jumlah per status + "perlu tindakan saya"
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  requireRequestMenu(user, 'sample')
  const url = new URL(request.url)
  const scope = sampleScope(user)
  const where = [scope.sql]
  const params: (string | number)[] = [...scope.params]
  const q = str(url.searchParams.get('q'), 100)
  if (q) {
    where.push('(s.nomor LIKE ? OR s.nama_produk LIKE ? OR p.nama_usaha LIKE ? OR c.name LIKE ?)')
    params.push(...Array(4).fill(`%${q}%`))
  }
  const prospect = int(url.searchParams.get('prospect'))
  if (prospect) {
    where.push('s.prospect_id = ?')
    params.push(prospect)
  }
  const todo = sampleTodoSql(user)
  const [[counts]] = await db.query<(RowDataPacket & { todo: number; aktif: number })[]>(
    `SELECT COALESCE(SUM(${todo.sql}), 0) AS todo, COALESCE(SUM(s.status NOT IN ('disetujui', 'batal')), 0) AS aktif
     FROM sample_requests s LEFT JOIN prospects p ON p.id = s.prospect_id LEFT JOIN customers c ON c.id = s.customer_id WHERE ${where.join(' AND ')}`,
    [...todo.params, ...params],
  )
  const [summary] = await db.query<(RowDataPacket & { status: string; n: number })[]>(
    `SELECT s.status, COUNT(*) AS n FROM sample_requests s LEFT JOIN prospects p ON p.id = s.prospect_id LEFT JOIN customers c ON c.id = s.customer_id
     WHERE ${where.join(' AND ')} GROUP BY s.status`,
    params,
  )
  const status = url.searchParams.get('status')
  if (status === 'todo') {
    where.push(todo.sql)
    params.push(...todo.params)
  } else if (status === 'aktif') {
    where.push("s.status NOT IN ('disetujui', 'batal')")
  } else if (status && status in SAMPLE_STATUS) {
    where.push('s.status = ?')
    params.push(status)
  }
  const [items] = await db.query<RowDataPacket[]>(
    `${SAMPLE_SELECT} WHERE ${where.join(' AND ')}
     ORDER BY FIELD(s.status, 'diajukan', 'revisi', 'dijadwalkan', 'diproduksi', 'selesai', 'dikirim', 'disetujui', 'batal'), COALESCE(s.tenggat, '9999-12-31'), s.id DESC LIMIT 300`,
    params,
  )
  return NextResponse.json({
    items: items.map((s) => ({ ...s, item_count: Number(s.item_count) })),
    counts: { todo: Number(counts.todo), aktif: Number(counts.aktif) },
    summary: Object.fromEntries(summary.map((r) => [r.status, Number(r.n)])),
    roles: { canRequest: canRequest(user), ppic: isPPIC(user), produksi: isProduksi(user), approve: canApproveSample(user) },
  })
})

// Sales mengajukan sample -> notifikasi ke penyetuju (Kepala Produksi, Kepala PPIC, GM)
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  requireRequestMenu(user, 'sample')
  if (!canRequest(user)) fail(403, 'Request sample diajukan oleh Marketing.')
  const body = await readJson(request)
  const target = await readTarget(body, user)
  const spec = readSampleRequest(body)
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO sample_requests (prospect_id, customer_id, nama_produk, spesifikasi, special_request, tenggat, requested_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [target.prospectId, target.customerId, spec.nama_produk, spec.spesifikasi, spec.special_request, spec.tenggat, user.id],
  )
  const id = result.insertId
  await saveSampleItems(id, spec.items)
  const nomor = await setNomor('sample_requests', 'SMP', id)
  await logRequest({ sampleId: id, userId: user.id, to: 'diajukan', catatan: spec.special_request })
  if (target.prospectId) await logActivity(db, { prospectId: target.prospectId, userId: user.id, jenis: 'catatan', hasil: `Request sample ${nomor}: ${spec.items.map((i) => i.nama_produk).join(', ')}` })
  await notifyRequest(await sampleApprovers(), user.id, {
    type: 'sample_update',
    title: `Request sample baru ${nomor} menunggu persetujuan`,
    body: [spec.nama_produk, spec.tenggat && `butuh ${spec.tenggat}`, `dari ${user.name}`].filter(Boolean).join(' · '),
    sampleId: id,
    refKey: `sample:${id}:diajukan:0`,
  })
  return NextResponse.json({ id, nomor }, { status: 201 })
})
